import type { IncomingMessage, ServerResponse } from "http";
import { parseCookies } from "../../_utils/auth.js";
import { encryptSecret } from "../../_utils/crypto.js";
import { invalidateAdminTokenCache } from "../../_utils/drive.js";
import { getEnv } from "../../_utils/env.js";
import { db } from "../../../src/db/index.js";
import { settings } from "../../../src/db/schema.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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

    // 1. Exchange authorization code for tokens
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

    // 2. Fetch Google profile and verify email equals ADMIN_EMAIL
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
      // In case Google did not return a refresh token (e.g. consent prompt was skipped)
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

    // 3. Encrypt refresh token using AES-256-GCM and store in settings table
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

    // Invalidate cached access token so the app immediately starts using the new connection
    invalidateAdminTokenCache();

    console.log("[Admin Drive OAuth] Successfully stored encrypted admin Drive refresh token.");

    res.statusCode = 302;
    res.setHeader("Location", "/home?admin_drive_connected=true");
    res.end();
  } catch (err: any) {
    console.error("[Admin Drive Callback Error]:", err);
    res.statusCode = 302;
    res.setHeader(
      "Location",
      `/more?error=${encodeURIComponent(err.message || "Failed to complete admin Drive connection")}`
    );
    res.end();
  }
}
