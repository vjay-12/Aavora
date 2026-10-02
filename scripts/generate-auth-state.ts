import "dotenv/config";
import fs from "fs";
import path from "path";
import { getEnv } from "../server/env.js";
import { createSessionToken, COOKIE_NAME } from "../server/auth.js";

export async function generateAuthState() {
  const env = getEnv();

  const token = await createSessionToken({
    id: 1,
    email: env.ADMIN_EMAIL,
    name: "Admin User",
    role: "admin",
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
