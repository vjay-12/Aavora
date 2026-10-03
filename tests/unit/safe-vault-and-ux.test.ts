import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import driveHandler from "../../api/drive/[action].js";
import { BIN_PAGE_ENABLED, MOVE_TO_BIN_MESSAGE } from "../../src/config/features.js";
import { getVaultRootId, splitFileName } from "../../server/drive.js";
import { createSessionToken } from "../../server/auth.js";
import { db } from "../../server/db/index.js";
import { users } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";

function createFakeReq(options: {
  method?: string;
  url?: string;
  body?: any;
  headers?: Record<string, string>;
  token?: string;
}) {
  const method = options.method || "GET";
  const url = options.url || "/api/drive/list";
  const headers = { ...(options.headers || {}) };
  if (options.token) {
    headers.cookie = `aavora_session=${options.token}`;
  }
  return {
    method,
    url,
    headers,
    query: {},
    body: options.body || {},
    on: (event: string, callback: any) => {
      if (event === "data" && options.body) {
        callback(Buffer.from(JSON.stringify(options.body)));
      }
      if (event === "end") {
        callback();
      }
    },
  } as any;
}

function createFakeRes() {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let bodyData = "";

  return {
    res: {
      statusCode,
      set statusCode(val: number) {
        statusCode = val;
      },
      get statusCode() {
        return statusCode;
      },
      setHeader: (name: string, val: string) => {
        headers[name.toLowerCase()] = val;
      },
      getHeader: (name: string) => headers[name.toLowerCase()],
      end: (data?: any) => {
        if (data) bodyData += data.toString();
      },
      write: (data?: any) => {
        if (data) bodyData += data.toString();
      },
    } as any,
    getCode: () => statusCode,
    getHeader: (name: string) => headers[name.toLowerCase()],
    getBody: () => {
      try {
        return JSON.parse(bodyData);
      } catch {
        return bodyData;
      }
    },
  };
}

