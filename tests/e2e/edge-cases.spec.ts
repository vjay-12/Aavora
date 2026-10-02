import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authStatePath = path.resolve(process.cwd(), "playwright/.auth/user.json");

test.describe("Edge Cases & Error Resilience", () => {
  test.use({
    storageState: fs.existsSync(authStatePath) ? authStatePath : undefined,
  });

  test.beforeEach(async ({ context }) => {
    if (fs.existsSync(authStatePath)) {
      const auth = JSON.parse(fs.readFileSync(authStatePath, "utf8"));
      if (auth.cookies) {
        await context.addCookies(auth.cookies);
      }
    }
  });

  test("Unicode, Tamil, and extremely long file names render cleanly without layout breaks", async ({
    page,
  }) => {
    const tamilName = "குடும்ப_சொத்து_பத்திரம்_மற்றும்_பதிவு_2026.pdf";
    const longName = "A".repeat(160) + "_document_backup_very_long_name_test.pdf";
    const specialCharsName = "Contract & Agreement [2026] #100% (Draft) @Final~v2.pdf";

    await page.route("**/api/drive/list*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "file-tamil",
              name: tamilName,
              mimeType: "application/pdf",
              isFolder: false,
              size: "1500000",
              modifiedTime: "2026-03-01T10:00:00Z",
              lastModifyingUser: "Vijay Baskaran",
            },
            {
              id: "file-long",
              name: longName,
              mimeType: "application/pdf",
              isFolder: false,
              size: "3000000",
              modifiedTime: "2026-03-02T10:00:00Z",
              lastModifyingUser: "Vijay Baskaran",
            },
            {
              id: "file-special",
              name: specialCharsName,
              mimeType: "application/pdf",
              isFolder: false,
              size: "800000",
              modifiedTime: "2026-03-03T10:00:00Z",
              lastModifyingUser: "Vijay Baskaran",
            },
          ],
        }),
      });
    });

    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Check Tamil text is rendered verbatim
    await expect(page.locator(`text=${tamilName}`)).toBeVisible({ timeout: 15000 });

    // Check special characters rendered verbatim
    await expect(page.locator(`text=${specialCharsName}`)).toBeVisible({ timeout: 15000 });

    // Check long filename card has CSS truncate class
    const longEl = page.locator("h4.truncate").filter({ hasText: "AAAAA" });
    await expect(longEl).toBeVisible({ timeout: 15000 });
  });

  test("Drive API 429 rate limit or 500 error shows a friendly error without crashing", async ({
    page,
  }) => {
    await page.route("**/api/drive/list*", (route) => {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Google Drive service temporarily overloaded. Please retry in a few moments.",
        }),
      });
    });

    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Friendly error banner displayed
    await expect(page.locator("text=Failed to load Google Drive files")).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator("text=Google Drive service temporarily overloaded")
    ).toBeVisible({ timeout: 15000 });

    // Verify UI frame did not crash
    await expect(page.locator("text=Vault Root")).toBeVisible({ timeout: 15000 });
  });

  test("Folder with 200+ items renders efficiently without freeze", async ({
    page,
  }) => {
    const largeList = Array.from({ length: 250 }, (_, i) => ({
      id: `item-${i}`,
      name: `Vault_Document_${String(i).padStart(4, "0")}.pdf`,
      mimeType: i % 5 === 0 ? "application/vnd.google-apps.folder" : "application/pdf",
      isFolder: i % 5 === 0,
      size: "1048576",
      modifiedTime: "2026-02-01T12:00:00Z",
      lastModifyingUser: "Admin",
    }));

    await page.route("**/api/drive/list*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: largeList,
        }),
      });
    });

    const startRender = Date.now();
    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Verify first and last items render promptly without freeze
    await expect(page.locator("text=Vault_Document_0000.pdf")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Vault_Document_0249.pdf")).toBeVisible({ timeout: 15000 });
    const duration = Date.now() - startRender;

    // Total page navigation and 250 items list rendering took under 15 seconds
    expect(duration).toBeLessThan(15000);
  });

  test("Double-clicking action buttons does not trigger duplicate API requests", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/drive/list*", async (route) => {
      requestCount++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "sub-1",
              name: "Important Docs",
              mimeType: "application/vnd.google-apps.folder",
              isFolder: true,
            },
          ],
        }),
      });
    });

    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    const folderCard = page.locator("text=Important Docs");
    await expect(folderCard).toBeVisible();

    const baselineCount = requestCount;
    // Fast double click
    await folderCard.dblclick();

    // Only 1 additional request should be triggered
    expect(requestCount - baselineCount).toBeLessThanOrEqual(1);
  });
});
