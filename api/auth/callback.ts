import type { IncomingMessage, ServerResponse } from "http";
import { db } from "../../src/db/index.js";
import { users } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { getEnv } from "../_utils/env.js";
import { createSessionToken, setSessionCookie, parseCookies } from "../_utils/auth.js";
import { checkRateLimit } from "../_utils/rate-limit.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // 1. Rate limiting
  if (!checkRateLimit(req, res, 20, 60000)) return;

  const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const cookies = parseCookies(req.headers.cookie);
  const adminState = cookies["aavora_admin_oauth_state"];
  if (adminState && adminState === state) {
    const adminCallback = (await import("../admin/drive/callback.js")).default;
    return adminCallback(req, res);
  }

  const cookieState = cookies["aavora_oauth_state"];

  // Always clear oauth state cookie on callback
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", `aavora_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`);

  // Validate error, code, and CSRF state
  if (errorParam || !code || !state || !cookieState || state !== cookieState) {
    res.statusCode = 302;
    const errReason = errorParam || (!code ? "missing_code" : "invalid_state");
    res.setHeader("Location", `/access-denied?error=${encodeURIComponent(errReason)}`);
    return res.end();
  }

  try {
    const env = getEnv();

    // 2. Exchange code for access & refresh tokens
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
      res.setHeader("Location", `/access-denied?error=${encodeURIComponent(tokenData.error_description || "Token exchange failed")}`);
      return res.end();
    }

    // 3. Fetch Google User Profile
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

    // 4. Verify user exists in Neon and is active
    const [userRecord] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!userRecord || !userRecord.active) {
      // User is not allowed or deactivated
      res.statusCode = 302;
      res.setHeader("Location", `/access-denied?email=${encodeURIComponent(email)}`);
      return res.end();
    }

    // 5. Store session in 30-day encrypted cookie (identity only: id, email, name, role)
    const sessionToken = await createSessionToken({
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name || name,
      role: userRecord.role as "admin" | "member",
    });

    setSessionCookie(res, sessionToken, 30);

    // Redirect to Docs root
    res.statusCode = 302;
    res.setHeader("Location", "/docs");
    res.end();
  } catch (err: any) {
    console.error("[Auth Callback Error]:", err);
    res.statusCode = 302;
    res.setHeader("Location", `/access-denied?error=${encodeURIComponent(err.message || "Authentication failed")}`);
    res.end();
  }
}
