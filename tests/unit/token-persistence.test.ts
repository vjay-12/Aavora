import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  encryptSecret,
  decryptSecret,
  decryptSecretWithFallback,
  getPrimaryEncryptionKey,
} from "../../server/crypto.js";
import {
  getAdminAccessToken,
  saveAdminRefreshToken,
  getAdminTokenSettingKey,
  invalidateAdminTokenCache,
  invalidateVaultCache,
  AdminDriveError,
  AdminDriveTransientError,
  getAdminDriveHealth,
} from "../../server/drive.js";
import { db } from "../../server/db/index.js";
import { settings } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";
import { getEnv } from "../../server/env.js";
import driveHandler from "../../api/drive/[action].js";

function createFakeReq(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  token?: string;
  body?: any;
}) {
  const req: any = {
    method: opts.method || "GET",
    url: opts.url || "/api/drive/status",
    headers: {
      host: "localhost:5173",
      ...(opts.headers || {}),
      ...(opts.token ? { cookie: `aavora_session=${opts.token}` } : {}),
    },
  };
  if (opts.body) {
    req.body = opts.body;
  }
  return req;
}

function createFakeRes() {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let bodyData = "";

  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
    end: (chunk?: any) => {
      if (chunk) bodyData += chunk;
    },
    write: (chunk: any) => {
      bodyData += chunk;
      return true;
    },
  };

  Object.defineProperty(res, "statusCode", {
    get: () => statusCode,
    set: (val: number) => {
      statusCode = val;
    },
  });

  return {
    res,
    getCode: () => statusCode,
    getBody: () => {
      try {
        return JSON.parse(bodyData);
      } catch {
        return bodyData;
      }
    },
    getHeaders: () => headers,
  };
}

