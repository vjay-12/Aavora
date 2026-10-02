import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import { authenticateRequest, parseCookies } from "../../server/auth.js";
import { encryptSecret } from "../../server/crypto.js";
import { invalidateAdminTokenCache } from "../../server/drive.js";
import { getEnv } from "../../server/env.js";
import { db } from "../../server/db/index.js";
import { users, settings } from "../../server/db/schema.js";
import { eq, desc } from "drizzle-orm";
import { json, error, parseJsonBody } from "../../server/response.js";

function getAdminAction(req: IncomingMessage): string {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
  const pathname = url.pathname.toLowerCase();

  if (pathname.includes("/admin/drive/connect") || pathname.endsWith("/drive-connect") || pathname.endsWith("/connect")) {
    return "drive-connect";
  }
  if (pathname.includes("/admin/drive/callback") || pathname.endsWith("/drive-callback") || pathname.endsWith("/callback")) {
    return "drive-callback";
  }
  if (pathname.includes("/admin/users") || pathname.endsWith("/users")) {
    return "users";
  }

  const segments = pathname.split("/").filter(Boolean);
  const adminIdx = segments.indexOf("admin");
  if (adminIdx !== -1 && segments[adminIdx + 1]) {
    return segments.slice(adminIdx + 1).join("-");
  }
  return segments[segments.length - 1] || "";
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const action = getAdminAction(req);
  const method = req.method?.toUpperCase();

  // 1. GET /api/admin/drive/connect
  if (action === "drive-connect") {
    try {
      const user = await authenticateRequest(req, res);
      if (!user) {
        return error(res, "Unauthorized", 401);
      }

      const env = getEnv();
      if (user.role !== "admin" || user.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
        return error(res, "Forbidden: Only the designated admin can connect Google Drive.", 403);
      }

      const state = crypto.randomUUID();
      const isProd = process.env.NODE_ENV === "production";
      res.setHeader(
        "Set-Cookie",
        `aavora_admin_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isProd ? "; Secure" : ""}`
      );

      const baseOrigin = new URL(env.GOOGLE_REDIRECT_URI).origin;
      const redirectUri = process.env.GOOGLE_ADMIN_REDIRECT_URI || `${baseOrigin}/api/admin/drive/callback`;

      const scope = [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive",
      ].join(" ");

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      res.statusCode = 302;
      res.setHeader("Location", authUrl);
      return res.end();
    } catch (err: any) {
      console.error("[Admin Drive Connect Error]:", err);
      return error(res, err.message || "Failed to initiate admin Drive connection", 500);
    }
  }

  // 2. GET /api/admin/drive/callback
  if (action === "drive-callback") {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const cookies = parseCookies(req.headers.cookie);
    const cookieState = cookies["aavora_admin_oauth_state"];

    // Clear admin oauth state cookie
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader(
      "Set-Cookie",
      `aavora_admin_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
    );

    if (errorParam || !code || !state || !cookieState || state !== cookieState) {
      res.statusCode = 302;
      const reason = errorParam || (!code ? "missing_code" : "invalid_state");
      res.setHeader("Location", `/more?error=${encodeURIComponent(reason)}`);
      return res.end();
    }

    try {
      const env = getEnv();
      const baseOrigin = new URL(env.GOOGLE_REDIRECT_URI).origin;
      const isDelegatedFromAuthCallback = (req.url || "").includes("/api/auth/callback");
      const redirectUri = process.env.GOOGLE_ADMIN_REDIRECT_URI ||
        (isDelegatedFromAuthCallback ? env.GOOGLE_REDIRECT_URI : `${baseOrigin}/api/admin/drive/callback`);

      // Exchange authorization code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        console.error("[Admin Drive OAuth] Token exchange failed:", tokenData);
        res.statusCode = 302;
        res.setHeader(
          "Location",
          `/more?error=${encodeURIComponent(tokenData.error_description || "Token exchange failed")}`
        );
        return res.end();
      }

      // Fetch Google profile and verify email equals ADMIN_EMAIL
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json();

      const authorizedEmail = (profile.email || "").toLowerCase().trim();
      if (authorizedEmail !== env.ADMIN_EMAIL.toLowerCase()) {
        console.error(`[Admin Drive OAuth] Email mismatch. Expected ${env.ADMIN_EMAIL}, got ${authorizedEmail}`);
        res.statusCode = 302;
        res.setHeader(
          "Location",
          `/more?error=admin_email_mismatch&msg=${encodeURIComponent(
            "Access denied: You must authenticate with the designated admin Google account."
          )}`
        );
        return res.end();
      }

      if (!tokenData.refresh_token) {
        console.warn("[Admin Drive OAuth] No refresh token returned by Google");
        res.statusCode = 302;
        res.setHeader(
          "Location",
          `/more?error=no_refresh_token&msg=${encodeURIComponent(
            "Google did not return a refresh token. Please click Connect Drive again with consent."
          )}`
        );
        return res.end();
      }

      // Encrypt refresh token using AES-256-GCM and store in settings table
      const encryptedToken = encryptSecret(tokenData.refresh_token);

      await db
        .insert(settings)
        .values({
          key: "admin_drive_refresh_token",
          valueEncrypted: encryptedToken,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            valueEncrypted: encryptedToken,
            updatedAt: new Date(),
          },
        });

      invalidateAdminTokenCache();

      res.statusCode = 302;
      res.setHeader("Location", "/home?admin_drive_connected=true");
      return res.end();
    } catch (err: any) {
      console.error("[Admin Drive Callback Error]:", err);
      res.statusCode = 302;
      res.setHeader(
        "Location",
        `/more?error=${encodeURIComponent(err.message || "Failed to complete admin Drive connection")}`
      );
      return res.end();
    }
  }

  // 3. /api/admin/users
  if (action === "users") {
    try {
      const session = await authenticateRequest(req);
      if (!session) return error(res, "Unauthorized", 401);

      if (session.role !== "admin") {
        return error(res, "Forbidden: Admin privileges required", 403);
      }

      if (method === "GET") {
        const allUsers = await db
          .select()
          .from(users)
          .orderBy(desc(users.createdAt));
        return json(res, { users: allUsers });
      }

      if (method === "POST") {
        const body = await parseJsonBody<{
          email: string;
          name: string;
          role?: "admin" | "member";
        }>(req);

        if (!body.email || !body.name) {
          return error(res, "Email and name are required", 400);
        }

        const email = body.email.toLowerCase().trim();
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
          return error(res, "A user with this email already exists", 409);
        }

        const [newUser] = await db
          .insert(users)
          .values({
            email,
            name: body.name.trim(),
            role: body.role || "member",
            active: true,
          })
          .returning();

        return json(res, { user: newUser });
      }

      if (method === "PATCH") {
        const body = await parseJsonBody<{
          id: number;
          active?: boolean;
          role?: "admin" | "member";
        }>(req);

        if (!body.id) return error(res, "User ID is required", 400);

        if (body.id === session.id && body.active === false) {
          return error(res, "You cannot deactivate your own admin account", 400);
        }

        const updateData: Record<string, any> = {};
        if (typeof body.active === "boolean") updateData.active = body.active;
        if (body.role) updateData.role = body.role;

        const [updated] = await db
          .update(users)
          .set(updateData)
          .where(eq(users.id, body.id))
          .returning();

        return json(res, { user: updated });
      }

      if (method === "DELETE") {
        const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
        const idStr = url.searchParams.get("id");
        if (!idStr) return error(res, "User ID is required", 400);

        const userId = parseInt(idStr, 10);
        if (userId === session.id) {
          return error(res, "You cannot delete your own admin account", 400);
        }

        await db.delete(users).where(eq(users.id, userId));
        return json(res, { success: true });
      }

      return error(res, `Method ${method} not allowed`, 405);
    } catch (err: any) {
      console.error("[Admin Users Error]:", err);
      return error(res, err.message || "Failed to process user operation", 500);
    }
  }

  return error(res, `Unknown admin action: ${action}`, 404);
}
