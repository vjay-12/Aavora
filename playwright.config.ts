import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "Desktop-1440x900",
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "Mobile-Pixel7",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
