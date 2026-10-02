import type { IncomingMessage, ServerResponse } from "http";
import { db } from "../../server/db/index.js";
import { users } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";
import { getEnv, getOAuthRedirectUri } from "../../server/env.js";
import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  authenticateRequest,
  createOAuthState,
  verifyOAuthState,
  OAUTH_STATE_COOKIE,
} from "../../server/auth.js";
import { handleAdminDriveConnectCallback } from "../../server/drive.js";
import { checkRateLimit } from "../../server/rate-limit.js";
import { json, error } from "../../server/response.js";
import { decodeJwt } from "jose";

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
      const redirectUri = getOAuthRedirectUri();
      const scope = ["openid", "email", "profile"].join(" ");
      const { stateParam, cookieValue } = createOAuthState("login");

      const isProd = process.env.NODE_ENV === "production";
      res.setHeader(
        "Set-Cookie",
        `${OAUTH_STATE_COOKIE}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isProd ? "; Secure" : ""}`
      );

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        state: stateParam,
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
    const cookieState = cookies[OAUTH_STATE_COOKIE];

    // Always clear OAuth state cookie on callback
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
    );

    const stateResult = verifyOAuthState(state, cookieState);
    const isAdminConnect =
      stateResult.intent === "admin-connect" || (cookieState && cookieState.startsWith("admin-connect"));

    if (errorParam || !code || !stateResult.valid) {
      res.statusCode = 302;
      const errReason = errorParam || (!code ? "missing_code" : "invalid_state");
      if (isAdminConnect) {
        res.setHeader(
          "Location",
          `/more?driveError=${encodeURIComponent(errReason)}&msg=${encodeURIComponent(
            "Authentication session expired or was cancelled. Please try again."
          )}`
        );
      } else {
        res.setHeader("Location", `/access-denied?error=${encodeURIComponent(errReason)}`);
      }
      return res.end();
    }

    // Branch to Admin Drive Connect flow
    if (stateResult.intent === "admin-connect") {
      return await handleAdminDriveConnectCallback(req, res, code);
    }

    // Branch to Normal User Login flow
    try {
      const env = getEnv();
      const redirectUri = getOAuthRedirectUri();

      // Exchange code for identity token using the single source of truth redirect_uri
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
        console.error("[OAuth Error] Token exchange failed:", tokenData);
        res.statusCode = 302;
        res.setHeader(
          "Location",
          `/access-denied?error=${encodeURIComponent(tokenData.error_description || "Token exchange failed")}`
        );
        return res.end();
      }

      // Read verified email from ID token first
      let email = "";
      let name = "";
      if (tokenData.id_token) {
        try {
          const claims = decodeJwt(tokenData.id_token);
          if (claims.email && (claims.email_verified === true || claims.email_verified === "true")) {
            email = String(claims.email).toLowerCase().trim();
            name = (claims.name as string) || email.split("@")[0];
          }
        } catch (err) {
          console.error("[OAuth] Failed to decode id_token:", err);
        }
      }

      // Fallback to Google User Profile endpoint if needed
      if (!email && tokenData.access_token) {
        const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileRes.json();
        if (profile.email) {
          email = profile.email.toLowerCase().trim();
          name = profile.name || email.split("@")[0];
        }
      }

      if (!email) {
        res.statusCode = 302;
        res.setHeader("Location", "/access-denied?error=no_email");
        return res.end();
      }

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
