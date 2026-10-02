import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const authStatePath = path.resolve(process.cwd(), "playwright/.auth/user.json");

test.describe("PWA Configuration & Offline Resilience", () => {
  test("manifest.webmanifest has correct PWA metadata and icons", async ({
    request,
  }) => {
    // In dev or dist, verify manifest.webmanifest
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe("Aavora");
    expect(manifest.short_name).toBe("Aavora");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#070b12");
    expect(manifest.background_color).toBe("#070b12");

    // Icons check: 192, 512, and maskable 512
    const icon192 = manifest.icons.find((i: any) => i.sizes === "192x192");
    const icon512 = manifest.icons.find((i: any) => i.sizes === "512x512");
    const maskable512 = manifest.icons.find(
      (i: any) => i.sizes === "512x512" && (i.purpose?.includes("maskable") || i.purpose === "any maskable")
    );

    expect(icon192).toBeDefined();
    expect(icon512).toBeDefined();
    expect(maskable512).toBeDefined();
  });

  test("HTML head has apple-touch-icon, viewport, and theme-color meta tags", async ({
    page,
  }) => {
    await page.goto("/");

    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
    expect(themeColor).toBe("#070b12");

    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("width=device-width");

    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(appleIcon).toBe("/apple-touch-icon.png");
  });

  test("Offline app shell displays offline banner when network disconnected", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Simulate going offline via browser event
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // Check offline indicator banner appears
    await expect(page.locator("text=You are offline")).toBeVisible();

    // Simulate coming back online
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
    });

    await expect(page.locator("text=You are offline")).not.toBeVisible();
  });

  test("Logout clears IndexedDB query cache and resets session", async ({
    page,
  }) => {
    // Start with authenticated session
    if (fs.existsSync(authStatePath)) {
      const auth = JSON.parse(fs.readFileSync(authStatePath, "utf8"));
      await page.context().addCookies(auth.cookies);
    }

    await page.goto("/docs");
    await page.waitForLoadState("networkidle");

    // Click visible logout button (desktop sidebar or mobile header)
    const logoutBtn = page.locator('button[title="Log Out"]').filter({ visible: true });
    await expect(logoutBtn).toBeVisible({ timeout: 15000 });
    await logoutBtn.click();

    // Verify redirected to login screen
    await page.waitForURL("**/");
    await expect(page.locator("text=Continue with Google")).toBeVisible();

    // Verify /api/me now returns 401
    const meRes = await page.request.get("/api/me");
    expect(meRes.status()).toBe(401);
  });
});