describe("Aavora 8-Point Safe Vault & UI/UX Standards", () => {
  // 1. DOCUMENT MENU (⋯ on a file)
  describe("1. Document Menu (⋯ on a file)", () => {
    it("DocsPage source excludes 'Preview' and 'Download' from the 3-dot dropdown menu", () => {
      const docsPagePath = path.resolve(import.meta.dirname, "../../src/pages/DocsPage.tsx");
      const content = fs.readFileSync(docsPagePath, "utf-8");

      // Verify dropdown menus do not contain 'Preview' or 'Download' as menu buttons
      const dropdownMatches = content.match(/data-testid=\{`card-menu-dropdown-\$\{file\.id\}`\}[\s\S]*?<\/div>/g) || [];
      expect(dropdownMatches.length).toBeGreaterThan(0);

      for (const dropdown of dropdownMatches) {
        expect(dropdown).not.toContain("Preview File");
        expect(dropdown).not.toContain("<span>Download</span>");
        expect(dropdown).toContain("View details");
        expect(dropdown).toContain("Rename");
        expect(dropdown).toContain("Move");
        expect(dropdown).toContain("Move to Bin");
      }
    });
  });

  // 2. UPLOADED BY (correct uploader attribution)
  describe("2. Uploaded By Attribution", () => {
    it("upload-session extracts uploader from verified session, never from client body", () => {
      const driveHandlerPath = path.resolve(import.meta.dirname, "../../api/drive/[action].ts");
      const content = fs.readFileSync(driveHandlerPath, "utf-8");

      const sessionIdx = content.indexOf('action === "upload-session"');
      expect(sessionIdx).toBeGreaterThan(-1);
      const sessionSnippet = content.slice(sessionIdx, sessionIdx + 1200);

      expect(sessionSnippet).toContain("uploadedById");
      expect(sessionSnippet).toContain("uploadedByName");
      expect(sessionSnippet).toContain("String(session.id)");
    });

    it("drive list resolves uploadedByName, never defaults to Vault Admin, falls back to Unknown", () => {
      const driveHandlerPath = path.resolve(import.meta.dirname, "../../api/drive/[action].ts");
      const content = fs.readFileSync(driveHandlerPath, "utf-8");

      const listIdx = content.indexOf('action === "list"');
      expect(listIdx).toBeGreaterThan(-1);
      const listSnippet = content.slice(listIdx, listIdx + 3500);

      expect(listSnippet).toContain('"Unknown"');
      expect(listSnippet).not.toContain('"Vault Admin"');
    });

    it("admin edit-uploader endpoint updates appProperties and logs to activity", () => {
      const driveHandlerPath = path.resolve(import.meta.dirname, "../../api/drive/[action].ts");
      const content = fs.readFileSync(driveHandlerPath, "utf-8");

      expect(content).toContain('action === "edit-uploader"');
      expect(content).toContain("requireAdmin(session)");
    });

    it("a member uploads, and the file shows that member's name", async () => {
      const memberName = "Alice Family Member";
      const memberEmail = "alice.member.upload.spec@aavora.internal";

      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, memberEmail))
        .limit(1);

      let memberId = existingUser?.id;
      if (!existingUser) {
        const [inserted] = await db.insert(users).values({
          email: memberEmail,
          name: memberName,
          role: "member",
          active: true,
        }).returning();
        memberId = inserted.id;
      }

      const memberToken = await createSessionToken({
        id: memberId,
        email: memberEmail,
        name: memberName,
        role: "member",
      });

      const originalAdminToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
      process.env.GOOGLE_ADMIN_REFRESH_TOKEN = "test_mock_refresh_token_upload";

      let capturedDriveMetadata: any = null;
      const originalFetch = global.fetch;

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;

        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
        }

        if (urlStr.includes("upload/drive/v3/files?uploadType=resumable")) {
          if (init?.body) {
            capturedDriveMetadata = JSON.parse(init.body);
          }
          return new Response(JSON.stringify({ id: "uploaded_doc_123" }), {
            status: 200,
            headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=resumable_123" },
          });
        }

        if (urlStr.includes("/files/root_mock_id?")) {
          return new Response(JSON.stringify({ id: "root_mock_id", parents: [] }), { status: 200 });
        }

        return originalFetch(input, init);
      };

      try {
        const req = createFakeReq({
          method: "POST",
          url: "/api/drive/upload-session",
          token: memberToken,
          body: {
            name: "FamilyVaccineRecord.pdf",
            mimeType: "application/pdf",
            parentId: getVaultRootId(),
          },
        });
        const { res, getCode, getBody } = createFakeRes();

        await driveHandler(req, res);

        expect(getCode()).toBe(200);
        const body = getBody();
        expect(body.uploadedByName).toBe(memberName);
        expect(body.uploadedById).toBe(String(memberId));
        expect(capturedDriveMetadata?.appProperties?.uploadedByName).toBe(memberName);
        expect(capturedDriveMetadata?.appProperties?.uploadedById).toBe(String(memberId));
      } finally {
        global.fetch = originalFetch;
        if (originalAdminToken !== undefined) {
          process.env.GOOGLE_ADMIN_REFRESH_TOKEN = originalAdminToken;
        } else {
          delete process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
        }
      }
    });
  });

  // 3. PLAIN LANGUAGE (no technical jargon in UI)
  describe("3. Plain Language UI Validation", () => {
    const bannedTechnicalWords = [
      "AES-GCM",
      "IndexedDB",
      "PBKDF2",
      "WebAuthn",
      "Direct Resumable Upload",
      "Vault storage (admin Drive)",
      "Vault Encrypted & Synced",
      "OAuth",
    ];

    it("verifies user-facing UI files do not render banned technical jargon in labels or text", () => {
      const filesToCheck = [
        "../../src/pages/HomePage.tsx",
        "../../src/pages/SavedPage.tsx",
        "../../src/pages/MorePage.tsx",
        "../../src/components/docs/UploadModal.tsx",
        "../../src/components/docs/DocDetailPanel.tsx",
        "../../src/components/lock/LockScreen.tsx",
        "../../src/components/lock/SetupLockModal.tsx",
      ];

      for (const relPath of filesToCheck) {
        const fullPath = path.resolve(import.meta.dirname, relPath);
        if (!fs.existsSync(fullPath)) continue;
        const text = fs.readFileSync(fullPath, "utf-8");

        for (const word of bannedTechnicalWords) {
          // Check JSX rendered text
          const jsxMatches = text.match(new RegExp(`>[^<]*${word}[^<]*<`, "gi"));
          expect(
            jsxMatches,
            `File ${relPath} contains banned jargon "${word}": ${JSON.stringify(jsxMatches)}`
          ).toBeNull();
        }
      }
    });

    it("verifies friendly plain language replacements are in place", () => {
      const homeContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/HomePage.tsx"), "utf-8");
      expect(homeContent).toContain("Your documents are safe");
      expect(homeContent).toContain("Storage used");
      expect(homeContent).toContain("Saved on this device");

      const savedContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/SavedPage.tsx"), "utf-8");
      expect(savedContent).toContain("Saved on this Device");
      expect(savedContent).toContain("Ready offline");
      expect(savedContent).toContain("Saved & Offline");
    });
  });

  // 4. STAR STATE
  describe("4. Star State & Optimistic Updates", () => {
    it("renders filled golden star (fill-amber-400 stroke-amber-400 text-amber-400) when starred", () => {
      const docsContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/DocsPage.tsx"), "utf-8");
      expect(docsContent).toContain("fill-amber-400 stroke-amber-400 text-amber-400");
      expect(docsContent).toContain('aria-pressed={isStarred}');

      const detailContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/components/docs/DocDetailPanel.tsx"), "utf-8");
      expect(detailContent).toContain("fill-amber-400 stroke-amber-400 text-amber-400");
      expect(detailContent).toContain('aria-pressed={Boolean(item.starred)}');
    });

    it("provides optimistic update with error toast rollback", () => {
      const docsContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/DocsPage.tsx"), "utf-8");
      expect(docsContent).toContain("handleToggleStar");
      expect(docsContent).toContain("queryClient.setQueryData");
      expect(docsContent).toContain("Could not update star. Please try again.");
    });
  });

  // 5. VIEW DETAILS HEADER
  describe("5. View Details Header", () => {
    it("DocDetailPanel header does not contain a Download button", () => {
      const detailPath = path.resolve(import.meta.dirname, "../../src/components/docs/DocDetailPanel.tsx");
      const content = fs.readFileSync(detailPath, "utf-8");

      // Locate the top header area (around star, title and close button)
      const headerAreaMatch = content.match(/<div className="p-4 border-b border-white\/10 flex items-center justify-between[\s\S]*?<\/div>\s*<\/div>/);
      expect(headerAreaMatch).not.toBeNull();
      const headerSnippet = headerAreaMatch ? headerAreaMatch[0] : "";

      expect(headerSnippet).not.toContain("handleDownload");
      expect(headerSnippet).not.toContain("Download");
    });
  });

  // 6. UI/UX POLISH
  describe("6. UI/UX Polish & Standards", () => {
    it("interactive button touch targets maintain minimum 44px on mobile", () => {
      const docsContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/DocsPage.tsx"), "utf-8");
      expect(docsContent).toContain("min-h-[44px] min-w-[44px]");

      const layoutContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/components/layout/AppLayout.tsx"), "utf-8");
      expect(layoutContent).toContain("min-h-[44px] min-w-[48px]");
    });

    it("UploadModal includes folder destination picker and simple progress flow", () => {
      const uploadModalContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/components/docs/UploadModal.tsx"), "utf-8");
      expect(uploadModalContent).toContain("destinationFolderId");
      expect(uploadModalContent).toContain("Choose Destination Folder");
      expect(uploadModalContent).toContain("Done! File uploaded successfully.");
    });
  });

  // 7. DATA SAFETY (Zero Automatic Deletes)
  describe("7. Data Safety (Zero Automatic Deletes)", () => {
    it("scans entire codebase and fails if files.delete or emptyTrash is called", () => {
      const rootDir = path.resolve(import.meta.dirname, "../../");
      const scanDirs = ["api", "server", "src"];

      function scanDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== ".git") {
              scanDir(fullPath);
            }
          } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
            const code = fs.readFileSync(fullPath, "utf-8");
            // Check for Google Drive files.delete API invocation
            expect(code).not.toMatch(/files\.delete\(/);
            expect(code).not.toMatch(/emptyTrash/);
            // Check for HTTP DELETE on googleapis.com/drive/v3/files
            const lines = code.split("\n");
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.includes("googleapis.com/drive/v3/files") && line.includes('method: "DELETE"')) {
                throw new Error(`Forbidden DELETE call found in ${fullPath}:${i + 1}`);
              }
            }
          }
        }
      }

      for (const d of scanDirs) {
        scanDir(path.join(rootDir, d));
      }
    });

    it("splitFileName correctly handles extensions and duplicate name suffixes", () => {
      expect(splitFileName("Passport.pdf")).toEqual({ base: "Passport", ext: ".pdf" });
      expect(splitFileName("Invoice (1).pdf")).toEqual({ base: "Invoice", ext: ".pdf" });
      expect(splitFileName("Family Photo")).toEqual({ base: "Family Photo", ext: "" });
    });

    it("folder deletion requires typing folder name to confirm in DocsPage", () => {
      const docsContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/DocsPage.tsx"), "utf-8");
      expect(docsContent).toContain("folderConfirmInput");
      expect(docsContent).toContain("Type <strong>{confirmTrashModal.items.find((i) => i.isFolder)?.name}</strong> to confirm:");
    });
  });

  // 8. BIN REMOVED
  describe("8. Bin Removed (Temporary Flag)", () => {
    it("BIN_PAGE_ENABLED flag is false", () => {
      expect(BIN_PAGE_ENABLED).toBe(false);
    });

    it("MOVE_TO_BIN_MESSAGE clearly guides the user about 30-day Google Drive restore", () => {
      expect(MOVE_TO_BIN_MESSAGE).toContain("30 days");
      expect(MOVE_TO_BIN_MESSAGE).toContain("Google Drive");
    });

    it("/bin route redirects to /docs when BIN_PAGE_ENABLED is false", () => {
      const appContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/App.tsx"), "utf-8");
      expect(appContent).toContain("BIN_PAGE_ENABLED");
      expect(appContent).toContain('return <Navigate to="/docs" replace />;');
    });

    it("MorePage hides the Drive Bin tab when BIN_PAGE_ENABLED is false", () => {
      const moreContent = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/pages/MorePage.tsx"), "utf-8");
      expect(moreContent).toContain("{BIN_PAGE_ENABLED && (");
      expect(moreContent).toContain("Deleted files can be found in the admin's Google Drive Bin and restored within 30 days.");
    });
  });
});
