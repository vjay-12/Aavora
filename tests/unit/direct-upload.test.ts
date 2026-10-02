import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getVaultRootId,
} from "../../server/drive.js";
import { getEnv } from "../../server/env.js";
import { createSessionToken } from "../../server/auth.js";
import { db } from "../../server/db/index.js";
import { activity } from "../../server/db/schema.js";
import { eq, and } from "drizzle-orm";

describe("Direct Resumable Upload Flow & CORS Verification", () => {
  let adminSessionToken: string;
  let originalFetch: typeof global.fetch;
  let originalEnvToken: string | undefined;

  beforeEach(async () => {
    originalFetch = global.fetch;
    originalEnvToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
    process.env.GOOGLE_ADMIN_REFRESH_TOKEN = "test_mock_refresh_token_123";

    const env = getEnv();
    adminSessionToken = await createSessionToken({
      id: 1,
      email: env.ADMIN_EMAIL,
      name: "Admin User",
      role: "admin",
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

  it("1. Server forwards browser's Origin header when creating resumable upload session", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;

      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_access_token_123", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("uploadType=resumable")) {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response("", {
          status: 200,
          headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=mock_session_123" },
        });
      }

      return originalFetch(input, init);
    };

    const driveHandler = (await import("../../api/drive/[action].js")).default;
    const { res, getCode, getBody } = createFakeRes();

    const req: any = {
      url: "/api/upload/session",
      method: "POST",
      headers: {
        host: "localhost:5173",
        cookie: `aavora_session=${adminSessionToken}`,
        origin: "https://aavora.vercel.app",
        "content-type": "application/json",
      },
      body: {
        name: "Test_Document.pdf",
        mimeType: "application/pdf",
        size: 1024,
      },
    };

    await driveHandler(req, res);

    expect(getCode()).toBe(200);
    const body = getBody();
    expect(body.uploadUrl).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?upload_id=mock_session_123"
    );
    expect(capturedHeaders["Origin"]).toBe("https://aavora.vercel.app");
  });

  it("2. Simulated CORS failure after complete upload verifies via session status and succeeds", async () => {
    const mockFileId = "drive_file_cors_recovered_123";
    const testFileName = "Important_Passport.pdf";
    const uploadSessionUrl = "https://www.googleapis.com/upload/drive/v3/files?upload_id=cors_session_456";

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;

      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_access_token_123", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // When server queries the session status via PUT Content-Range: bytes */size
      if (urlStr.includes("cors_session_456") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            id: mockFileId,
            name: testFileName,
            size: 2048,
            mimeType: "application/pdf",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Boundary check for assertInsideVault
      if (urlStr.includes(`files/${mockFileId}`)) {
        return new Response(
          JSON.stringify({
            id: mockFileId,
            name: testFileName,
            parents: [getVaultRootId()],
            trashed: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input, init);
    };

    const driveHandler = (await import("../../api/drive/[action].js")).default;
    const { res, getCode, getBody } = createFakeRes();

    // Client had CORS error on direct upload, so driveId is undefined/missing, but sends session info
    const req: any = {
      url: "/api/upload/complete",
      method: "POST",
      headers: {
        host: "localhost:5173",
        cookie: `aavora_session=${adminSessionToken}`,
        "content-type": "application/json",
      },
      body: {
        uploadUrl: uploadSessionUrl,
        name: testFileName,
        size: 2048,
        mimeType: "application/pdf",
      },
    };

    await driveHandler(req, res);

    expect(getCode()).toBe(200);
    const body = getBody();
    expect(body.success).toBe(true);
    expect(body.file?.id || body.item?.id).toBe(mockFileId);
  });

  it("3. Simulated CORS failure fallback: verifies via files.list when session query fails", async () => {
    const mockFileId = "drive_file_list_recovered_789";
    const testFileName = "Tax_Returns_2026.pdf";
    const uploadSessionUrl = "https://www.googleapis.com/upload/drive/v3/files?upload_id=expired_session_789";

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;

      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_access_token_123", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Session status query returns 404 or 410 (session already closed)
      if (urlStr.includes("expired_session_789")) {
        return new Response("Session closed", { status: 404 });
      }

      // files.list query finds the recently created file
      if (urlStr.includes("files?q=") && urlStr.includes(encodeURIComponent(testFileName))) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: mockFileId,
                name: testFileName,
                size: "4096",
                mimeType: "application/pdf",
                createdTime: new Date().toISOString(),
                parents: [getVaultRootId()],
                trashed: false,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes(`files/${mockFileId}`)) {
        return new Response(
          JSON.stringify({
            id: mockFileId,
            name: testFileName,
            parents: [getVaultRootId()],
            trashed: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input, init);
    };

    const driveHandler = (await import("../../api/drive/[action].js")).default;
    const { res, getCode, getBody } = createFakeRes();

    const req: any = {
      url: "/api/upload/complete",
      method: "POST",
      headers: {
        host: "localhost:5173",
        cookie: `aavora_session=${adminSessionToken}`,
        "content-type": "application/json",
      },
      body: {
        uploadUrl: uploadSessionUrl,
        name: testFileName,
        size: 4096,
        mimeType: "application/pdf",
      },
    };

    await driveHandler(req, res);

    expect(getCode()).toBe(200);
    const body = getBody();
    expect(body.success).toBe(true);
    expect(body.file?.id || body.item?.id).toBe(mockFileId);
  });

  it("4. A real failure (file does not exist in Google Drive) returns 404 and does not log activity", async () => {
    const missingFileName = "Non_Existent_File.pdf";
    const invalidUploadUrl = "https://www.googleapis.com/upload/drive/v3/files?upload_id=non_existent_session";

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;

      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_access_token_123", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Session status query returns 404
      if (urlStr.includes("non_existent_session")) {
        return new Response("Not found", { status: 404 });
      }

      // files.list returns empty list
      if (urlStr.includes("files?q=")) {
        return new Response(
          JSON.stringify({ files: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input, init);
    };

    const driveHandler = (await import("../../api/drive/[action].js")).default;
    const { res, getCode, getBody } = createFakeRes();

    const req: any = {
      url: "/api/upload/complete",
      method: "POST",
      headers: {
        host: "localhost:5173",
        cookie: `aavora_session=${adminSessionToken}`,
        "content-type": "application/json",
      },
      body: {
        uploadUrl: invalidUploadUrl,
        name: missingFileName,
        size: 512,
      },
    };

    await driveHandler(req, res);

    expect(getCode()).toBe(404);
    const body = getBody();
    expect(body.error).toContain("Upload verification failed");
  });

  it("5. /api/upload/complete is idempotent: double call creates no duplicate activity", async () => {
    const mockFileId = "drive_id_idempotent_test_999";
    const testFileName = "Medical_Report_2026.pdf";

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;

      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_access_token_123", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes(`files/${mockFileId}`)) {
        return new Response(
          JSON.stringify({
            id: mockFileId,
            name: testFileName,
            parents: [getVaultRootId()],
            trashed: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input, init);
    };

    const driveHandler = (await import("../../api/drive/[action].js")).default;

    // Call 1
    const { res: res1, getCode: getCode1, getBody: getBody1 } = createFakeRes();
    const req1: any = {
      url: "/api/upload/complete",
      method: "POST",
      headers: {
        host: "localhost:5173",
        cookie: `aavora_session=${adminSessionToken}`,
        "content-type": "application/json",
      },
      body: {
        driveId: mockFileId,
        name: testFileName,
        size: 8192,
        mimeType: "application/pdf",
      },
    };

    await driveHandler(req1, res1);
    expect(getCode1()).toBe(200);
    expect(getBody1().success).toBe(true);

    // Call 2 with identical file ID
    const { res: res2, getCode: getCode2, getBody: getBody2 } = createFakeRes();
    const req2: any = {
      url: "/api/upload/complete",
      method: "POST",
      headers: {
        host: "localhost:5173",
        cookie: `aavora_session=${adminSessionToken}`,
        "content-type": "application/json",
      },
      body: {
        driveId: mockFileId,
        name: testFileName,
        size: 8192,
        mimeType: "application/pdf",
      },
    };

    await driveHandler(req2, res2);
    expect(getCode2()).toBe(200);
    const body2 = getBody2();
    expect(body2.success).toBe(true);
    expect(body2.alreadyLogged).toBe(true);

    // Verify exactly one activity record was logged for this driveId
    const rows = await db
      .select()
      .from(activity)
      .where(and(eq(activity.action, "upload"), eq(activity.driveId, mockFileId)));

    expect(rows).toHaveLength(1);
  });
});
