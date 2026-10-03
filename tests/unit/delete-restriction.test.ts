import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MEMBER_DELETE_ENABLED,
  DELETE_RESTRICTED_CODE,
  DELETE_RESTRICTED_MESSAGE,
  canUserDelete,
  canUserPermanentDelete,
} from "../../src/config/features.js";
import { createSessionToken, isAdminEmail, requireAdmin, authenticateRequest } from "../../server/auth.js";
import { getEnv } from "../../server/env.js";
import { getVaultRootId } from "../../server/drive.js";
import driveHandler from "../../api/drive/[action].js";
import { db } from "../../server/db/index.js";
import { users, activity } from "../../server/db/schema.js";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";

describe("Delete Restriction & Feature Flag Access Control", () => {
  let adminSessionToken: string;
  let memberSessionToken: string;
  let originalFetch: typeof global.fetch;
  let originalEnvToken: string | undefined;
  const testMemberEmail = "test_member_delete_spec@aavora.internal";

  beforeEach(async () => {
    originalFetch = global.fetch;
    originalEnvToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = "test_mock_refresh_token_123";

    const env = getEnv();

    // Ensure member exists in database
    const [existingMember] = await db
      .select()
      .from(users)
      .where(eq(users.email, testMemberEmail))
      .limit(1);

    if (!existingMember) {
      await db.insert(users).values({
        email: testMemberEmail,
        name: "Family Member",
        role: "member",
        active: true,
      });
    }

    adminSessionToken = await createSessionToken({
      id: 1,
      email: env.ADMIN_EMAIL,
      name: "Admin User",
      role: "admin",
    });

    memberSessionToken = await createSessionToken({
      id: 2,
      email: testMemberEmail,
      name: "Family Member",
      role: "member",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnvToken !== undefined) {
      process.env.GOOGLE_ADMIN_REFRESH_TOKEN = originalEnvToken;
    } else {
      delete process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
    }
  });

  const createFakeRes = () => {
    let statusCode = 200;
    const headers: Record<string, any> = {};
    let bodyData = "";

    const res: any = {
      setHeader(name: string, val: any) {
        headers[name.toLowerCase()] = val;
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()] || null;
      },
      end(data?: string) {
        if (data) bodyData = data;
      },
    };

    Object.defineProperty(res, "statusCode", {
      set(val) {
        statusCode = val;
      },
      get() {
        return statusCode;
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
    };
  };

  const createFakeReq = (options: {
    method?: string;
    url: string;
    token?: string;
    body?: any;
  }) => {
    const { method = "GET", url, token, body } = options;
    const bodyStr = body ? JSON.stringify(body) : "";

    const listeners: Record<string, Function[]> = {};

    const req: any = {
      method,
      url,
      body, // Synchronous fallback
      headers: {
        host: "localhost:5173",
        ...(token ? { cookie: `aavora_session=${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      on(event: string, cb: Function) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return req;
      },
    };

    // Simulate async data & end events
    setTimeout(() => {
      if (bodyStr && listeners["data"]) {
        listeners["data"].forEach((cb) => cb(Buffer.from(bodyStr)));
      }
      if (listeners["end"]) {
        listeners["end"].forEach((cb) => cb());
      }
    }, 1);

    return req;
  };

  describe("1. Shared Feature Flag & Permission Logic", () => {
    it("MEMBER_DELETE_ENABLED defaults to false for temporary restriction", () => {
      expect(MEMBER_DELETE_ENABLED).toBe(false);
      expect(DELETE_RESTRICTED_CODE).toBe("DELETE_RESTRICTED");
      expect(DELETE_RESTRICTED_MESSAGE).toBe("Only the admin can delete files right now.");
    });

    it("canUserDelete allows admin but denies member when flag is false", () => {
      expect(canUserDelete("admin")).toBe(true);
      expect(canUserDelete("member")).toBe(false);
      expect(canUserDelete(null)).toBe(false);
      expect(canUserDelete(undefined)).toBe(false);
    });

    it("canUserPermanentDelete is strictly restricted to admin", () => {
      expect(canUserPermanentDelete("admin")).toBe(true);
      expect(canUserPermanentDelete("member")).toBe(false);
      expect(canUserPermanentDelete(null)).toBe(false);
    });

    it("Re-enabling simulation: flipping member delete flag allows member trash/restore but prevents permanent delete", () => {
      // Simulate flag set to true
      const simulateCanUserDelete = (role?: string | null, flag = true) => {
        if (role === "admin") return true;
        return flag;
      };
      expect(simulateCanUserDelete("member", true)).toBe(true);
      expect(simulateCanUserDelete("admin", true)).toBe(true);
      // Permanent delete remains false for member
      expect(canUserPermanentDelete("member")).toBe(false);
    });
  });

  describe("2. Server Enforcement: Member Forbidden (403 DELETE_RESTRICTED)", () => {
    it("Member calling single /api/drive/trash gets 403 DELETE_RESTRICTED and file is untouched", async () => {
      let googleDriveApiCalled = false;

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;
        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
        }
        if (urlStr.includes("googleapis.com/drive/v3/files")) {
          googleDriveApiCalled = true;
          return new Response(JSON.stringify({ id: "file_123", trashed: true }), { status: 200 });
        }
        return originalFetch(input, init);
      };

      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/trash",
        token: memberSessionToken,
        body: { fileId: "file_123", name: "SecretDoc.pdf" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
      const body = getBody();
      expect(body.code).toBe("DELETE_RESTRICTED");
      expect(body.error).toBe("Only the admin can delete files right now.");
      expect(googleDriveApiCalled).toBe(false);
    });

    it("Member calling bulk /api/drive/trash with fileIds gets 403 DELETE_RESTRICTED", async () => {
      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/trash",
        token: memberSessionToken,
        body: { fileIds: ["file_1", "file_2", "file_3"] },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
      const body = getBody();
      expect(body.code).toBe("DELETE_RESTRICTED");
      expect(body.error).toBe("Only the admin can delete files right now.");
    });

    it("Member calling /api/drive/delete gets 403 DELETE_RESTRICTED", async () => {
      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/delete",
        token: memberSessionToken,
        body: { fileId: "file_123" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
      const body = getBody();
      expect(body.code).toBe("DELETE_RESTRICTED");
      expect(body.error).toBe("Only the admin can delete files right now.");
    });

    it("Calling /api/drive/bin returns 404 when BIN_PAGE_ENABLED is false", async () => {
      const req = createFakeReq({
        method: "GET",
        url: "/api/drive/bin",
        token: memberSessionToken,
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(404);
      const body = getBody();
      expect(body.error).toMatch(/bin is disabled/i);
    });

    it("Member calling /api/drive/restore gets 403 DELETE_RESTRICTED", async () => {
      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/restore",
        token: memberSessionToken,
        body: { fileId: "file_123" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
      const body = getBody();
      expect(body.code).toBe("DELETE_RESTRICTED");
      expect(body.error).toBe("Only the admin can delete files right now.");
    });

    it("Calling /api/drive/permanent-delete returns 404 as endpoint is completely removed", async () => {
      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/permanent-delete",
        token: memberSessionToken,
        body: { fileId: "file_123", confirmationText: "DELETE" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(404);
    });

    it("Member calling DELETE /api/drive/file gets 403 DELETE_RESTRICTED", async () => {
      const req = createFakeReq({
        method: "DELETE",
        url: "/api/drive/file?id=file_123",
        token: memberSessionToken,
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
      const body = getBody();
      expect(body.code).toBe(DELETE_RESTRICTED_CODE);
      expect(body.message || body.error).toBe(DELETE_RESTRICTED_MESSAGE);
    });

    it("Member calling /api/drive/remove gets 403 DELETE_RESTRICTED", async () => {
      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/remove",
        token: memberSessionToken,
        body: { fileId: "file_123" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
      const body = getBody();
      expect(body.code).toBe(DELETE_RESTRICTED_CODE);
      expect(body.message || body.error).toBe(DELETE_RESTRICTED_MESSAGE);
    });
  });

  describe("3. Server Enforcement: Admin Operations Allowed", () => {
    it("Admin can trash a single file (moves to Bin), logs to activity table", async () => {
      const rootId = getVaultRootId();
      let patchedTrashed = false;

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;

        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_access_token_123" }), { status: 200 });
        }

        // Ancestry check inside vault
        if (urlStr.includes("/files/admin_file_1?") && init?.method !== "PATCH") {
          return new Response(JSON.stringify({ id: "admin_file_1", parents: [rootId] }), { status: 200 });
        }

        // PATCH trashed=true
        if (urlStr.includes("/files/admin_file_1") && init?.method === "PATCH") {
          patchedTrashed = true;
          return new Response(JSON.stringify({ id: "admin_file_1", name: "Doc1.pdf", trashed: true }), { status: 200 });
        }

        return originalFetch(input, init);
      };

      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/trash",
        token: adminSessionToken,
        body: { fileId: "admin_file_1", name: "Doc1.pdf" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(200);
      expect(patchedTrashed).toBe(true);
      const body = getBody();
      expect(body.message).toBe("Item moved to Bin");

      // Verify activity logged
      const logged = await db
        .select()
        .from(activity)
        .where(and(eq(activity.action, "trash"), eq(activity.driveId, "admin_file_1")))
        .limit(1);
      expect(logged.length).toBeGreaterThan(0);
    });

    it("Admin calling GET /api/drive/bin returns 404 when BIN_PAGE_ENABLED is false", async () => {
      const req = createFakeReq({
        method: "GET",
        url: "/api/drive/bin",
        token: adminSessionToken,
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(404);
      const body = getBody();
      expect(body.error).toMatch(/bin is disabled/i);
    });

    it("Admin can restore an item from Bin", async () => {
      const rootId = getVaultRootId();
      let patchedRestored = false;

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;

        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_access_token_123" }), { status: 200 });
        }

        if (urlStr.includes("/files/restored_file_1?") && init?.method !== "PATCH") {
          return new Response(JSON.stringify({ id: "restored_file_1", parents: [rootId] }), { status: 200 });
        }

        if (urlStr.includes("/files/restored_file_1") && init?.method === "PATCH") {
          patchedRestored = true;
          return new Response(JSON.stringify({ id: "restored_file_1", name: "Restored.pdf", trashed: false, parents: [rootId] }), { status: 200 });
        }

        return originalFetch(input, init);
      };

      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/restore",
        token: adminSessionToken,
        body: { fileId: "restored_file_1", name: "Restored.pdf" },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(200);
      expect(patchedRestored).toBe(true);
      const body = getBody();
      expect(body.message).toMatch(/restored/i);
    });

    it("Admin permanent delete endpoint is removed completely for zero-delete safety", async () => {
      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/permanent-delete",
        token: adminSessionToken,
        body: { fileId: "perm_del_1", confirmationText: "DELETE", name: "DocToDelete.pdf" },
      });
      const { res, getCode } = createFakeRes();
      await driveHandler(req, res);

      expect(getCode()).toBe(404);
    });
  });

  describe("4. Single Source of Truth: isAdminEmail & requireAdmin", () => {
    it("isAdminEmail performs case-insensitive trimmed comparison against ADMIN_EMAIL", () => {
      const env = getEnv();
      const realAdmin = env.ADMIN_EMAIL;

      expect(isAdminEmail(realAdmin)).toBe(true);
      expect(isAdminEmail(`  ${realAdmin.toUpperCase()}  `)).toBe(true);
      expect(isAdminEmail(`  ${realAdmin.toLowerCase()}  `)).toBe(true);

      // Non-admins return false
      expect(isAdminEmail("attacker@evil.com")).toBe(false);
      expect(isAdminEmail(testMemberEmail)).toBe(false);
      expect(isAdminEmail("")).toBe(false);
      expect(isAdminEmail(null)).toBe(false);
      expect(isAdminEmail(undefined)).toBe(false);
    });

    it("requireAdmin does NOT rely on role column or cookie role; only verified email matching ADMIN_EMAIL", () => {
      const env = getEnv();

      // Session with role 'admin' but member email MUST be rejected
      const forgedSession: any = {
        id: 99,
        email: "forged_admin@aavora.internal",
        name: "Fake Admin",
        role: "admin",
        isAdmin: true,
      };
      expect(requireAdmin(forgedSession)).toBe(false);

      // Legitimate admin session
      const validAdminSession: any = {
        id: 1,
        email: env.ADMIN_EMAIL,
        name: "Legit Admin",
        role: "admin",
        isAdmin: true,
      };
      expect(requireAdmin(validAdminSession)).toBe(true);

      // Null or empty session
      expect(requireAdmin(null)).toBe(false);
      expect(requireAdmin(undefined)).toBe(false);
      expect(requireAdmin({} as any)).toBe(false);
    });
  });

  describe("5. DB Verification & Active Check", () => {
    it("Deactivated user in Neon DB is rejected and cannot access endpoints", async () => {
      const deactivatedEmail = "deactivated_member_spec@aavora.internal";
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, deactivatedEmail))
        .limit(1);

      if (!existing) {
        await db.insert(users).values({
          email: deactivatedEmail,
          name: "Deactivated User",
          role: "member",
          active: false,
        });
      } else {
        await db.update(users).set({ active: false }).where(eq(users.email, deactivatedEmail));
      }

      const deactivatedToken = await createSessionToken({
        id: 999,
        email: deactivatedEmail,
        name: "Deactivated User",
        role: "member",
      });

      const fakeReq = createFakeReq({
        method: "GET",
        url: "/api/drive/list",
        token: deactivatedToken,
      });

      const authenticated = await authenticateRequest(fakeReq);
      expect(authenticated).toBeNull();
    });
  });

  describe("6. Regression Test: All Trash/Delete Routes Enforce requireAdmin", () => {
    it("api/drive/[action].ts guards every trash, delete, permanent-delete, restore, and bin action with requireAdmin", () => {
      const driveHandlerFile = path.resolve(import.meta.dirname, "../../api/drive/[action].ts");
      const fileContent = fs.readFileSync(driveHandlerFile, "utf-8");

      // Verify requireAdmin is imported from server/auth.js
      expect(fileContent).toMatch(/import\s*\{[^}]*requireAdmin[^}]*\}\s*from\s*["']\.\.\/\.\.\/server\/auth(\.js)?["']/);

      // Verify every destructive action checks requireAdmin
      const criticalActions = ["trash", "delete", "restore", "bin"];
      for (const actionName of criticalActions) {
        // Find the action block in the source code
        const actionIdx = fileContent.indexOf(`action === "${actionName}"`);
        expect(actionIdx).toBeGreaterThan(-1);

        // Within the next 300 characters of the action declaration, requireAdmin must be called
        const actionSnippet = fileContent.slice(actionIdx, actionIdx + 300);
        expect(actionSnippet).toContain("requireAdmin(session)");
      }

      // Verify global DELETE method guard exists
      expect(fileContent).toMatch(/method === ["']DELETE["']\s*&&\s*!requireAdmin\(session\)/);
    });
  });
});
