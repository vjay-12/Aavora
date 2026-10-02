import "dotenv/config";
import fs from "fs";
import path from "path";
import { getEnv } from "../api/_utils/env";
import { createSessionToken, COOKIE_NAME } from "../api/_utils/auth";
import { getAdminAccessToken } from "../api/_utils/drive";

export async function generateAuthState() {
  const env = getEnv();
  let liveAccessToken = "mock_qa_token_for_playwright";
  try {
    liveAccessToken = await getAdminAccessToken();
  } catch (err: any) {
    console.warn("Could not get live access token:", err.message);
  }

  const token = await createSessionToken({
    id: 1,
    email: env.ADMIN_EMAIL,
    name: "Admin User",
    role: "admin",
    accessToken: liveAccessToken,
    refreshToken: env.GOOGLE_ADMIN_REFRESH_TOKEN,
    accessTokenExpiresAt: Date.now() + 3500 * 1000,
  });

  const authDir = path.resolve(import.meta.dirname, "../playwright/.auth");
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const storageState = {
    cookies: [
      {
        name: COOKIE_NAME,
        value: token,
        domain: "localhost",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600 * 24 * 30,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  };

  const statePath = path.join(authDir, "user.json");
  fs.writeFileSync(statePath, JSON.stringify(storageState, null, 2));
  console.log(`[PASS] Playwright auth storage state saved at: ${statePath}`);
  return statePath;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate-auth-state.ts")) {
  generateAuthState().catch((err) => {
    console.error("Failed to generate auth state:", err);
    process.exit(1);
  });
}
