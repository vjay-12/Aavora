import { EncryptJWT, jwtDecrypt } from "jose";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { getEnv } from "./env.js";
import type { IncomingMessage, ServerResponse } from "http";

export const COOKIE_NAME = "aavora_session";

function getSecretKey(): Uint8Array {
  const env = getEnv();
  const rawSecret = (process.env.COOKIE_SECRET || env.SESSION_SECRET).trim();
  return new TextEncoder().encode(rawSecret.padEnd(32, "0").slice(0, 32));
}

export interface SessionPayload {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
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
  const existing = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : null;
  if (existing) {
    const list = Array.isArray(existing) ? existing : [String(existing)];
    res.setHeader("Set-Cookie", [...list, cookie]);
  } else if (typeof res.setHeader === "function") {
    res.setHeader("Set-Cookie", cookie);
  }
}

// Clear cookie on logout
export function clearSessionCookie(res: ServerResponse) {
  const isProd = process.env.NODE_ENV === "production";
  const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    isProd ? "; Secure" : ""
  }`;
  const existing = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : null;
  if (existing) {
    const list = Array.isArray(existing) ? existing : [String(existing)];
    res.setHeader("Set-Cookie", [...list, cookie]);
  } else if (typeof res.setHeader === "function") {
    res.setHeader("Set-Cookie", cookie);
  }
}

/**
 * Authenticates request and verifies user exists in Neon users table and is active.
 * Session stores strictly user identity (no Drive tokens).
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

    return {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role as "admin" | "member",
    };
  } catch (err) {
    console.error("[Auth Error] Neon database verification error:", err);
    return null;
  }
}
