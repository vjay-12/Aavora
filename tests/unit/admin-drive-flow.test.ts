import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptSecret, decryptSecret } from "../../server/crypto.js";
import {
  AdminDriveError,
  isInsideVault,
  assertInsideVault,
} from "../../server/drive.js";
import {
  createOAuthState,
  verifyOAuthState,
  maskEmail,
  OAUTH_STATE_COOKIE,
  createSessionToken,
} from "../../server/auth.js";
import { getEnv, getOAuthRedirectUri, normalizeAppUrl } from "../../server/env.js";
import { db } from "../../server/db/index.js";
import { settings } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";

describe("Admin Drive Flow: Crypto, Security & Vault Boundaries", () => {
  it("encryptSecret and decryptSecret successfully round-trip a refresh token", () => {
    const rawRefreshToken = "dummy_mock_secret_token_1234567890_xyz";
    const encrypted = encryptSecret(rawRefreshToken);

    expect(encrypted).not.toBe(rawRefreshToken);
    expect(encrypted.split(":")).toHaveLength(3); // iv:tag:ciphertext

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(rawRefreshToken);
  });

  it("decryptSecret rejects tampered ciphertext or wrong format", () => {
    expect(() => decryptSecret("invalid-format")).toThrow(/Invalid cipher text format/);
    expect(() => decryptSecret("1234:5678:9abc")).toThrow();
  });

  it("AdminDriveError has correct error code and message", () => {
    const err = new AdminDriveError("Vault Google Drive is not connected.", "ADMIN_DRIVE_NOT_CONNECTED");
    expect(err.code).toBe("ADMIN_DRIVE_NOT_CONNECTED");
    expect(err.message).toBe("Vault Google Drive is not connected.");
    expect(err.name).toBe("AdminDriveError");
  });

  it("maskEmail masks local part correctly", () => {
    expect(maskEmail("vhrbaskaran@gmail.com")).toBe("v***@gmail.com");
    expect(maskEmail("sairamyabaskaran@gmail.com")).toBe("s***@gmail.com");
    expect(maskEmail("a@domain.com")).toBe("a***@domain.com");
  });

  it("normalizeAppUrl trims trailing slashes and prevents mixing http/https", () => {
    expect(normalizeAppUrl("https://aavora.vercel.app/")).toBe("https://aavora.vercel.app");
    expect(normalizeAppUrl("https://aavora.vercel.app///")).toBe("https://aavora.vercel.app");
    expect(normalizeAppUrl("http://aavora.vercel.app/")).toBe("https://aavora.vercel.app");
    expect(normalizeAppUrl("http://localhost:5173/")).toBe("http://localhost:5173");
  });

  it("isInsideVault rejects 'root', 'me', and empty folder IDs", async () => {
    expect(await isInsideVault("root")).toBe(false);
    expect(await isInsideVault("ROOT")).toBe(false);
    expect(await isInsideVault("me")).toBe(false);
    expect(await isInsideVault("")).toBe(false);
  });

  it("assertInsideVault throws 403 error for items outside the vault tree", async () => {
    await expect(assertInsideVault("root")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(assertInsideVault("outside_foreign_folder_id_123", "mock_token")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("Admin connect endpoint rejects unauthenticated and non-admin users with 401/403", async () => {
    const connectHandler = (await import("../../api/admin/[action].js")).default;
    const env = getEnv();
    const memberEmail =
      env.ALLOWED_EMAILS.find((e) => e.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) ||
      "sairamyabaskaran@gmail.com";

    const createFakeRes = () => {
      let code = 200;
      const res: any = {
        setHeader: () => {},
        getHeader: () => null,
        end: () => {},
      };
      Object.defineProperty(res, "statusCode", {
        set(val) {
          code = val;
        },
        get() {
          return code;
        },
      });
      return res;
    };

    // 1. Unauthenticated request
    const unauthReq: any = {
      url: "/api/admin/drive/connect",
      headers: { host: "localhost:5173" },
    };
    const unauthRes = createFakeRes();
    await connectHandler(unauthReq, unauthRes);
    expect(unauthRes.statusCode).toBe(401);

    // 2. Member request
    const memberToken = await createSessionToken({
      id: 2,
      email: memberEmail,
      name: "Family Member",
      role: "member",
    });

    const memberReq: any = {
      url: "/api/admin/drive/connect",
      headers: { cookie: `aavora_session=${memberToken}`, host: "localhost:5173" },
    };
    const memberRes = createFakeRes();
    await connectHandler(memberReq, memberRes);
    expect(memberRes.statusCode).toBe(403);
  });

  it("Admin connect authorize URL contains login_hint, prompt, access_type, include_granted_scopes, and redirect_uri", async () => {
    const connectHandler = (await import("../../api/admin/[action].js")).default;
    const env = getEnv();

    const adminToken = await createSessionToken({
      id: 1,
      email: env.ADMIN_EMAIL,
      name: "Admin User",
      role: "admin",
    });

    let locationHeader = "";
    let setCookieHeader: string | string[] = "";
    let code = 200;

    const fakeRes: any = {
      setHeader(name: string, val: string | string[]) {
        if (name.toLowerCase() === "location") locationHeader = val as string;
        if (name.toLowerCase() === "set-cookie") setCookieHeader = val;
      },
      getHeader(name: string) {
        if (name.toLowerCase() === "location") return locationHeader;
        if (name.toLowerCase() === "set-cookie") return setCookieHeader;
        return null;
      },
      end: () => {},
    };
    Object.defineProperty(fakeRes, "statusCode", {
      set(val) {
        code = val;
      },
      get() {
        return code;
      },
    });

    const fakeReq: any = {
      url: "/api/admin/drive/connect",
      headers: { cookie: `aavora_session=${adminToken}`, host: "localhost:5173" },
    };

    await connectHandler(fakeReq, fakeRes);
    expect(code).toBe(302);
    expect(locationHeader).toBeTruthy();

    const authUrl = new URL(locationHeader);
    expect(authUrl.searchParams.get("login_hint")).toBe(env.ADMIN_EMAIL);
    expect(authUrl.searchParams.get("prompt")).toBe("select_account consent");
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("include_granted_scopes")).toBe("false");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(getOAuthRedirectUri());
    expect(authUrl.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/drive");

    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join(";") : String(setCookieHeader);
    expect(cookieStr).toContain(OAUTH_STATE_COOKIE);
    expect(cookieStr).toContain("admin-connect");
    expect(cookieStr).toContain("HttpOnly");
  });

  it("Normal login authorize URL contains prompt=select_account, no login_hint, and correct redirect_uri", async () => {
    const authHandler = (await import("../../api/auth/[action].js")).default;

    let locationHeader = "";
    let code = 200;

    const fakeRes: any = {
      setHeader(name: string, val: any) {
        if (name.toLowerCase() === "location") locationHeader = val;
      },
      getHeader: () => null,
      end: () => {},
    };
    Object.defineProperty(fakeRes, "statusCode", {
      set(val) {
        code = val;
      },
      get() {
        return code;
      },
    });

    const fakeReq: any = {
      url: "/api/auth/login",
      headers: { host: "localhost:5173" },
    };

    await authHandler(fakeReq, fakeRes);
    expect(code).toBe(302);
    const loginUrl = new URL(locationHeader);
    expect(loginUrl.searchParams.get("prompt")).toBe("select_account");
    expect(loginUrl.searchParams.has("login_hint")).toBe(false);
    expect(loginUrl.searchParams.get("redirect_uri")).toBe(getOAuthRedirectUri());
  });

  it("OAuth state verification rejects missing, tampered, expired, or cookie-mismatched state", () => {
    const { stateParam, cookieValue } = createOAuthState("admin-connect");

    // 1. Valid state and matching cookie
    const valid = verifyOAuthState(stateParam, cookieValue);
    expect(valid.valid).toBe(true);
    expect(valid.intent).toBe("admin-connect");

    // 2. Missing state
    expect(verifyOAuthState(null, cookieValue).valid).toBe(false);
    expect(verifyOAuthState("", cookieValue).valid).toBe(false);

    // 3. Tampered stateParam
    const tampered = stateParam.slice(0, -6) + "xyz123";
    expect(verifyOAuthState(tampered, cookieValue).valid).toBe(false);

    // 4. Mismatched cookie
    expect(verifyOAuthState(stateParam, "admin-connect:different-nonce").valid).toBe(false);

    // 5. Missing cookie
    expect(verifyOAuthState(stateParam, undefined).valid).toBe(false);
  });

  it("Admin connect callback with missing or invalid state is rejected", async () => {
    const authHandler = (await import("../../api/auth/[action].js")).default;

    const createFakeRes = () => {
      let location = "";
      let code = 200;
      const res: any = {
        setHeader(name: string, val: any) {
          if (name.toLowerCase() === "location") location = val;
        },
        getHeader: () => null,
        end: () => {},
      };
      Object.defineProperty(res, "statusCode", {
        set(val) {
          code = val;
        },
        get() {
          return code;
        },
      });
      return { res, getLocation: () => location, getCode: () => code };
    };

    // 1. Missing state in query param
    const { res: res1, getLocation: getLoc1, getCode: getCode1 } = createFakeRes();
    const req1: any = {
      url: "/api/auth/callback?code=mock_code",
      headers: { host: "localhost:5173", cookie: `${OAUTH_STATE_COOKIE}=admin-connect:nonce123` },
    };
    await authHandler(req1, res1);
    expect(getCode1()).toBe(302);
    expect(getLoc1()).toContain("invalid_state");

    // 2. Tampered state in query param
    const { stateParam, cookieValue } = createOAuthState("admin-connect");
    const { res: res2, getLocation: getLoc2, getCode: getCode2 } = createFakeRes();
    const req2: any = {
      url: `/api/auth/callback?code=mock_code&state=${encodeURIComponent(stateParam + "tampered")}`,
      headers: { host: "localhost:5173", cookie: `${OAUTH_STATE_COOKIE}=${cookieValue}` },
    };
    await authHandler(req2, res2);
    expect(getCode2()).toBe(302);
    expect(getLoc2()).toContain("invalid_state");
  });

  it("Callback with a non-admin email is rejected and stores nothing in settings table", async () => {
    const authHandler = (await import("../../api/auth/[action].js")).default;
    const env = getEnv();

    const { stateParam, cookieValue } = createOAuthState("admin-connect");

    const originalFetch = global.fetch;
    try {
      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;
        if (urlStr.includes("oauth2.googleapis.com/token")) {
          // Construct fake ID token payload with wrong email
          const fakeHeader = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
          const fakePayload = Buffer.from(
            JSON.stringify({
              email: "intruder_user@gmail.com",
              email_verified: true,
            })
          ).toString("base64url");
          const fakeIdToken = `${fakeHeader}.${fakePayload}.fake_sig`;

          return new Response(
            JSON.stringify({
              access_token: "mock_token_intruder",
              refresh_token: "mock_intruder_refresh_token",
              id_token: fakeIdToken,
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(input, init);
      };

      let redirectLocation = "";
      let code = 200;

      const fakeRes: any = {
        setHeader(name: string, val: any) {
          if (name.toLowerCase() === "location") redirectLocation = val;
        },
        getHeader: () => null,
        end: () => {},
      };
      Object.defineProperty(fakeRes, "statusCode", {
        set(val) {
          code = val;
        },
        get() {
          return code;
        },
      });

      const fakeReq: any = {
        url: `/api/auth/callback?code=mock_oauth_code&state=${encodeURIComponent(stateParam)}`,
        headers: {
          host: "localhost:5173",
          cookie: `${OAUTH_STATE_COOKIE}=${cookieValue}`,
        },
      };

      await authHandler(fakeReq, fakeRes);

      expect(code).toBe(302);
      expect(redirectLocation).toContain("/more?driveError=wrong_account");
      const masked = maskEmail(env.ADMIN_EMAIL);
      expect(decodeURIComponent(redirectLocation)).toContain(`Please connect with ${masked}`);

      // Confirm nothing was stored for intruder in settings
      const [stored] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "admin_drive_refresh_token"))
        .limit(1);

      if (stored?.valueEncrypted) {
        expect(decryptSecret(stored.valueEncrypted)).not.toBe("mock_intruder_refresh_token");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Callback when Google omits refresh_token displays permissions re-consent guidance", async () => {
    const authHandler = (await import("../../api/auth/[action].js")).default;
    const env = getEnv();

    const { stateParam, cookieValue } = createOAuthState("admin-connect");

    const originalFetch = global.fetch;
    try {
      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;
        if (urlStr.includes("oauth2.googleapis.com/token")) {
          const fakeHeader = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
          const fakePayload = Buffer.from(
            JSON.stringify({
              email: env.ADMIN_EMAIL,
              email_verified: true,
            })
          ).toString("base64url");
          const fakeIdToken = `${fakeHeader}.${fakePayload}.fake_sig`;

          return new Response(
            JSON.stringify({
              access_token: "mock_token_admin_no_refresh",
              id_token: fakeIdToken,
              expires_in: 3600,
              // No refresh_token!
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(input, init);
      };

      let redirectLocation = "";
      let code = 200;

      const fakeRes: any = {
        setHeader(name: string, val: any) {
          if (name.toLowerCase() === "location") redirectLocation = val;
        },
        getHeader: () => null,
        end: () => {},
      };
      Object.defineProperty(fakeRes, "statusCode", {
        set(val) {
          code = val;
        },
        get() {
          return code;
        },
      });

      const fakeReq: any = {
        url: `/api/auth/callback?code=mock_code&state=${encodeURIComponent(stateParam)}`,
        headers: {
          host: "localhost:5173",
          cookie: `${OAUTH_STATE_COOKIE}=${cookieValue}`,
        },
      };

      await authHandler(fakeReq, fakeRes);

      expect(code).toBe(302);
      expect(redirectLocation).toContain("/more?driveError=missing_refresh_token");
      expect(decodeURIComponent(redirectLocation)).toContain(
        "Google did not return a refresh token. Remove Aavora at myaccount.google.com/permissions and try again."
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Successful admin connect callback stores encrypted token and redirects to /home?driveConnected=true", async () => {
    const authHandler = (await import("../../api/auth/[action].js")).default;
    const env = getEnv();

    const { stateParam, cookieValue } = createOAuthState("admin-connect");
    const testSecretToken = "test_verified_admin_refresh_token_12345";

    const originalFetch = global.fetch;
    try {
      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;
        if (urlStr.includes("oauth2.googleapis.com/token")) {
          const fakeHeader = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
          const fakePayload = Buffer.from(
            JSON.stringify({
              email: env.ADMIN_EMAIL,
              email_verified: true,
            })
          ).toString("base64url");
          const fakeIdToken = `${fakeHeader}.${fakePayload}.fake_sig`;

          return new Response(
            JSON.stringify({
              access_token: "mock_access_token_admin",
              refresh_token: testSecretToken,
              id_token: fakeIdToken,
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(input, init);
      };

      let redirectLocation = "";
      let code = 200;

      const fakeRes: any = {
        setHeader(name: string, val: any) {
          if (name.toLowerCase() === "location") redirectLocation = val;
        },
        getHeader: () => null,
        end: () => {},
      };
      Object.defineProperty(fakeRes, "statusCode", {
        set(val) {
          code = val;
        },
        get() {
          return code;
        },
      });

      const fakeReq: any = {
        url: `/api/auth/callback?code=mock_code&state=${encodeURIComponent(stateParam)}`,
        headers: {
          host: "localhost:5173",
          cookie: `${OAUTH_STATE_COOKIE}=${cookieValue}`,
        },
      };

      await authHandler(fakeReq, fakeRes);

      expect(code).toBe(302);
      expect(redirectLocation).toBe("/home?driveConnected=true");

      // Verify encrypted token in settings table
      const [row] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "admin_drive_refresh_token"))
        .limit(1);

      expect(row).toBeDefined();
      expect(row.valueEncrypted).not.toBe(testSecretToken);
      expect(decryptSecret(row.valueEncrypted)).toBe(testSecretToken);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
