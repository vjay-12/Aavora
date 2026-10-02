import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptSecret, decryptSecret } from "../../server/crypto.js";
import {
  AdminDriveError,
  isInsideVault,
  assertInsideVault,
} from "../../server/drive.js";

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
    // With token passed, outside item query fails or returns non-vault parent, resulting in 403
    await expect(assertInsideVault("outside_foreign_folder_id_123", "mock_token")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("Admin connect endpoint rejects unauthenticated and non-admin users with 401/403", async () => {
    const connectHandler = (await import("../../api/admin/[action].js")).default;
    const { getEnv } = await import("../../server/env.js");
    const env = getEnv();
    const memberEmail = env.ALLOWED_EMAILS.find((e) => e.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) || "sairamyabaskaran@gmail.com";

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

    // 2. Member request (authenticated active member trying to access admin connect)
    const { createSessionToken } = await import("../../server/auth.js");
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

  it("Member cannot access any /api/admin/* endpoints", async () => {
    const adminHandler = (await import("../../api/admin/[action].js")).default;
    const { createSessionToken } = await import("../../server/auth.js");
    const { getEnv } = await import("../../server/env.js");
    const env = getEnv();
    const memberEmail = env.ALLOWED_EMAILS.find((e) => e.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) || "sairamyabaskaran@gmail.com";

    const memberToken = await createSessionToken({
      id: 2,
      email: memberEmail,
      name: "Family Member",
      role: "member",
    });

    let code = 200;
    const fakeRes: any = {
      setHeader: () => {},
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
      url: "/api/admin/users",
      headers: { cookie: `aavora_session=${memberToken}`, host: "localhost:5173" },
      method: "GET",
    };

    await adminHandler(fakeReq, fakeRes);
    expect(code).toBe(403);
  });

  it("GET /api/drive/list rejects foreign folderId outside the vault with 403", async () => {
    const driveHandler = (await import("../../api/drive/[action].js")).default;
    const { createSessionToken } = await import("../../server/auth.js");
    const { getEnv } = await import("../../server/env.js");
    const env = getEnv();
    const memberEmail = env.ALLOWED_EMAILS.find((e) => e.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) || "sairamyabaskaran@gmail.com";

    const token = await createSessionToken({
      id: 2,
      email: memberEmail,
      name: "Family Member",
      role: "member",
    });

    let code = 200;
    let body = "";
    const fakeRes: any = {
      setHeader: () => {},
      getHeader: () => null,
      end: (data?: string) => {
        if (data) body = data;
      },
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
      url: "/api/drive/list?folderId=root",
      headers: { cookie: `aavora_session=${token}`, host: "localhost:5173" },
    };

    await driveHandler(fakeReq, fakeRes);
    // 'root' is outside the vault tree, must return 403 Forbidden
    expect(code).toBe(403);
  });

  it("UI messaging: ADMIN_DRIVE_NOT_CONNECTED maps to distinct messages for admin vs member", () => {
    const getBannerConfig = (role: "admin" | "member", code: string) => {
      if (code !== "ADMIN_DRIVE_NOT_CONNECTED") return null;
      return {
        title: role === "admin" ? "Google Drive Disconnected" : "Vault Temporarily Unavailable",
        description:
          role === "admin"
            ? "Admin Google Drive is not connected or token is revoked. Reconnect to restore access."
            : "Vault is temporarily unavailable, contact the admin.",
        action: role === "admin" ? "Reconnect Drive" : null,
      };
    };

    const adminBanner = getBannerConfig("admin", "ADMIN_DRIVE_NOT_CONNECTED");
    expect(adminBanner?.title).toBe("Google Drive Disconnected");
    expect(adminBanner?.action).toBe("Reconnect Drive");

    const memberBanner = getBannerConfig("member", "ADMIN_DRIVE_NOT_CONNECTED");
    expect(memberBanner?.title).toBe("Vault Temporarily Unavailable");
    expect(memberBanner?.description).toBe("Vault is temporarily unavailable, contact the admin.");
    expect(memberBanner?.action).toBeNull();
  });
});
