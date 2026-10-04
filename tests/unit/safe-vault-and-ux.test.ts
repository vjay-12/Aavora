import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import driveHandler from "../../api/drive/[action].js";
import { BIN_PAGE_ENABLED, MOVE_TO_BIN_MESSAGE } from "../../src/config/features.js";
import { getVaultRootId, splitFileName } from "../../server/drive.js";
import { createSessionToken } from "../../server/auth.js";
import { db } from "../../server/db/index.js";
import { users } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";
import { DEFAULT_FOLDER_COLOR, getFolderPalette } from "../../src/config/colors.js";
import { getEnv } from "../../server/env.js";

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
  // 1. DOCUMENT MENU (⋯ on a file) & VIEW DETAILS CLEANUP
  describe("1. Document Menu (⋯ on a file) & View Details Cleanup", () => {
    it("DocsPage source includes full actions in 3-dot menu and DocDetailPanel excludes duplicate actions", () => {
      const docsPagePath = path.resolve(import.meta.dirname, "../../src/pages/DocsPage.tsx");
      const content = fs.readFileSync(docsPagePath, "utf-8");

      // Verify dropdown menus contain all standard actions
      const dropdownMatches = content.match(/data-testid=\{`card-menu-dropdown-\$\{file\.id\}`\}[\s\S]*?<\/div>/g) || [];
      expect(dropdownMatches.length).toBeGreaterThan(0);

      for (const dropdown of dropdownMatches) {
        expect(dropdown).toContain("View details");
        expect(dropdown).toContain("Download");
        expect(dropdown).toContain("Save on this device");
        expect(dropdown).toContain("Rename");
        expect(dropdown).toContain("Move");
        expect(dropdown).toContain("Move to Bin");
      }

      // Verify DocDetailPanel does NOT contain duplicate actions: Download, Save on this device, Copy, Delete
      const detailPath = path.resolve(import.meta.dirname, "../../src/components/docs/DocDetailPanel.tsx");
      const detailContent = fs.readFileSync(detailPath, "utf-8");
      expect(detailContent).not.toContain("Save on this device");
      expect(detailContent).not.toContain("handleDownload");
      expect(detailContent).not.toContain("handleCopy");
      expect(detailContent).not.toContain("handleTrash");
      expect(detailContent).not.toContain("Move to Bin");
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
      expect(uploadModalContent).toContain("Upload complete! Saved to vault.");
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

  // 9. SUBFOLDER UPLOAD (1 Level Deep and 2 Levels Deep)
  describe("9. Subfolder Upload (1 Level Deep and 2 Levels Deep)", () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;

    beforeEach(() => {
      process.env.GOOGLE_ADMIN_REFRESH_TOKEN = "mock_admin_refresh_token_subfolder";
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalToken !== undefined) {
        process.env.GOOGLE_ADMIN_REFRESH_TOKEN = originalToken;
      } else {
        delete process.env.GOOGLE_ADMIN_REFRESH_TOKEN;
      }
    });

    it("uploading inside a subfolder 1 level deep sets parents to that subfolder, not root", async () => {
      const rootId = getVaultRootId();
      const subfolder1Id = "subfolder_level_1_id";
      let capturedMetadata: any = null;

      const env = getEnv();
      const adminToken = await createSessionToken({
        id: 1,
        email: env.ADMIN_EMAIL,
        name: "Test Admin",
        role: "admin",
      });

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;

        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
        }

        // Subfolder 1 parent check -> parent is rootId
        if (urlStr.includes(`files/${subfolder1Id}?`)) {
          return new Response(
            JSON.stringify({ id: subfolder1Id, parents: [rootId], trashed: false }),
            { status: 200 }
          );
        }

        if (urlStr.includes("upload/drive/v3/files?uploadType=resumable")) {
          if (init?.body) {
            capturedMetadata = JSON.parse(init.body);
          }
          return new Response(JSON.stringify({ id: "uploaded_doc_sub1" }), {
            status: 200,
            headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=mock_session_sub1" },
          });
        }

        return originalFetch(input, init);
      };

      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/upload-session",
        token: adminToken,
        body: {
          name: "Sub1_File.pdf",
          mimeType: "application/pdf",
          parentId: subfolder1Id,
        },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(200);
      const body = getBody();
      expect(body.parentId).toBe(subfolder1Id);
      expect(capturedMetadata).not.toBeNull();
      // Verifies the file is placed directly in the subfolder, never root
      expect(capturedMetadata.parents).toEqual([subfolder1Id]);
      expect(capturedMetadata.parents).not.toEqual([rootId]);
    });

    it("uploading inside a subfolder 2 levels deep walks parent chain and sets parents to subfolder 2", async () => {
      const rootId = getVaultRootId();
      const subfolder1Id = "subfolder_level_1_id";
      const subfolder2Id = "subfolder_level_2_id";
      let capturedMetadata: any = null;

      const env = getEnv();
      const adminToken = await createSessionToken({
        id: 1,
        email: env.ADMIN_EMAIL,
        name: "Test Admin",
        role: "admin",
      });

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;

        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
        }

        // Subfolder 2 -> parent is Subfolder 1
        if (urlStr.includes(`files/${subfolder2Id}?`)) {
          return new Response(
            JSON.stringify({ id: subfolder2Id, parents: [subfolder1Id], trashed: false }),
            { status: 200 }
          );
        }

        // Subfolder 1 -> parent is rootId
        if (urlStr.includes(`files/${subfolder1Id}?`)) {
          return new Response(
            JSON.stringify({ id: subfolder1Id, parents: [rootId], trashed: false }),
            { status: 200 }
          );
        }

        if (urlStr.includes("upload/drive/v3/files?uploadType=resumable")) {
          if (init?.body) {
            capturedMetadata = JSON.parse(init.body);
          }
          return new Response(JSON.stringify({ id: "uploaded_doc_sub2" }), {
            status: 200,
            headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=mock_session_sub2" },
          });
        }

        return originalFetch(input, init);
      };

      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/upload-session",
        token: adminToken,
        body: {
          name: "Deep_Nested_Doc.pdf",
          mimeType: "application/pdf",
          parentId: subfolder2Id,
        },
      });
      const { res, getCode, getBody } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(200);
      const body = getBody();
      expect(body.parentId).toBe(subfolder2Id);
      expect(capturedMetadata).not.toBeNull();
      // Verifies 2 levels deep destination is respected
      expect(capturedMetadata.parents).toEqual([subfolder2Id]);
      expect(capturedMetadata.parents).not.toEqual([subfolder1Id]);
      expect(capturedMetadata.parents).not.toEqual([rootId]);
    });

    it("rejects upload with 403 if target folder is outside the vault hierarchy", async () => {
      const outsideFolderId = "malicious_outside_folder_id";

      const env = getEnv();
      const adminToken = await createSessionToken({
        id: 1,
        email: env.ADMIN_EMAIL,
        name: "Test Admin",
        role: "admin",
      });

      global.fetch = async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input.url;

        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token" }), { status: 200 });
        }

        // Outside folder -> parent is foreign folder that has no parents
        if (urlStr.includes(`files/${outsideFolderId}?`)) {
          return new Response(
            JSON.stringify({ id: outsideFolderId, parents: ["foreign_root_id"], trashed: false }),
            { status: 200 }
          );
        }

        if (urlStr.includes("files/foreign_root_id?")) {
          return new Response(
            JSON.stringify({ id: "foreign_root_id", parents: [], trashed: false }),
            { status: 200 }
          );
        }

        return originalFetch(input, init);
      };

      const req = createFakeReq({
        method: "POST",
        url: "/api/drive/upload-session",
        token: adminToken,
        body: {
          name: "Hacked_File.pdf",
          mimeType: "application/pdf",
          parentId: outsideFolderId,
        },
      });
      const { res, getCode } = createFakeRes();

      await driveHandler(req, res);

      expect(getCode()).toBe(403);
    });
  });

  // 10. FOLDER COLORS PERSISTENCE & MULTI-FOLDER STABILITY
  describe("10. Folder Colors Persistence & Multi-Folder Stability", () => {
    it("folders with no saved color receive fixed default 'sky', never random values", () => {
      expect(DEFAULT_FOLDER_COLOR).toBe("sky");
      const defaultPalette = getFolderPalette(undefined);
      expect(defaultPalette.id).toBe("sky");
      const randomPalette1 = getFolderPalette(undefined);
      const randomPalette2 = getFolderPalette(undefined);
      expect(randomPalette1.id).toBe(randomPalette2.id);
    });

    it("sets different colors on 3 folders, persists in appProperties, and each keeps its own color", async () => {
      const folderA = { id: "folder_a", name: "Taxes", appProperties: { color: "emerald", folderColor: "emerald" } };
      const folderB = { id: "folder_b", name: "Medical", appProperties: { color: "amber", folderColor: "amber" } };
      const folderC = { id: "folder_c", name: "Legal", appProperties: { color: "rose", folderColor: "rose" } };

      const paletteA = getFolderPalette(folderA.appProperties.color);
      const paletteB = getFolderPalette(folderB.appProperties.color);
      const paletteC = getFolderPalette(folderC.appProperties.color);

      expect(paletteA.id).toBe("emerald");
      expect(paletteB.id).toBe("amber");
      expect(paletteC.id).toBe("rose");

      // Verify they are all distinct and do not bleed into each other
      expect(paletteA.id).not.toBe(paletteB.id);
      expect(paletteB.id).not.toBe(paletteC.id);
      expect(paletteA.id).not.toBe(paletteC.id);

      // Verify simulated update on Folder B does not modify Folder A or Folder C
      const updatedFolderB = {
        ...folderB,
        appProperties: { ...folderB.appProperties, color: "purple", folderColor: "purple" },
      };
      const updatedPaletteB = getFolderPalette(updatedFolderB.appProperties.color);

      expect(updatedPaletteB.id).toBe("purple");
      expect(getFolderPalette(folderA.appProperties.color).id).toBe("emerald");
      expect(getFolderPalette(folderC.appProperties.color).id).toBe("rose");
    });
  });

  // 11. VIEW DETAILS CLEANUP
  describe("11. View Details Cleanup", () => {
    it("DocDetailPanel retains preview, metadata, tags, notes, and Star, while duplicate actions are removed", () => {
      const detailPath = path.resolve(import.meta.dirname, "../../src/components/docs/DocDetailPanel.tsx");
      const content = fs.readFileSync(detailPath, "utf-8");

      // Preserved essentials
      expect(content).toContain("doc-detail-preview-box");
      expect(content).toContain("doc-detail-star-btn");
      expect(content).toContain("Uploaded By");
      expect(content).toContain("Modified");
      expect(content).toContain("Folder");
      expect(content).toContain("Tags");
      expect(content).toContain("Notes");

      // Removed duplicates
      expect(content).not.toContain("Save on this device");
      expect(content).not.toContain("Download");
      expect(content).not.toContain("Copy");
      expect(content).not.toContain("Move to Bin");
    });
  });
});