describe("Admin Google Drive Token Persistence & Resilience", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const testSettingKey = "test_persistence_token_key";

  beforeEach(() => {
    process.env.ADMIN_TOKEN_SETTING_KEY = testSettingKey;
    invalidateAdminTokenCache();
    invalidateVaultCache();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    delete process.env.ADMIN_TOKEN_SETTING_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.VERCEL_ENV;
    if (originalEnv.COOKIE_SECRET) process.env.COOKIE_SECRET = originalEnv.COOKIE_SECRET;
    else delete process.env.COOKIE_SECRET;
    if (originalEnv.SESSION_SECRET) process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
    else delete process.env.SESSION_SECRET;

    try {
      await db.delete(settings).where(eq(settings.key, testSettingKey));
      await db.delete(settings).where(eq(settings.key, `${testSettingKey}_last_refreshed`));
      await db.delete(settings).where(eq(settings.key, "admin_drive_refresh_token_preview"));
    } catch {
      // Cleanup best-effort
    }
  });

  it("1. Token survives a simulated cold start (cleared in-memory cache)", async () => {
    const rawToken = "test_cold_start_refresh_token_abc123";
    await saveAdminRefreshToken(rawToken);

    // Verify token is in DB
    const [row] = await db.select().from(settings).where(eq(settings.key, testSettingKey)).limit(1);
    expect(row).toBeDefined();
    expect(row.valueEncrypted).toBeDefined();

    // Simulate cold start: clear in-memory token cache
    invalidateAdminTokenCache();
    invalidateVaultCache();

    // Mock Google token exchange
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_access_token_cold_start",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    const accessToken = await getAdminAccessToken();
    expect(accessToken).toBe("mock_access_token_cold_start");
  });

  it("2. Decryption works after COOKIE_SECRET / SESSION_SECRET changes when ENCRYPTION_KEY is set", async () => {
    const dedicatedKey = "custom_dedicated_encryption_key_32_bytes_long!!";
    process.env.ENCRYPTION_KEY = dedicatedKey;
    process.env.COOKIE_SECRET = "initial_cookie_secret_12345678901234567890";
    process.env.SESSION_SECRET = "initial_session_secret_12345678901234567890";

    const secretData = "my_critical_refresh_token_xyz999";
    const encrypted = encryptSecret(secretData);

    // Change COOKIE_SECRET and SESSION_SECRET (simulating rotation)
    process.env.COOKIE_SECRET = "completely_different_cookie_secret_9999999999";
    process.env.SESSION_SECRET = "completely_different_session_secret_9999999999";

    // Decryption MUST succeed because ENCRYPTION_KEY remained stable!
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secretData);
  });

  it("3. Fallback decrypts legacy tokens encrypted with old SESSION_SECRET and detects fallback", async () => {
    // 1. Simulate legacy token encrypted with old session secret (no ENCRYPTION_KEY present)
    delete process.env.ENCRYPTION_KEY;
    const oldSessionSecret = "old_legacy_session_secret_32_chars_long_12345";
    process.env.SESSION_SECRET = oldSessionSecret;

    const legacyToken = "legacy_refresh_token_to_migrate";
    const legacyEncrypted = encryptSecret(legacyToken);

    // 2. Now introduce new dedicated ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = "new_dedicated_encryption_key_32_bytes_val!";
    
    // Decryption with fallback should succeed and report usedFallback = true
    const result = decryptSecretWithFallback(legacyEncrypted);
    expect(result.plainText).toBe(legacyToken);
    expect(result.usedFallback).toBe(true);

    // 3. Saving with new key creates ciphertext that decrypts with primary (usedFallback = false)
    const newEncrypted = encryptSecret(result.plainText);
    const newResult = decryptSecretWithFallback(newEncrypted);
    expect(newResult.plainText).toBe(legacyToken);
    expect(newResult.usedFallback).toBe(false);
  });

  it("4. Transient network error retries and throws DRIVE_TRANSIENT_ERROR without showing Reconnect banner", async () => {
    await saveAdminRefreshToken("valid_refresh_token_for_transient_test");
    invalidateAdminTokenCache();

    let attempts = 0;
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        attempts++;
        // Simulate network failure
        throw new TypeError("fetch failed: connection reset by peer");
      }
      return originalFetch(input, init);
    };

    // Calling getAdminAccessToken should retry 3 times and throw AdminDriveTransientError
    await expect(getAdminAccessToken(true)).rejects.toThrow(/Network error communicating with Google OAuth/);
    expect(attempts).toBe(3);

    // Verify it is NOT an AdminDriveError (ADMIN_DRIVE_NOT_CONNECTED)
    try {
      await getAdminAccessToken(true);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AdminDriveTransientError);
      expect(err.code).toBe("GOOGLE_TRANSIENT_ERROR");
      expect(err.code).not.toBe("ADMIN_DRIVE_NOT_CONNECTED");
    }

    // Direct endpoint call returns 503 DRIVE_TRANSIENT_ERROR, NOT ADMIN_DRIVE_NOT_CONNECTED
    const req = createFakeReq({ method: "GET", url: "/api/drive/status" });
    const { res, getCode, getBody } = createFakeRes();

    await driveHandler(req, res);
    expect(getCode()).toBe(200); // status endpoint returns health JSON
    const body = getBody();
    expect(body.status).toBe("transient_error");
    expect(body.code).not.toBe("ADMIN_DRIVE_NOT_CONNECTED");
  });

  it("5. Permanent error (invalid_grant) throws ADMIN_DRIVE_NOT_CONNECTED and sets disconnected status", async () => {
    await saveAdminRefreshToken("revoked_refresh_token");
    invalidateAdminTokenCache();

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    await expect(getAdminAccessToken(true)).rejects.toThrow(AdminDriveError);

    try {
      await getAdminAccessToken(true);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AdminDriveError);
      expect(err.code).toBe("ADMIN_DRIVE_NOT_CONNECTED");
    }

    // Health check reflects disconnected
    const health = await getAdminDriveHealth();
    expect(health.connected).toBe(false);
    expect(health.status).toBe("disconnected");
    expect(health.code).toBe("ADMIN_DRIVE_NOT_CONNECTED");
  });

  it("6. Missing row throws ADMIN_DRIVE_NOT_CONNECTED with TOKEN_MISSING", async () => {
    // Ensure no row exists
    await db.delete(settings).where(eq(settings.key, testSettingKey));
    delete process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
    invalidateAdminTokenCache();

    await expect(getAdminAccessToken(true)).rejects.toThrow(AdminDriveError);

    try {
      await getAdminAccessToken(true);
    } catch (err: any) {
      expect(err.code).toBe("ADMIN_DRIVE_NOT_CONNECTED");
    }
  });

  it("7. Preview environment isolation: VERCEL_ENV=preview uses preview settings key", async () => {
    delete process.env.ADMIN_TOKEN_SETTING_KEY;
    process.env.VERCEL_ENV = "preview";

    expect(getAdminTokenSettingKey()).toBe("admin_drive_refresh_token_preview");

    // Saving in preview writes to preview key, NOT production key
    await saveAdminRefreshToken("preview_test_token_123");

    const [previewRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "admin_drive_refresh_token_preview"))
      .limit(1);
    expect(previewRow).toBeDefined();

    // In production, key is admin_drive_refresh_token
    process.env.VERCEL_ENV = "production";
    expect(getAdminTokenSettingKey()).toBe("admin_drive_refresh_token");
  });

  it("8. Google token rotation: persists new refresh_token when returned, retains old when omitted", async () => {
    const initialToken = "initial_refresh_token_111";
    await saveAdminRefreshToken(initialToken);
    invalidateAdminTokenCache();

    const rotatedToken = "new_rotated_refresh_token_222";

    // 1. Google returns rotated token
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access_token_rotated",
            refresh_token: rotatedToken,
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    await getAdminAccessToken(true);

    // Wait microtask for async save
    await new Promise((r) => setTimeout(r, 50));

    const [updatedRow] = await db.select().from(settings).where(eq(settings.key, testSettingKey)).limit(1);
    expect(decryptSecret(updatedRow.valueEncrypted)).toBe(rotatedToken);

    // 2. Google subsequently returns access token WITHOUT refresh_token
    invalidateAdminTokenCache();
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "access_token_next",
            expires_in: 3600,
            // refresh_token is omitted
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    await getAdminAccessToken(true);
    await new Promise((r) => setTimeout(r, 50));

    // Stored token MUST still be rotatedToken, NOT overwritten or erased!
    const [retainedRow] = await db.select().from(settings).where(eq(settings.key, testSettingKey)).limit(1);
    expect(decryptSecret(retainedRow.valueEncrypted)).toBe(rotatedToken);
  });

  it("9. Daily cron endpoint /api/drive/cron refreshes token and returns 200 OK", async () => {
    await saveAdminRefreshToken("cron_test_refresh_token");
    invalidateAdminTokenCache();

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_cron_refreshed_access_token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    const req = createFakeReq({
      method: "GET",
      url: "/api/drive/cron",
      headers: { "x-vercel-cron": "1" },
    });
    const { res, getCode, getBody } = createFakeRes();

    await driveHandler(req, res);
    expect(getCode()).toBe(200);
    const body = getBody();
    expect(body.success).toBe(true);
    expect(body.status).toBe("connected");
  });
});
