import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

test.describe("Auth & Access Control UI", () => {
  const screenshotDir = path.resolve(process.cwd(), "tests/screenshots");
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  test("Login page renders cleanly with no console errors and Google CTA starts redirect", async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      // Chrome logs 401 responses for fetch(/api/auth/me) as console errors; this is expected when logged out
      if (msg.type() === "error" && !msg.text().includes("401")) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check no console errors
    expect(consoleErrors).toEqual([]);

    // Check branding
    await expect(page.getByText("AAVORA", { exact: true })).toBeVisible();
    await expect(page.locator("text=Private Family & Personal Document Cloud")).toBeVisible();

    // Check Continue with Google button
    const googleBtn = page.getByRole("button", { name: /Continue with Google/i });
    await expect(googleBtn).toBeVisible();

    // Take screenshot
    await page.screenshot({
      path: path.join(screenshotDir, `login-page-${testInfo.project.name}.png`),
    });

    // Check clicking button initiates redirect to Google OAuth endpoint (/api/auth/login)
    await Promise.all([
      page.waitForURL((url) => url.pathname.includes("/api/auth/login") || url.hostname.includes("accounts.google.com"), {
        timeout: 10000,
      }).catch(() => null),
      googleBtn.click(),
    ]);

    expect(
      page.url().includes("/api/auth/login") ||
      page.url().includes("accounts.google.com")
    ).toBeTruthy();
  });

  test("Access Denied page shows unauthorized message and action button", async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("401")) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/access-denied?email=intruder@unknown.com&error=unregistered");
    await page.waitForLoadState("networkidle");

    expect(consoleErrors).toEqual([]);
    await expect(page.getByRole("heading", { name: "Access Denied" })).toBeVisible();
    await expect(page.locator("text=intruder@unknown.com")).toBeVisible();

    // Check Try Again button
    const retryBtn = page.getByRole("button", { name: /Sign In with Authorized Google Account/i });
    await expect(retryBtn).toBeVisible();

    // Check Back to Home button
    const backBtn = page.getByRole("button", { name: /Back to Home/i });
    await expect(backBtn).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, `access-denied-${testInfo.project.name}.png`),
    });
  });
});
