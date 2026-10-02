import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import { db } from "../../server/db/index.js";
import { users } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";
import { getEnv } from "../../server/env.js";
import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  authenticateRequest,
} from "../../server/auth.js";
import { checkRateLimit } from "../../server/rate-limit.js";
import { json, error } from "../../server/response.js";

function getAction(req: IncomingMessage): string {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
  const segments = url.pathname.split("/").filter(Boolean);
  // Match after 'auth' or the last segment
  const authIdx = segments.indexOf("auth");
  if (authIdx !== -1 && segments[authIdx + 1]) {
    return segments[authIdx + 1].toLowerCase();
  }
  return (segments[segments.length - 1] || "").toLowerCase();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const action = getAction(req);
  const method = req.method?.toUpperCase();

  // 1. GET /api/auth/login
  if (action === "login") {
    if (!checkRateLimit(req, res, 20, 60000)) return;

    try {
      const env = getEnv();
      const scope = ["openid", "email", "profile"].join(" ");
      const state = Buffer.from(crypto.randomUUID()).toString("hex");
      const isProd = process.env.NODE_ENV === "production";
      res.setHeader(
        "Set-Cookie",
        `aavora_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isProd ? "; Secure" : ""}`
      );

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        response_type: "code",
        state,
        scope,
        prompt: "select_account",
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      res.statusCode = 302;
      res.setHeader("Location", authUrl);
      return res.end();
    } catch (err: any) {
      return error(res, err.message || "Failed to initiate login", 500);
    }
  }

  // 2. GET /api/auth/callback
  if (action === "callback") {
    if (!checkRateLimit(req, res, 20, 60000)) return;

    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const cookies = parseCookies(req.headers.cookie);

    // If this was an admin connect flow initiated with aavora_admin_oauth_state
    const adminState = cookies["aavora_admin_oauth_state"];
    if (adminState && adminState === state) {
      // Forward to admin callback handler logic
      const adminHandler = (await import("../admin/[action].js")).default;
      return adminHandler(req, res);
    }

    const cookieState = cookies["aavora_oauth_state"];

    // Always clear oauth state cookie on callback
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader(
      "Set-Cookie",
      `aavora_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
    );

    if (errorParam || !code || !state || !cookieState || state !== cookieState) {
      res.statusCode = 302;
      const errReason = errorParam || (!code ? "missing_code" : "invalid_state");
      res.setHeader("Location", `/access-denied?error=${encodeURIComponent(errReason)}`);
      return res.end();
    }

    try {
      const env = getEnv();

      // Exchange code for identity token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        console.error("[OAuth Error] Token exchange failed:", tokenData);
        res.statusCode = 302;
        res.setHeader(
          "Location",
          `/access-denied?error=${encodeURIComponent(tokenData.error_description || "Token exchange failed")}`
        );
        return res.end();
      }

      // Fetch Google User Profile
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json();

      if (!profile.email) {
        res.statusCode = 302;
        res.setHeader("Location", "/access-denied?error=no_email");
        return res.end();
      }

      const email = profile.email.toLowerCase().trim();
      const name = profile.name || email.split("@")[0];

      // Verify user exists in Neon and is active
      const [userRecord] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!userRecord || !userRecord.active) {
        res.statusCode = 302;
        res.setHeader("Location", `/access-denied?email=${encodeURIComponent(email)}`);
        return res.end();
      }

      // Store session in 30-day encrypted cookie (identity only: id, email, name, role)
      const sessionToken = await createSessionToken({
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name || name,
        role: userRecord.role as "admin" | "member",
      });

      setSessionCookie(res, sessionToken, 30);

      res.statusCode = 302;
      res.setHeader("Location", "/docs");
      return res.end();
    } catch (err: any) {
      console.error("[Auth Callback Error]:", err);
      res.statusCode = 302;
      res.setHeader("Location", `/access-denied?error=${encodeURIComponent(err.message || "Authentication failed")}`);
      return res.end();
    }
  }

  // 3. POST /api/auth/logout (also supports GET)
  if (action === "logout") {
    clearSessionCookie(res);
    return json(res, { ok: true, message: "Logged out successfully" });
  }

  // 4. GET /api/auth/me
  if (action === "me") {
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }
    return json(res, { user });
  }

  return error(res, `Unknown auth action: ${action}`, 404);
}
