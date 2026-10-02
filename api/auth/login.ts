import type { IncomingMessage, ServerResponse } from "http";
import { getEnv } from "../_utils/env";
import { checkRateLimit } from "../_utils/rate-limit";
import { error } from "../_utils/response";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // 1. Rate limiting
  if (!checkRateLimit(req, res, 20, 60000)) return;

  try {
    const env = getEnv();

    const scope = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive",
    ].join(" ");

    const state = Buffer.from(crypto.randomUUID()).toString("hex");
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader("Set-Cookie", `aavora_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isProd ? "; Secure" : ""}`);

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
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
    return error(res, err.message || "Failed to initiate login", 500);
  }
}
