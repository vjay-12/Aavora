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
import { handleAdminDriveConnectCallback, getAdminAccessToken } from "../../server/drive.js";
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

      // Read verified email, name, given_name, picture from ID token first
      let email = "";
      let googleName = "";
      let googleGivenName = "";
      let googlePicture = "";

      if (tokenData.id_token) {
        try {
          const claims = decodeJwt(tokenData.id_token);
          if (claims.email && (claims.email_verified === true || claims.email_verified === "true")) {
            email = String(claims.email).toLowerCase().trim();
            googleName = typeof claims.name === "string" ? claims.name.trim() : "";
            googleGivenName = typeof claims.given_name === "string" ? claims.given_name.trim() : "";
            googlePicture = typeof claims.picture === "string" ? claims.picture.trim() : "";
          }
        } catch (err) {
          console.error("[OAuth] Failed to decode id_token:", err);
        }
      }

      // If userinfo endpoint has extra profile details or if email not found, fetch userinfo
      if (tokenData.access_token && (!email || !googleName || !googlePicture)) {
        try {
          const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            if (profile.email && !email) {
              email = profile.email.toLowerCase().trim();
            }
            if (profile.name && !googleName) googleName = profile.name.trim();
            if (profile.given_name && !googleGivenName) googleGivenName = profile.given_name.trim();
            if (profile.picture && !googlePicture) googlePicture = profile.picture.trim();
          }
        } catch (profileErr) {
          console.error("[OAuth] Failed to fetch userinfo:", profileErr);
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

      // Update name and picture from Google according to display & lock rules:
      // Don't overwrite if manual name is locked (nameLocked), unless name is empty or default email prefix.
      const emailPrefix = email.split("@")[0].toLowerCase();
      const currentNameClean = (userRecord.name || "").toLowerCase().replace(/[._]/g, " ").trim();
      const isDefaultEmailPrefix =
        !userRecord.name ||
        currentNameClean === emailPrefix ||
        currentNameClean === emailPrefix.replace(/[._]/g, " ");

      const canUpdateName = !userRecord.nameLocked || isDefaultEmailPrefix;

      let finalName = userRecord.name;
      if (googleName && canUpdateName) {
        finalName = googleName;
      }

      let finalGivenName = userRecord.givenName;
      if (googleGivenName && canUpdateName) {
        finalGivenName = googleGivenName;
      } else if (!finalGivenName && finalName) {
        finalGivenName = finalName.split(/\s+/)[0];
      }

      let finalPicture = userRecord.picture;
      if (googlePicture) {
        finalPicture = googlePicture;
      }

      if (
        finalName !== userRecord.name ||
        finalGivenName !== userRecord.givenName ||
        finalPicture !== userRecord.picture
      ) {
        await db
          .update(users)
          .set({
            name: finalName,
            givenName: finalGivenName,
            picture: finalPicture,
          })
          .where(eq(users.id, userRecord.id));
      }

      // Store session in 30-day encrypted cookie
      const sessionToken = await createSessionToken({
        id: userRecord.id,
        email: userRecord.email,
        name: finalName,
        role: userRecord.role as "admin" | "member",
        givenName: finalGivenName || undefined,
        picture: finalPicture || undefined,
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

  // 4. GET /api/auth/me (or /api/me)
  if (action === "me") {
    let user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }

    // One-time admin backfill: refreshes admin name and picture from Google userinfo if missing or default prefix
    if (user.role === "admin") {
      const emailPrefix = user.email.split("@")[0].toLowerCase();
      const currentNameClean = (user.name || "").toLowerCase().replace(/[._]/g, " ").trim();
      const isDefaultPrefix =
        !user.name ||
        currentNameClean === emailPrefix ||
        currentNameClean === emailPrefix.replace(/[._]/g, " ");

      if (!user.picture || !user.givenName || isDefaultPrefix) {
        try {
          const adminAccessToken = await getAdminAccessToken().catch(() => null);
          if (adminAccessToken) {
            const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${adminAccessToken}` },
            });
            if (profileRes.ok) {
              const profile = await profileRes.json();
              const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
              if (dbUser && (!dbUser.nameLocked || isDefaultPrefix)) {
                const newName = (profile.name && (!dbUser.nameLocked || isDefaultPrefix)) ? profile.name.trim() : dbUser.name;
                const newGivenName = profile.given_name ? profile.given_name.trim() : (newName ? newName.split(/\s+/)[0] : dbUser.givenName);
                const newPicture = profile.picture ? profile.picture.trim() : dbUser.picture;

                await db
                  .update(users)
                  .set({
                    name: newName,
                    givenName: newGivenName,
                    picture: newPicture,
                  })
                  .where(eq(users.id, user.id));

                user = {
                  ...user,
                  name: newName,
                  givenName: newGivenName || undefined,
                  picture: newPicture || undefined,
                };

                // Re-issue session cookie with updated credentials
                const refreshedToken = await createSessionToken({
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  role: user.role,
                  givenName: user.givenName,
                  picture: user.picture,
                });
                setSessionCookie(res, refreshedToken, 30);
              }
            }
          }
        } catch (backfillErr) {
          console.error("[Me Backfill Error]:", backfillErr);
        }
      }
    }

    return json(res, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        givenName: user.givenName,
        picture: user.picture,
      },
    });
  }

  return error(res, `Unknown auth action: ${action}`, 404);
}
