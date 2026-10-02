import "dotenv/config";

export interface EnvConfig {
  DATABASE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_DRIVE_ROOT_FOLDER_ID: string;
  ADMIN_EMAIL: string;
  ALLOWED_EMAILS: string[];
  SESSION_SECRET: string;
  APP_URL: string;
  GOOGLE_ADMIN_REFRESH_TOKEN?: string;
}

const REQUIRED_VARS = [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
  "ADMIN_EMAIL",
  "SESSION_SECRET",
  "APP_URL",
] as const;

let cachedEnv: EnvConfig | null = null;

/**
 * Validates all required environment variables.
 * Throws a descriptive error without printing or leaking any secret values.
 */
export function validateEnv(customEnv: Record<string, string | undefined> = process.env): EnvConfig {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    const val = customEnv[key];
    if (!val || val.trim().length === 0) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[Aavora Configuration Error] Missing required environment variables:\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\nPlease ensure all variables are defined in your .env file or Vercel project settings.`
    );
  }

  // Session secret length check
  const sessionSecret = (customEnv.SESSION_SECRET || "").trim();
  if (sessionSecret.length < 32) {
    throw new Error(
      `[Aavora Configuration Error] SESSION_SECRET must be at least 32 characters long for AES-256-GCM encryption (current length: ${sessionSecret.length}).`
    );
  }

  const allowedEmailsRaw = customEnv.ALLOWED_EMAILS || "";
  const allowedEmails = allowedEmailsRaw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return {
    DATABASE_URL: (customEnv.DATABASE_URL || "").trim(),
    GOOGLE_CLIENT_ID: (customEnv.GOOGLE_CLIENT_ID || "").trim(),
    GOOGLE_CLIENT_SECRET: (customEnv.GOOGLE_CLIENT_SECRET || "").trim(),
    GOOGLE_REDIRECT_URI: (customEnv.GOOGLE_REDIRECT_URI || "").trim(),
    GOOGLE_DRIVE_ROOT_FOLDER_ID: (customEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID || "").trim(),
    ADMIN_EMAIL: (customEnv.ADMIN_EMAIL || "").trim().toLowerCase(),
    ALLOWED_EMAILS: allowedEmails,
    SESSION_SECRET: sessionSecret,
    APP_URL: (customEnv.APP_URL || "http://localhost:5173").trim(),
    GOOGLE_ADMIN_REFRESH_TOKEN: customEnv.GOOGLE_ADMIN_REFRESH_TOKEN?.trim() || undefined,
  };
}

export function getEnv(): EnvConfig {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}
