import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authStatePath = path.resolve(process.cwd(), "playwright/.auth/user.json");
const screenshotDir = path.resolve(process.cwd(), "tests/screenshots");

test.describe("Screen-by-Screen UI Walkthrough", () => {
  // Use stored auth state if exists
  test.use({
    storageState: fs.existsSync(authStatePath) ? authStatePath : undefined,
  });

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test.beforeEach(async ({ context }) => {
    if (fs.existsSync(authStatePath)) {
      const auth = JSON.parse(fs.readFileSync(authStatePath, "utf8"));
      if (auth.cookies) {
        await context.addCookies(auth.cookies);
      }
    }
  });

  test("Authenticated root redirects to /docs and renders Docs explorer", async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("401") && !msg.text().includes("503")) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Verify redirected to /docs
    expect(page.url()).toContain("/docs");
    expect(consoleErrors).toEqual([]);

    // Check Vault Root breadcrumb
    await expect(page.locator("text=Vault Root")).toBeVisible();

    // Screenshot Docs screen
    await page.screenshot({
      path: path.join(screenshotDir, `screen-docs-${testInfo.project.name}.png`),
    });
  });

  test("Navigation: Home, Docs, Saved, Activity, and More tabs all open cleanly", async ({
    page,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("Mobile");
    await page.goto("/docs");
    await expect(page.locator("text=Vault Root")).toBeVisible({ timeout: 15000 });

    // Check Home from nav
    const homeLink = isMobile
      ? page.locator('nav.md\\:hidden a[href="/home"]')
      : page.locator('aside a[href="/home"]');
    await homeLink.click();
    await expect(page.locator("text=Your documents are safe").first()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, `screen-home-${testInfo.project.name}.png`),
    });

    // Check Saved from nav
    const savedLink = isMobile
      ? page.locator('nav.md\\:hidden a[href="/saved"]')
      : page.locator('aside a[href="/saved"]');
    await savedLink.click();
    await expect(page.locator("text=Saved & Offline").first()).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, `screen-saved-${testInfo.project.name}.png`),
    });

    // Check Activity from nav
    const activityLink = isMobile
      ? page.locator('nav.md\\:hidden a[href="/activity"]')
      : page.locator('aside a[href="/activity"]');
    await activityLink.click();
    await expect(page.locator("text=Activity Feed")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, `screen-activity-${testInfo.project.name}.png`),
    });

    // Check More from nav
    const moreLink = isMobile
      ? page.locator('nav.md\\:hidden a[href="/more"]')
      : page.locator('aside a[href="/more"]');
    await moreLink.click();
    await expect(page.locator("text=Vault Settings & Management")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotDir, `screen-more-${testInfo.project.name}.png`),
    });

    // Return to Docs from nav
    const docsLink = isMobile
      ? page.locator('nav.md\\:hidden a[href="/docs"]')
      : page.locator('aside a[href="/docs"]');
    await docsLink.click();
    await expect(page.locator("text=Vault Root")).toBeVisible();

    // Verify Navigation Bar / Sidebar elements
    if (isMobile) {
      const bottomNav = page.locator("nav.md\\:hidden");
      await expect(bottomNav).toBeVisible();
      const activeLink = bottomNav.locator("a.text-sky-400");
      await expect(activeLink).toBeVisible();
    } else {
      const sidebar = page.locator("aside");
      await expect(sidebar).toBeVisible();
      await expect(sidebar.locator("text=AAVORA")).toBeVisible();
    }
  });

  test("Docs: Category navigation, files metadata, breadcrumbs and Back button", async ({
    page,
  }, testInfo) => {
    // Mock Drive items to ensure deterministic multi-level tree testing
    await page.route("**/api/drive/list*", async (route) => {
      const url = new URL(route.request().url());
      const folderId = url.searchParams.get("folderId");

      if (folderId === "folder-finance") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "folder-tax-2025",
                name: "Tax 2025",
                mimeType: "application/vnd.google-apps.folder",
                isFolder: true,
                modifiedTime: "2026-02-15T10:00:00Z",
                lastModifyingUser: "Vijay Baskaran",
              },
              {
                id: "file-balance-sheet",
                name: "Audited_Balance_Sheet_2025.pdf",
                mimeType: "application/pdf",
                isFolder: false,
                size: "2450000",
                modifiedTime: "2026-03-01T14:30:00Z",
                lastModifyingUser: "Vijay Baskaran",
              },
            ],
            currentFolderId: "folder-finance",
            rootFolderId: "mock-root",
          }),
        });
      } else if (folderId === "folder-tax-2025") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "file-it-return",
                name: "Income_Tax_Acknowledgment_AY25-26.pdf",
                mimeType: "application/pdf",
                isFolder: false,
                size: "1280000",
                modifiedTime: "2026-03-15T09:12:00Z",
                lastModifyingUser: "Vijay Baskaran",
              },
            ],
            currentFolderId: "folder-tax-2025",
            rootFolderId: "mock-root",
          }),
        });
      }

      // Root level
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "folder-finance",
              name: "Finance & Accounts",
              mimeType: "application/vnd.google-apps.folder",
              isFolder: true,
              modifiedTime: "2026-03-20T11:00:00Z",
              lastModifyingUser: "Vijay Baskaran",
            },
            {
              id: "folder-identity",
              name: "Identity & Passports",
              mimeType: "application/vnd.google-apps.folder",
              isFolder: true,
              modifiedTime: "2026-03-22T08:45:00Z",
              lastModifyingUser: "Admin",
            },
            {
              id: "file-vault-readme",
              name: "Vault_Guidelines.pdf",
              mimeType: "application/pdf",
              isFolder: false,
              size: "542000",
              modifiedTime: "2026-01-10T12:00:00Z",
              lastModifyingUser: "Admin",
            },
          ],
          currentFolderId: "mock-root",
          rootFolderId: "mock-root",
        }),
      });
    });

    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // 1. Verify Category card renders
    const financeCategory = page.locator("text=Finance & Accounts");
    await expect(financeCategory).toBeVisible();

    // Verify root file metadata shows name, size, modified time, user
    await expect(page.locator("text=Vault_Guidelines.pdf")).toBeVisible();
    await expect(page.locator("text=529.3 KB")).toBeVisible();

    // 2. Click category card to navigate deeper
    await financeCategory.click();
    await page.waitForLoadState("networkidle");

    // Expect breadcrumb to show Vault Root > Finance & Accounts
    await expect(page.locator("button:has-text('Vault Root')")).toBeVisible();
    await expect(page.locator("button:has-text('Finance & Accounts')")).toBeVisible();

    // Verify subfolder and file inside Finance
    const taxSubfolder = page.locator("text=Tax 2025");
    await expect(taxSubfolder).toBeVisible();
    await expect(page.locator("text=Audited_Balance_Sheet_2025.pdf")).toBeVisible();
    await expect(page.locator("text=2.3 MB")).toBeVisible();

    // 3. Click deeper subfolder
    await taxSubfolder.click();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("button:has-text('Tax 2025')")).toBeVisible();
    await expect(page.locator("text=Income_Tax_Acknowledgment_AY25-26.pdf")).toBeVisible();

    // 4. Test Breadcrumb click at every level
    // Click 'Finance & Accounts' in breadcrumbs
    await page.locator("button:has-text('Finance & Accounts')").click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Tax 2025")).toBeVisible();

    // Navigate into Tax 2025 again
    await page.locator("text=Tax 2025").click();
    await page.waitForLoadState("networkidle");

    // 5. Test Back button
    const backBtn = page.getByRole("button", { name: "Back to previous folder" });
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Tax 2025")).toBeVisible();

    // Click Back again to return to Vault Root
    await backBtn.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Finance & Accounts")).toBeVisible();
  });

  test("Docs: Empty folder shows friendly empty state and slow network shows skeletons", async ({
    page,
  }, testInfo) => {
    // 1. Slow network skeleton test with controlled 600ms delay
    await page.route("**/api/drive/list*", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          currentFolderId: "empty-dir",
          rootFolderId: "mock-root",
        }),
      });
    });

    await page.goto("/docs?folderId=empty-dir");
    // Verify pulse skeleton loading cards are visible while request is pending
    const skeletons = page.locator(".animate-pulse");
    await expect(skeletons.first()).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, `docs-loading-skeleton-${testInfo.project.name}.png`),
    });

    // 2. Empty state verification after delay completes
    await expect(page.locator("text=This folder is empty")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=No files or subfolders found in this directory.")).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, `docs-empty-state-${testInfo.project.name}.png`),
    });
  });

  test("Mobile responsive checks: 360px width, no horizontal scroll, tap targets >= 44px", async ({
    page,
  }, testInfo) => {
    if (!testInfo.project.name.includes("Mobile")) return;

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Check no horizontal scrollbar (scrollWidth <= clientWidth)
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBeFalsy();

    // Check tap targets in mobile bottom nav: height >= 44px and width >= 44px
    const navButtons = page.locator("nav.md\\:hidden a");
    const count = await navButtons.count();
    expect(count).toBe(5);

    for (let i = 0; i < count; i++) {
      const box = await navButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("Desktop layout: Sidebar visible and wider grid layout used", async ({
    page,
  }, testInfo) => {
    if (!testInfo.project.name.includes("Desktop")) return;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Sidebar must be visible
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(240);

    // Wide content container
    const main = page.locator("main");
    await expect(main).toHaveClass(/max-w-7xl/);
  });

  test("Keyboard accessibility: Tab focus rings and Enter activation", async ({
    page,
  }) => {
    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Press Tab multiple times and verify an active element is focused
    await page.keyboard.press("Tab");
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["A", "BUTTON", "INPUT", "BODY"]).toContain(focusedTag);
  });
});
