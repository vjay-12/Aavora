import { test, expect } from "@playwright/test";
import { DELETE_RESTRICTED_MESSAGE } from "../../src/config/features.js";

const mockFiles = [
  {
    id: "test-file-1",
    name: "Tax_Return_2025.pdf",
    mimeType: "application/pdf",
    isFolder: false,
    size: "1048576",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault User",
  },
  {
    id: "test-file-2",
    name: "Medical_Report.pdf",
    mimeType: "application/pdf",
    isFolder: false,
    size: "524288",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault User",
  },
];

test.describe("Delete Restriction & Bin UI (Desktop & Mobile)", () => {
  test.describe("Member Role (Restrictions Active)", () => {
    test.beforeEach(async ({ page }) => {
      page.on("pageerror", (err) => console.error("[BROWSER ERROR]:", err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") console.error("[BROWSER LOG ERROR]:", msg.text());
      });

      // Mock /api/auth/me as member
      await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: 2,
              email: "member@aavora.family",
              name: "Family Member",
              role: "member",
              isAdmin: false,
            },
            isAdmin: false,
          }),
        });
      });

      // Mock /api/me as member too
      await page.route("**/api/me", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: 2,
              email: "member@aavora.family",
              name: "Family Member",
              role: "member",
              isAdmin: false,
            },
            isAdmin: false,
          }),
        });
      });

      // Mock drive list
      await page.route("**/api/drive/list*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: mockFiles,
            rootFolderId: "root_123",
          }),
        });
      });

      // Mock stars & activity
      await page.route("**/api/stars*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ files: [], stars: [] }),
        });
      });

      await page.route("**/api/activity*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [] }),
        });
      });
    });

    test("Direct visit to /bin redirects member to /docs with restriction message", async ({
      page,
    }) => {
      await page.goto("/bin");
      await page.waitForLoadState("networkidle");

      // Verify redirected to /docs
      expect(page.url()).toContain("/docs");

      // Verify restricted toast appears
      const toast = page.locator("[data-testid='delete-restricted-toast']");
      await expect(toast).toBeVisible();
      await expect(toast).toContainText(DELETE_RESTRICTED_MESSAGE);
    });

    test("Member sees disabled delete buttons in card menu, file row, detail panel, and bulk bar", async ({
      page,
    }) => {
      await page.goto("/docs");
      await page.waitForLoadState("networkidle");

      // 1. Card Menu Delete Item (Grid view)
      const menuTrigger = page.locator("[data-testid='card-menu-trigger-test-file-1']");
      await expect(menuTrigger).toBeVisible();
      await menuTrigger.click();

      const cardMenuDelete = page.locator("[data-testid='card-menu-delete-test-file-1']");
      await expect(cardMenuDelete).toBeVisible();
      await expect(cardMenuDelete).toHaveAttribute("aria-disabled", "true");

      // Click should trigger restricted message toast
      await cardMenuDelete.click({ force: true });
      await expect(page.locator("[data-testid='delete-restricted-toast']")).toContainText(
        DELETE_RESTRICTED_MESSAGE
      );

      // 2. Switch to List/Row view
      const listViewBtn = page.getByRole("button", { name: "List View" });
      await listViewBtn.click();

      // Check file row delete button
      const rowDeleteBtn = page.locator("[data-testid='file-row-delete-test-file-1']");
      await expect(rowDeleteBtn).toBeVisible();
      await expect(rowDeleteBtn).toHaveAttribute("aria-disabled", "true");

      await rowDeleteBtn.click({ force: true });
      await expect(page.locator("[data-testid='delete-restricted-toast']")).toContainText(
        DELETE_RESTRICTED_MESSAGE
      );

      // 3. Document Detail Panel Delete Button
      // Switch back to grid view and open details from card menu
      await page.getByRole("button", { name: "Grid View" }).click();
      await page.locator("[data-testid='card-menu-trigger-test-file-1']").click();
      await page.getByRole("button", { name: "View Details" }).click();
      await expect(page.getByText("Document Details")).toBeVisible();

      const detailTrashBtn = page.locator("[data-testid='doc-detail-trash']");
      await expect(detailTrashBtn).toBeVisible();
      await expect(detailTrashBtn).toHaveAttribute("aria-disabled", "true");

      await detailTrashBtn.click({ force: true });
      await expect(page.getByText(DELETE_RESTRICTED_MESSAGE).first()).toBeVisible();

      // Close detail panel
      const closeBtn = page.locator("[data-testid='doc-detail-close']");
      await closeBtn.click();

      // 4. Bulk Action Bar Delete Button
      // Select all files
      const selectAllBtn = page.getByRole("button", { name: /Select All/i });
      await selectAllBtn.click();

      const bulkBar = page.locator("[data-testid='bulk-action-bar']");
      await expect(bulkBar).toBeVisible();

      const bulkDeleteBtn = page.locator("[data-testid='bulk-delete-button']");
      await expect(bulkDeleteBtn).toBeVisible();
      await expect(bulkDeleteBtn).toHaveAttribute("aria-disabled", "true");

      await bulkDeleteBtn.click({ force: true });
      await expect(page.locator("[data-testid='delete-restricted-toast']")).toContainText(
        DELETE_RESTRICTED_MESSAGE
      );
    });

    test("More page: Drive Bin tab is disabled for member with restriction message", async ({
      page,
    }) => {
      await page.goto("/more");
      await page.waitForLoadState("networkidle");

      const binTab = page.getByRole("button", { name: /Drive Bin/i });
      await expect(binTab).toBeVisible();
      await expect(binTab).toHaveAttribute("aria-disabled", "true");

      await binTab.click({ force: true });
      await expect(page.getByText(DELETE_RESTRICTED_MESSAGE).first()).toBeVisible();
    });
  });

  test.describe("Admin Role (Full Delete & Bin Capabilities)", () => {
    test.beforeEach(async ({ page }) => {
      // Mock /api/auth/me as admin
      await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: 1,
              email: "admin@aavora.family",
              name: "Vault Admin",
              role: "admin",
              isAdmin: true,
            },
            isAdmin: true,
          }),
        });
      });

      // Mock /api/me as admin too
      await page.route("**/api/me", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: 1,
              email: "admin@aavora.family",
              name: "Vault Admin",
              role: "admin",
              isAdmin: true,
            },
            isAdmin: true,
          }),
        });
      });

      // Mock drive list
      await page.route("**/api/drive/list*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: mockFiles,
            rootFolderId: "root_123",
          }),
        });
      });

      // Mock stars & activity
      await page.route("**/api/stars*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ files: [], stars: [] }),
        });
      });

      await page.route("**/api/activity*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [] }),
        });
      });

      // Mock drive trash
      await page.route("**/api/drive/trash", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: mockFiles[0],
            message: "Item moved to Bin",
          }),
        });
      });

      // Mock drive restore
      await page.route("**/api/drive/restore", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            item: mockFiles[0],
            message: "Item restored successfully",
          }),
        });
      });

      // Mock drive bin
      await page.route("**/api/drive/bin", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "bin-item-1",
                name: "Old_Doc.pdf",
                mimeType: "application/pdf",
                size: "2048",
                modifiedTime: new Date().toISOString(),
              },
            ],
          }),
        });
      });
    });

    test("Admin can delete with confirm dialog and undo toast, and manage Drive Bin", async ({
      page,
    }) => {
      await page.goto("/docs");
      await page.waitForLoadState("networkidle");

      // 1. Card Menu delete
      const menuTrigger = page.locator("[data-testid='card-menu-trigger-test-file-1']");
      await menuTrigger.click();

      const cardMenuDelete = page.locator("[data-testid='card-menu-delete-test-file-1']");
      await expect(cardMenuDelete).toHaveAttribute("aria-disabled", "false");
      await cardMenuDelete.click();

      // Confirm modal opens
      await expect(page.getByRole("heading", { name: "Move to Drive Bin?" })).toBeVisible();
      const confirmBtn = page.getByRole("button", { name: "Move to Bin" });
      await confirmBtn.click();

      // Undo toast appears
      const undoToast = page.locator("[data-testid='undo-toast']");
      await expect(undoToast).toBeVisible();

      // Clicking Undo invokes restore
      const undoBtn = undoToast.getByRole("button", { name: "Undo" });
      await undoBtn.click();
      await expect(undoToast).not.toBeVisible();

      // 2. Direct visit to /bin redirects admin to More Drive Bin
      await page.goto("/bin");
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain("/more?section=bin");

      // Verify Google Drive Bin section is visible
      await expect(page.getByRole("heading", { name: "Google Drive Bin" })).toBeVisible();
      await expect(page.getByText("Old_Doc.pdf")).toBeVisible();
      await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    });
  });
});
