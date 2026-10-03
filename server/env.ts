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
  ENCRYPTION_KEY?: string;
}

const REQUIRED_VARS = [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
  "ADMIN_EMAIL",
  "SESSION_SECRET",
] as const;

let cachedEnv: EnvConfig | null = null;

/**
 * Trims trailing slashes from APP_URL, ensures valid scheme, and avoids mixing http/https.
 */
export function normalizeAppUrl(rawUrl?: string): string {
  let u = (rawUrl || "").trim();
  if (!u) {
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      u = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    } else if (process.env.VERCEL_URL) {
      u = `https://${process.env.VERCEL_URL}`;
    } else {
      u = "http://localhost:5173";
    }
  }

  // Ensure scheme
  if (!/^https?:\/\//i.test(u)) {
    if (u.includes("localhost") || u.includes("127.0.0.1")) {
      u = `http://${u}`;
    } else {
      u = `https://${u}`;
    }
  }

  // Never mix http and https for production hosts
  if (!u.includes("localhost") && !u.includes("127.0.0.1") && u.startsWith("http://")) {
    u = u.replace(/^http:\/\//i, "https://");
  }

  // Trim trailing slashes
  return u.replace(/\/+$/, "");
}

/**
 * Returns the single source of truth redirect URI: ${APP_URL}/api/auth/callback.
 * Byte-for-byte identical in authorize request and token exchange.
 */
export function getOAuthRedirectUri(): string {
  const env = getEnv();
  const base = normalizeAppUrl(env.APP_URL);
  const uri = `${base}/api/auth/callback`;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[OAuth Dev] Using redirect_uri: ${uri}`);
  }
  return uri;
}

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

  // APP_URL can come from customEnv.APP_URL, customEnv.GOOGLE_REDIRECT_URI origin, or VERCEL_URL
  const rawAppUrl = (customEnv.APP_URL || "").trim();
  const rawRedirectUri = (customEnv.GOOGLE_REDIRECT_URI || "").trim();
  let effectiveAppUrl = "";

  if (rawAppUrl) {
    effectiveAppUrl = normalizeAppUrl(rawAppUrl);
  } else if (rawRedirectUri) {
    try {
      effectiveAppUrl = normalizeAppUrl(new URL(rawRedirectUri).origin);
    } catch {
      effectiveAppUrl = normalizeAppUrl();
    }
  } else {
    // If neither is explicitly provided and not running in standard cloud fallback
    if (!customEnv.APP_URL && !process.env.VERCEL_URL && !process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      missing.push("APP_URL");
    } else {
      effectiveAppUrl = normalizeAppUrl();
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[Aavora Configuration Error] Missing required environment variables:\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\nPlease ensure all variables are defined in your .env file or Vercel project settings.`
    );
  }

  const sessionSecret = (customEnv.SESSION_SECRET || "").trim();
  if (sessionSecret.length < 32) {
    throw new Error(
      "[Aavora Configuration Error] SESSION_SECRET must be at least 32 characters long for secure AES-256-GCM encryption."
    );
  }

  const rawAllowed = customEnv.ALLOWED_EMAILS || "";
  const allowedList = rawAllowed
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const adminEmail = (customEnv.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!allowedList.includes(adminEmail)) {
    allowedList.push(adminEmail);
  }

  const canonicalRedirectUri = `${effectiveAppUrl}/api/auth/callback`;

  return {
    DATABASE_URL: customEnv.DATABASE_URL!.trim(),
    GOOGLE_CLIENT_ID: customEnv.GOOGLE_CLIENT_ID!.trim(),
    GOOGLE_CLIENT_SECRET: customEnv.GOOGLE_CLIENT_SECRET!.trim(),
    GOOGLE_REDIRECT_URI: canonicalRedirectUri,
    GOOGLE_DRIVE_ROOT_FOLDER_ID: customEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID!.trim(),
    ADMIN_EMAIL: adminEmail,
    ALLOWED_EMAILS: allowedList,
    SESSION_SECRET: sessionSecret,
    APP_URL: effectiveAppUrl,
    GOOGLE_ADMIN_REFRESH_TOKEN: customEnv.GOOGLE_ADMIN_REFRESH_TOKEN?.trim(),
    ENCRYPTION_KEY: customEnv.ENCRYPTION_KEY?.trim() || undefined,
  };
}

export function getEnv(): EnvConfig {
  if (!cachedEnv) {
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
}
