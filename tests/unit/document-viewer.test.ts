import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv } from "../../server/env.js";
import { createSessionToken } from "../../server/auth.js";
import { getVaultRootId } from "../../server/drive.js";
import driveHandler from "../../api/drive/[action].js";

describe("Document Viewer & File Streaming (/api/drive/file)", () => {
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
    const chunks: any[] = [];

    const res: any = {
      setHeader(name: string, val: any) {
        headers[name.toLowerCase()] = val;
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()] || null;
      },
      write(chunk: any) {
        chunks.push(chunk);
      },
      end(data?: any) {
        if (data) chunks.push(data);
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
      getHeader: (name: string) => headers[name.toLowerCase()],
      getHeaders: () => headers,
      getBody: () => {
        const fullBuf = Buffer.concat(
          chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : Buffer.isBuffer(c) ? c : Buffer.from(c)))
        );
        const str = fullBuf.toString("utf-8");
        try {
          return JSON.parse(str);
        } catch {
          return str;
        }
      },
      getBuffer: () =>
        Buffer.concat(
          chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : Buffer.isBuffer(c) ? c : Buffer.from(c)))
        ),
    };
  };

  const createFakeReq = (options: {
    method?: string;
    url: string;
    token?: string;
    headers?: Record<string, string>;
  }) => {
    const { method = "GET", url, token, headers = {} } = options;

    const reqHeaders: Record<string, string> = {
      host: "localhost:5173",
      ...headers,
    };

    if (token) {
      reqHeaders["cookie"] = `aavora_session=${token}`;
    }

    const listeners: Record<string, Function[]> = {};

    const req: any = {
      method,
      url,
      headers: reqHeaders,
      on(event: string, handler: Function) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
        if (event === "end") {
          setTimeout(() => handler(), 0);
        }
        return req;
      },
    };

    return req;
  };

  it("returns 401 Unauthorized for missing or unauthenticated session", async () => {
    const req = createFakeReq({
      url: "/api/drive/file?id=file123",
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(401);
    expect(fakeRes.getBody()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 401 Unauthorized for tampered session token", async () => {
    const req = createFakeReq({
      url: "/api/drive/file?id=file123",
      token: "invalid.tampered.token",
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(401);
  });

  it("returns 400 Bad Request if file id is missing", async () => {
    const req = createFakeReq({
      url: "/api/drive/file",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(400);
    expect(fakeRes.getBody()).toMatchObject({ error: "Missing file ID" });
  });

  it("returns 403 Forbidden if file is outside vault root hierarchy", async () => {
    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      // Mock Drive get file parents - returns outside parent
      if (urlStr.includes("/files/outside_file_id")) {
        return new Response(
          JSON.stringify({
            id: "outside_file_id",
            name: "Secret.pdf",
            mimeType: "application/pdf",
            parents: ["random_unknown_root_folder"],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("/files/random_unknown_root_folder")) {
        return new Response(
          JSON.stringify({
            id: "random_unknown_root_folder",
            name: "Other Folder",
            mimeType: "application/vnd.google-apps.folder",
            parents: [],
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=outside_file_id",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(403);
    expect(fakeRes.getBody().error).toContain("vault");
  });

  it("returns 404 if file does not exist in Google Drive", async () => {
    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/non_existent_id")) {
        return new Response(JSON.stringify({ error: { code: 404, message: "File not found" } }), { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=non_existent_id",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(404);
  });

  it("serves mode=view with Content-Disposition: inline and security headers", async () => {
    const rootId = getVaultRootId();
    const testBytes = Buffer.from("fake-png-image-bytes-content");

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/sample_png_id?fields=") || urlStr.includes("/files/sample_png_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "sample_png_id",
            name: "chart.png",
            mimeType: "image/png",
            size: testBytes.length.toString(),
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("/files/sample_png_id?alt=media")) {
        return new Response(testBytes, {
          status: 200,
          headers: {
            "Content-Length": testBytes.length.toString(),
            "Content-Type": "image/png",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=sample_png_id&mode=view",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(200);
    expect(fakeRes.getHeader("content-type")).toBe("image/png");
    expect(fakeRes.getHeader("content-disposition")).toContain("inline");
    expect(fakeRes.getHeader("content-disposition")).toContain('filename="chart.png"');
    expect(fakeRes.getHeader("cache-control")).toBe("private, no-store");
    expect(fakeRes.getHeader("x-content-type-options")).toBe("nosniff");
    expect(fakeRes.getHeader("x-frame-options")).toBe("SAMEORIGIN");
    expect(fakeRes.getHeader("content-security-policy")).toBe("frame-ancestors 'self';");
    expect(fakeRes.getHeader("accept-ranges")).toBe("bytes");
    expect(fakeRes.getBuffer().toString("utf-8")).toBe("fake-png-image-bytes-content");
  });

  it("serves mode=download with Content-Disposition: attachment", async () => {
    const rootId = getVaultRootId();
    const testBytes = Buffer.from("fake-pdf-content");

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/sample_pdf_id?fields=") || urlStr.includes("/files/sample_pdf_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "sample_pdf_id",
            name: "invoice.pdf",
            mimeType: "application/pdf",
            size: testBytes.length.toString(),
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("/files/sample_pdf_id?alt=media")) {
        return new Response(testBytes, {
          status: 200,
          headers: {
            "Content-Length": testBytes.length.toString(),
            "Content-Type": "application/pdf",
          },
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=sample_pdf_id&mode=download",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(200);
    expect(fakeRes.getHeader("content-type")).toBe("application/pdf");
    expect(fakeRes.getHeader("content-disposition")).toContain("attachment");
    expect(fakeRes.getHeader("content-disposition")).toContain('filename="invoice.pdf"');
  });

  it("falls back to file extension only if mimeType is application/octet-stream", async () => {
    const rootId = getVaultRootId();
    const testBytes = Buffer.from("sample-jpeg-binary");

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/sample_octet_id?fields=") || urlStr.includes("/files/sample_octet_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "sample_octet_id",
            name: "family_photo.jpeg",
            mimeType: "application/octet-stream", // Untrusted generic mimeType
            size: testBytes.length.toString(),
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("/files/sample_octet_id?alt=media")) {
        return new Response(testBytes, {
          status: 200,
          headers: {
            "Content-Length": testBytes.length.toString(),
          },
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=sample_octet_id&mode=view",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(200);
    expect(fakeRes.getHeader("content-type")).toBe("image/jpeg");
  });

  it("supports Range requests and returns 206 Partial Content", async () => {
    const rootId = getVaultRootId();
    const chunkBytes = Buffer.from("partial-bytes");

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/range_file_id?fields=") || urlStr.includes("/files/range_file_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "range_file_id",
            name: "video.mp4",
            mimeType: "video/mp4",
            size: "1000000",
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("/files/range_file_id?alt=media")) {
        expect(options.headers["Range"]).toBe("bytes=0-12");
        return new Response(chunkBytes, {
          status: 206,
          headers: {
            "Content-Range": "bytes 0-12/1000000",
            "Content-Length": chunkBytes.length.toString(),
          },
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=range_file_id&mode=view",
      token: adminSessionToken,
      headers: {
        range: "bytes=0-12",
      },
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(206);
    expect(fakeRes.getHeader("content-range")).toBe("bytes 0-12/1000000");
    expect(fakeRes.getHeader("accept-ranges")).toBe("bytes");
  });

  it("handles DOCX view mode: converts to Google Doc copy then exports as PDF", async () => {
    const rootId = getVaultRootId();
    const convertedPdfBytes = Buffer.from("%PDF-1.4 converted-from-docx");
    let copyCalled = false;
    let exportCalled = false;
    let cleanupCalled = false;

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/sample_word_id?fields=") || urlStr.includes("/files/sample_word_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "sample_word_id",
            name: "Minutes.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: "20480",
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      // Copy call
      if (urlStr.includes("/files/sample_word_id/copy")) {
        copyCalled = true;
        const parsedBody = JSON.parse(options.body);
        expect(parsedBody.mimeType).toBe("application/vnd.google-apps.document");
        return new Response(JSON.stringify({ id: "temp_google_doc_999" }), { status: 200 });
      }
      // Export call
      if (urlStr.includes("/files/temp_google_doc_999/export?mimeType=application/pdf")) {
        exportCalled = true;
        return new Response(convertedPdfBytes, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }
      // Cleanup delete call
      if (urlStr.includes("/files/temp_google_doc_999?supportsAllDrives=true") && options?.method === "DELETE") {
        cleanupCalled = true;
        return new Response("", { status: 204 });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=sample_word_id&mode=view",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(copyCalled).toBe(true);
    expect(exportCalled).toBe(true);
    expect(cleanupCalled).toBe(true);
    expect(fakeRes.getCode()).toBe(200);
    expect(fakeRes.getHeader("content-type")).toBe("application/pdf");
    expect(fakeRes.getHeader("content-disposition")).toContain("inline");
    expect(fakeRes.getHeader("content-disposition")).toContain('filename="Minutes.pdf"');
    expect(fakeRes.getBuffer().toString("utf-8")).toContain("%PDF-1.4");
  });

  it("returns 415 with CONVERSION_UNAVAILABLE if Word copy-conversion fails", async () => {
    const rootId = getVaultRootId();

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/corrupt_word_id?fields=") || urlStr.includes("/files/corrupt_word_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "corrupt_word_id",
            name: "Corrupt.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: "1000",
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      // Copy call fails (e.g. unsupported / encrypted doc)
      if (urlStr.includes("/files/corrupt_word_id/copy")) {
        return new Response(JSON.stringify({ error: { message: "Cannot convert file" } }), { status: 400 });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=corrupt_word_id&mode=view",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(fakeRes.getCode()).toBe(415);
    const body = fakeRes.getBody();
    expect(body.code).toBe("CONVERSION_UNAVAILABLE");
    expect(body.error).toContain("download the original");
  });

  it("safeguards large files (>4.5 MB) by requesting chunked byte range in view mode", async () => {
    const rootId = getVaultRootId();
    let requestedRangeHeader: string | undefined;

    global.fetch = async (url: any, options: any) => {
      const urlStr = String(url);
      if (!urlStr.includes("googleapis.com")) {
        return originalFetch(url, options);
      }
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes("/files/large_file_id?fields=") || urlStr.includes("/files/large_file_id?supportsAllDrives=true")) {
        return new Response(
          JSON.stringify({
            id: "large_file_id",
            name: "high_res_photo.webp",
            mimeType: "image/webp",
            size: "10485760", // 10 MB
            parents: [rootId],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("/files/large_file_id?alt=media")) {
        requestedRangeHeader = options?.headers?.["Range"];
        const fakeChunk = Buffer.alloc(1024, "a");
        return new Response(fakeChunk, {
          status: 206,
          headers: {
            "Content-Range": "bytes 0-4194303/10485760",
            "Content-Length": fakeChunk.length.toString(),
          },
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const req = createFakeReq({
      url: "/api/drive/file?id=large_file_id&mode=view",
      token: adminSessionToken,
    });
    const fakeRes = createFakeRes();

    await driveHandler(req, fakeRes.res);

    expect(requestedRangeHeader).toBe("bytes=0-4194303");
    expect(fakeRes.getCode()).toBe(206);
    expect(fakeRes.getHeader("content-range")).toBe("bytes 0-4194303/10485760");
  });
});
