import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import { authenticateRequest } from "../../_utils/auth.js";
import { getEnv } from "../../_utils/env.js";
import { error } from "../../_utils/response.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
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

    // Derive admin callback URL or use override if specified
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
    res.end();
  } catch (err: any) {
    console.error("[Admin Drive Connect Error]:", err);
    return error(res, err.message || "Failed to initiate admin Drive connection", 500);
  }
}
