import { EncryptJWT, jwtDecrypt } from "jose";
import { db } from "../../src/db";
import { users } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "./env";
import type { IncomingMessage, ServerResponse } from "http";

export const COOKIE_NAME = "aavora_session";

function getSecretKey(): Uint8Array {
  const env = getEnv();
  const rawSecret = env.SESSION_SECRET;
  return new TextEncoder().encode(rawSecret.padEnd(32, "0").slice(0, 32));
}

export interface SessionPayload {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  accessToken: string;
}

// Encrypt 30-day session cookie using AES-256-GCM via jose
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const secretKey = getSecretKey();
  return await new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .encrypt(secretKey);
}

// Decrypt and verify session token
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtDecrypt(token, secretKey);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// Extract cookies from request headers
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...v] = c.trim().split("=");
      return [key, decodeURIComponent(v.join("="))];
    })
  );
}

// Set HttpOnly, Secure, SameSite=Lax cookie on response
export function setSessionCookie(res: ServerResponse, token: string, maxAgeDays = 30) {
  const isProd = process.env.NODE_ENV === "production";
  const maxAge = maxAgeDays * 24 * 60 * 60;
  const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    isProd ? "; Secure" : ""
  }`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const list = Array.isArray(existing) ? existing : [String(existing)];
    res.setHeader("Set-Cookie", [...list, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

// Clear cookie on logout
export function clearSessionCookie(res: ServerResponse) {
  const isProd = process.env.NODE_ENV === "production";
  const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    isProd ? "; Secure" : ""
  }`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const list = Array.isArray(existing) ? existing : [String(existing)];
    res.setHeader("Set-Cookie", [...list, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

/**
 * Silently refreshes access token using Google OAuth if expired or near expiration (< 5 mins)
 */
async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    const env = getEnv();
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
      return null;
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in || 3600,
    };
  } catch {
    return null;
  }
}

/**
 * Authenticates request, verifies against Neon users table,
 * and automatically refreshes access token silently if needed.
 */
export async function authenticateRequest(
  req: IncomingMessage,
  res?: ServerResponse
): Promise<AuthenticatedUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session || !session.email) return null;

  // 1. Verify user exists in Neon database and is active
  try {
    const [userRecord] = await db
      .select()
      .from(users)
      .where(eq(users.email, session.email.toLowerCase()))
      .limit(1);

    if (!userRecord || !userRecord.active) {
      if (res) clearSessionCookie(res);
      return null;
    }

    let currentAccessToken = session.accessToken || "";
    const expiresAt = session.accessTokenExpiresAt || 0;
    const now = Date.now();

    // 2. Check if access token is expired or within 5 minutes of expiring
    if (session.refreshToken && (!currentAccessToken || now + 5 * 60 * 1000 > expiresAt)) {
      const refreshed = await refreshGoogleAccessToken(session.refreshToken);
      if (refreshed) {
        currentAccessToken = refreshed.accessToken;
        const newExpiresAt = now + refreshed.expiresIn * 1000;

        // Update encrypted cookie on the response
        if (res) {
          const updatedToken = await createSessionToken({
            ...session,
            accessToken: currentAccessToken,
            accessTokenExpiresAt: newExpiresAt,
          });
          setSessionCookie(res, updatedToken);
        }
      } else if (now > expiresAt) {
        // Refresh token revoked or invalid AND access token already expired
        if (res) clearSessionCookie(res);
        return null;
      }
    } else if (now > expiresAt && !session.refreshToken) {
      if (res) clearSessionCookie(res);
      return null;
    }

    return {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role as "admin" | "member",
      accessToken: currentAccessToken,
    };
  } catch (err) {
    console.error("[Auth Error] Neon database verification error:", err);
    return null;
  }
}
