import "dotenv/config";
import { getEnv } from "../server/env.js";
import { createSessionToken, COOKIE_NAME } from "../server/auth.js";
import driveListHandler from "../api/drive/[action].js";
import { invalidateAdminTokenCache, invalidateVaultCache } from "../server/drive.js";
import { EventEmitter } from "events";

export async function testDriveConnection() {
  console.log("=================================================");
  console.log("    GOOGLE DRIVE CONNECTION & SECURITY SUITE     ");
  console.log("=================================================\n");

  const env = getEnv();
  let totalPassed = 0;
  let totalFailed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      totalPassed++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ""}`);
      totalFailed++;
    }
  }

  // Ensure test environment has a mock admin refresh token fallback
  process.env.GOOGLE_ADMIN_REFRESH_TOKEN = process.env.GOOGLE_ADMIN_REFRESH_TOKEN || "mock_admin_refresh_token_for_tests";

  // Helper to create mock HTTP request and response
  function createMockHttp(url: string, cookieToken?: string) {
    const req: any = new EventEmitter();
    req.url = url;
    req.headers = {
      host: "localhost:5173",
      cookie: cookieToken ? `${COOKIE_NAME}=${cookieToken}` : undefined,
    };
    req.method = "GET";

    const resHeaders: Record<string, string | string[]> = {};
    let responseBody = "";
    let statusCode = 200;

    const res: any = {
      statusCode,
      setHeader(name: string, val: string | string[]) {
        resHeaders[name.toLowerCase()] = val;
      },
      getHeader(name: string) {
        return resHeaders[name.toLowerCase()];
      },
      end(chunk?: string) {
        if (chunk) responseBody += chunk;
        this.emit("finish");
      },
    };
    Object.setPrototypeOf(res, EventEmitter.prototype);

    return {
      req,
      res,
      waitFinish: () =>
        new Promise<{ status: number; headers: Record<string, any>; body: any }>((resolve) => {
          res.on("finish", () => {
            let parsed = responseBody;
            try {
              parsed = JSON.parse(responseBody);
            } catch {}
            resolve({ status: res.statusCode, headers: resHeaders, body: parsed });
          });
        }),
    };
  }

  // 1. Setup valid session token
  const validSession = await createSessionToken({
    id: 1,
    email: env.ADMIN_EMAIL,
    name: "Admin User",
    role: "admin",
  });

  // Mock global fetch to spy and simulate Google Drive API
  const originalFetch = global.fetch;
  let driveRequestCount = 0;
  const mockedDriveFiles = [
    {
      id: "file-xyz-123",
      name: "Passport.pdf",
      mimeType: "application/pdf",
      size: "2048576",
      modifiedTime: "2026-09-01T12:00:00Z",
      lastModifyingUser: { displayName: "Vijay Baskaran" },
      parents: [env.GOOGLE_DRIVE_ROOT_FOLDER_ID],
    },
    {
      id: "folder-taxes-456",
      name: "Taxes & Finance",
      mimeType: "application/vnd.google-apps.folder",
      modifiedTime: "2026-09-02T10:00:00Z",
      lastModifyingUser: { displayName: "Vijay Baskaran" },
      parents: [env.GOOGLE_DRIVE_ROOT_FOLDER_ID],
    },
    {
      id: "file-abc-789",
      name: "Bank_Statement_2026.pdf",
      mimeType: "application/pdf",
      size: "1024000",
      modifiedTime: "2026-09-03T15:30:00Z",
      lastModifyingUser: { displayName: "Vijay Baskaran" },
      parents: [env.GOOGLE_DRIVE_ROOT_FOLDER_ID],
    },
  ];

  try {
    invalidateAdminTokenCache();
    invalidateVaultCache();

    // TEST 1: Root Drive list call
    console.log("1. Testing GET /api/drive/list on root folder...");
    driveRequestCount = 0;

    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_test_access_token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("googleapis.com/drive/v3/files")) {
        driveRequestCount++;
        return new Response(
          JSON.stringify({
            files: mockedDriveFiles,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    const mockRoot = createMockHttp("/api/drive/list", validSession);
    driveListHandler(mockRoot.req, mockRoot.res);
    const rootResult = await mockRoot.waitFinish();

    assert(rootResult.status === 200, "Root list returns 200 OK");
    assert(rootResult.body.rootFolderId === env.GOOGLE_DRIVE_ROOT_FOLDER_ID, "Root folder ID matches GOOGLE_DRIVE_ROOT_FOLDER_ID");
    assert(driveRequestCount === 1, `Exactly ONE Drive request is made for list call (actual count: ${driveRequestCount})`);

    const items = rootResult.body.items || [];
    assert(items.length === 3, "Returns all items");
    assert(items[0].isFolder === true && items[0].name === "Taxes & Finance", "Folders returned first (Taxes & Finance is first)");
    assert(items[1].isFolder === false && items[2].isFolder === false, "Files returned after folders");

    const firstFile = items.find((i: any) => !i.isFolder);
    assert(
      !!firstFile.id &&
      !!firstFile.name &&
      !!firstFile.mimeType &&
      !!firstFile.size &&
      !!firstFile.modifiedTime &&
      !!firstFile.lastModifyingUser,
      "Items include id, name, mimeType, size, modifiedTime, lastModifyingUser"
    );

    // TEST 2: Navigating into known child folder makes only ONE Drive request
    console.log("\n2. Testing subfolder navigation within root tree...");
    driveRequestCount = 0;
    const mockChild = createMockHttp("/api/drive/list?folderId=folder-taxes-456", validSession);
    driveListHandler(mockChild.req, mockChild.res);
    const childResult = await mockChild.waitFinish();
    assert(childResult.status === 200, "Child folder in root tree returns 200 OK");
    assert(driveRequestCount === 1, `Subfolder in root tree makes only ONE Drive request (actual: ${driveRequestCount})`);

    // TEST 3: FolderId outside the root tree is rejected with 403
    console.log("\n3. Testing boundary check: Folder outside root tree...");
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_test_access_token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // files/{folderId} inspect call
      if (urlStr.includes("googleapis.com/drive/v3/files/foreign-folder-outside-tree")) {
        return new Response(
          JSON.stringify({
            id: "foreign-folder-outside-tree",
            name: "Foreign Folder",
            parents: ["some-completely-unrelated-drive-id-999"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    const mockForeign = createMockHttp("/api/drive/list?folderId=foreign-folder-outside-tree", validSession);
    driveListHandler(mockForeign.req, mockForeign.res);
    const foreignResult = await mockForeign.waitFinish();
    assert(
      foreignResult.status === 403,
      "FolderId outside root tree is rejected with 403 Forbidden",
      `Got status: ${foreignResult.status}`
    );

    // TEST 4: Invalid folderId handled with 404
    console.log("\n4. Testing invalid folderId (404 handling)...");
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_test_access_token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("googleapis.com/drive/v3/files/nonexistent-folder-id")) {
        return new Response(
          JSON.stringify({ error: { message: "File not found: nonexistent-folder-id", code: 404 } }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    const mock404 = createMockHttp("/api/drive/list?folderId=nonexistent-folder-id", validSession);
    driveListHandler(mock404.req, mock404.res);
    const res404 = await mock404.waitFinish();
    assert(res404.status === 404, "Invalid folderId returns 404 Not Found");

    // TEST 5: Silent token retrieval / caching
    console.log("\n5. Testing admin token retrieval and refresh...");
    invalidateAdminTokenCache();
    let tokenEndpointCalled = false;
    global.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        tokenEndpointCalled = true;
        return new Response(
          JSON.stringify({
            access_token: "newly_refreshed_google_access_token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("googleapis.com/drive/v3/files")) {
        return new Response(
          JSON.stringify({ files: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };

    const mockRefresh = createMockHttp("/api/drive/list", validSession);
    driveListHandler(mockRefresh.req, mockRefresh.res);
    const refreshResult = await mockRefresh.waitFinish();

    assert(refreshResult.status === 200, "Request succeeds with admin drive token");
    assert(tokenEndpointCalled, "Google token endpoint was called to retrieve admin access token");

    // TEST 6: Revoked or invalid admin refresh token returns 503 ADMIN_DRIVE_NOT_CONNECTED
    console.log("\n6. Testing revoked admin refresh token...");
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

    const mockRevoked = createMockHttp("/api/drive/list", validSession);
    driveListHandler(mockRevoked.req, mockRevoked.res);
    const revokedResult = await mockRevoked.waitFinish();

    assert(revokedResult.status === 503, "Revoked admin token returns 503 Service Unavailable");
    assert(
      revokedResult.body?.code === "ADMIN_DRIVE_NOT_CONNECTED",
      "Revoked admin token returns error code ADMIN_DRIVE_NOT_CONNECTED"
    );

  } finally {
    global.fetch = originalFetch;
    invalidateAdminTokenCache();
    invalidateVaultCache();
  }

  console.log("\n=================================================");
  console.log(`DRIVE CONNECTION RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log("=================================================\n");

  if (totalFailed > 0) process.exit(1);
}

testDriveConnection().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
