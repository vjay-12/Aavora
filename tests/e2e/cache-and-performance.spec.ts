import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authStatePath = path.resolve(process.cwd(), "playwright/.auth/user.json");

test.describe("Cache & Performance Tests", () => {
  test.use({
    storageState: fs.existsSync(authStatePath) ? authStatePath : undefined,
  });

  test.beforeEach(async ({ context, page }) => {
    if (fs.existsSync(authStatePath)) {
      const auth = JSON.parse(fs.readFileSync(authStatePath, "utf8"));
      if (auth.cookies) {
        await context.addCookies(auth.cookies);
      }
    }

    // Mock active auth session
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: 1, email: "admin@aavora.family", name: "Admin", role: "admin", isAdmin: true },
          isAdmin: true,
        }),
      });
    });

    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: 1, email: "admin@aavora.family", name: "Admin", role: "admin", isAdmin: true },
          isAdmin: true,
        }),
      });
    });
  });

  test("Docs stale-while-revalidate: renders from cache on reload before network resolves", async ({
    page,
  }) => {
    let callCount = 0;
    await page.route("**/api/drive/list*", async (route) => {
      callCount++;
      if (callCount === 1) {
        // Initial visit: return initial cached items immediately
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "initial-doc",
                name: "Cached_Vault_Doc.pdf",
                mimeType: "application/pdf",
                isFolder: false,
                size: "102400",
                modifiedTime: "2026-03-01T10:00:00Z",
                lastModifyingUser: "Vijay Baskaran",
              },
            ],
            rootFolderId: "root",
          }),
        });
      } else {
        // Reload: simulate slow network (2500ms throttle)
        await new Promise((r) => setTimeout(r, 2500));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "updated-doc",
                name: "Newly_Updated_Vault_Doc.pdf",
                mimeType: "application/pdf",
                isFolder: false,
                size: "204800",
                modifiedTime: new Date().toISOString(),
                lastModifyingUser: "Vijay Baskaran",
              },
            ],
            rootFolderId: "root",
          }),
        });
      }
    });

    // 1. First visit - load initial items into TanStack query cache
    await page.goto("/docs");
    await expect(page.locator("text=Cached_Vault_Doc.pdf")).toBeVisible({ timeout: 15000 });

    // Wait 300ms to ensure IndexedDB asynchronous persistence finishes
    await page.waitForTimeout(300);

    // 2. Reload the page: cached item is displayed from cache without blocking on slow fetch
    await page.reload();
    await expect(page.locator("text=Cached_Vault_Doc.pdf")).toBeVisible({ timeout: 15000 });

    // 3. Newly fetched item appears seamlessly after background fetch finishes
    await expect(page.locator("text=Newly_Updated_Vault_Doc.pdf")).toBeVisible({ timeout: 10000 });
  });

  test("API Latency measurement: /api/me and /api/drive/list (cold vs warm)", async ({
    request,
  }) => {
    const auth = fs.existsSync(authStatePath) ? JSON.parse(fs.readFileSync(authStatePath, "utf8")) : null;
    const cookieHeader = auth?.cookies ? auth.cookies.map((c: any) => `${c.name}=${c.value}`).join("; ") : "";
    const headers = cookieHeader ? { Cookie: cookieHeader } : {};

    // 1. Measure /api/me
    const startMe1 = Date.now();
    const resMe1 = await request.get("/api/me", { headers });
    const meLatency1 = Date.now() - startMe1;
    expect(resMe1.status()).toBe(200);

    const startMe2 = Date.now();
    const resMe2 = await request.get("/api/me", { headers });
    const meLatency2 = Date.now() - startMe2;
    expect(resMe2.status()).toBe(200);

    // 2. Measure /api/drive/list
    const startDrive1 = Date.now();
    const resDrive1 = await request.get("/api/drive/list", { headers });
    const driveLatency1 = Date.now() - startDrive1;
    expect([200, 401, 503]).toContain(resDrive1.status());

    const startDrive2 = Date.now();
    const resDrive2 = await request.get("/api/drive/list", { headers });
    const driveLatency2 = Date.now() - startDrive2;
    expect([200, 401, 503]).toContain(resDrive2.status());

    console.log(`[PERF LATENCY REPORT]`);
    console.log(`  -> /api/me Latency: Cold=${meLatency1}ms, Warm=${meLatency2}ms`);
    console.log(`  -> /api/drive/list Latency: Cold=${driveLatency1}ms, Warm=${driveLatency2}ms`);

    expect(meLatency2).toBeGreaterThan(0);
    expect(driveLatency2).toBeGreaterThan(0);
  });
});
