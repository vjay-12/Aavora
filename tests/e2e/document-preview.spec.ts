import { test, expect } from "@playwright/test";

// Minimal valid 1x1 transparent PNG
const samplePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const samplePngBuffer = Buffer.from(samplePngBase64, "base64");

// Minimal valid 1x1 JPEG
const sampleJpgBase64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const sampleJpgBuffer = Buffer.from(sampleJpgBase64, "base64");

// Minimal valid 2-page PDF
const sampleTwoPagePdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 6 0 R >>
endobj
5 0 obj
<< /Length 39 >>
stream
BT /Helvetica 14 Tf 50 150 Td (Page 1) Tj ET
endstream
endobj
6 0 obj
<< /Length 39 >>
stream
BT /Helvetica 14 Tf 50 150 Td (Page 2) Tj ET
endstream
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000120 00000 n 
0000000210 00000 n 
0000000300 00000 n 
0000000389 00000 n 
trailer
<< /Size 7 /Root 1 0 R >>
startxref
478
%%EOF`;
const samplePdfBuffer = Buffer.from(sampleTwoPagePdf, "utf-8");

const sampleFiles = [
  {
    id: "sample-file-png",
    name: "Revenue_Chart.png",
    mimeType: "image/png",
    isFolder: false,
    size: "1024",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault Admin",
  },
  {
    id: "sample-file-jpg",
    name: "Building_Exterior.jpg",
    mimeType: "image/jpeg",
    isFolder: false,
    size: "2048",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault Admin",
  },
  {
    id: "sample-file-jpeg",
    name: "Security_Pass.jpeg",
    mimeType: "image/jpeg",
    isFolder: false,
    size: "2048",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault Admin",
  },
  {
    id: "sample-file-pdf",
    name: "Employee_Handbook.pdf",
    mimeType: "application/pdf",
    isFolder: false,
    size: samplePdfBuffer.length.toString(),
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault Admin",
  },
  {
    id: "sample-file-docx",
    name: "Employment_Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    isFolder: false,
    size: "15360",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault Admin",
  },
  {
    id: "sample-file-zip",
    name: "Project_Assets.zip",
    mimeType: "application/zip",
    isFolder: false,
    size: "1048576",
    modifiedTime: new Date().toISOString(),
    lastModifyingUser: "Vault Admin",
  },
];

test.describe("Aavora In-App Document Viewer", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as Admin
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: 1,
            email: "admin@aavora.family",
            name: "Admin User",
            role: "admin",
          },
        }),
      });
    });

    // Mock file listing
    await page.route("**/api/drive/list*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: sampleFiles,
          rootFolderId: "vault_root_123",
        }),
      });
    });

    // Mock stars
    await page.route("**/api/stars*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [] }),
      });
    });

    // Mock activity
    await page.route("**/api/activity*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    });

    // Mock document file stream endpoint
    await page.route("**/api/drive/file*", async (route) => {
      const url = new URL(route.request().url());
      const id = url.searchParams.get("id");
      const mode = url.searchParams.get("mode") || "view";

      if (!id || id === "wrong_id") {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "File not found" }),
        });
      }

      if (id === "outside_root") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "Forbidden: File is outside vault" }),
        });
      }

      const disposition =
        mode === "download"
          ? 'attachment; filename="document.bin"'
          : 'inline; filename="document.bin"';

      if (id === "sample-file-png") {
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: {
            "Content-Disposition": mode === "download" ? 'attachment; filename="Revenue_Chart.png"' : 'inline; filename="Revenue_Chart.png"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
          body: samplePngBuffer,
        });
      }

      if (id === "sample-file-jpg" || id === "sample-file-jpeg") {
        const fname = id === "sample-file-jpg" ? "Building_Exterior.jpg" : "Security_Pass.jpeg";
        return route.fulfill({
          status: 200,
          contentType: "image/jpeg",
          headers: {
            "Content-Disposition": mode === "download" ? `attachment; filename="${fname}"` : `inline; filename="${fname}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
          body: sampleJpgBuffer,
        });
      }

      if (id === "sample-file-pdf") {
        return route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: {
            "Content-Disposition": mode === "download" ? 'attachment; filename="Employee_Handbook.pdf"' : 'inline; filename="Employee_Handbook.pdf"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
          },
          body: samplePdfBuffer,
        });
      }

      if (id === "sample-file-docx") {
        if (mode === "view") {
          return route.fulfill({
            status: 200,
            contentType: "application/pdf",
            headers: {
              "Content-Disposition": 'inline; filename="Employment_Agreement.pdf"',
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
            body: samplePdfBuffer,
          });
        } else {
          return route.fulfill({
            status: 200,
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers: {
              "Content-Disposition": 'attachment; filename="Employment_Agreement.docx"',
            },
            body: Buffer.from("docx-binary-payload"),
          });
        }
      }

      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "Content-Disposition": disposition },
        body: Buffer.from("generic-binary"),
      });
    });
  });

  test("Opens PNG, JPG, and JPEG images with zoom controls and no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/docs");
    await expect(page.getByText("Revenue_Chart.png").first()).toBeVisible();

    // 1. Open PNG
    await page.getByText("Revenue_Chart.png").first().click();
    const container = page.locator('[data-testid="document-preview-container"]');
    await expect(container).toBeVisible();

    const img = page.locator('[data-testid="preview-image-img"]');
    await expect(img).toBeVisible();

    // Zoom In
    const zoomInBtn = page.locator('[data-testid="zoom-in-btn"]');
    await expect(zoomInBtn).toBeVisible();
    await zoomInBtn.click();
    await expect(page.locator('[data-testid="zoom-reset-btn"]')).toHaveText("150%");

    const closePreview = async () => {
      const backBtn = page.locator('[data-testid="doc-preview-back"]');
      if (await backBtn.isVisible()) {
        await backBtn.click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(container).not.toBeVisible();
    };

    // Close preview
    await closePreview();

    // 2. Open JPG
    await page.getByText("Building_Exterior.jpg").first().click();
    await expect(container).toBeVisible();
    await expect(img).toBeVisible();
    await closePreview();

    // 3. Open JPEG
    await page.getByText("Security_Pass.jpeg").first().click();
    await expect(container).toBeVisible();
    await expect(img).toBeVisible();
    await closePreview();

    // Check no unexpected console errors
    expect(consoleErrors).toEqual([]);
  });

  test("Opens multi-page PDF with canvas rendering, page navigation and counter", async ({ page }) => {
    await page.goto("/docs");
    await page.getByText("Employee_Handbook.pdf").first().click();

    const container = page.locator('[data-testid="document-preview-container"]');
    await expect(container).toBeVisible();

    // Verify canvas rendered
    const canvas = page.locator('[data-testid="preview-pdf-canvas"]');
    await expect(canvas).toBeVisible();

    // Check Page Counter: "Page 1 of 2"
    const counter = page.locator('[data-testid="pdf-page-counter"]');
    await expect(counter).toContainText("Page 1 of 2");

    // Click Next Page
    const nextBtn = page.locator('[data-testid="pdf-next-page"]');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Counter updates to Page 2 of 2
    await expect(counter).toContainText("Page 2 of 2");
    await expect(nextBtn).toBeDisabled();

    // Click Previous Page
    const prevBtn = page.locator('button[aria-label="Previous Page"]');
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();
    await expect(counter).toContainText("Page 1 of 2");
  });

  test("Opens Word (DOCX) document showing converted PDF preview badge and Download original button", async ({
    page,
  }) => {
    await page.goto("/docs");
    await page.getByText("Employment_Agreement.docx").first().click();

    const container = page.locator('[data-testid="document-preview-container"]');
    await expect(container).toBeVisible();

    // Converted preview badge
    await expect(page.getByText("Converted preview")).toBeVisible();

    // Canvas rendered
    const canvas = page.locator('[data-testid="preview-pdf-canvas"]');
    await expect(canvas).toBeVisible();

    // Download Original button
    const downloadOriginalBtn = page.locator('[data-testid="download-original-btn"]');
    await expect(downloadOriginalBtn).toBeVisible();
  });

  test("Opens non-previewable file (ZIP) and displays metadata card with Download button", async ({ page }) => {
    await page.goto("/docs");
    await page.getByText("Project_Assets.zip").first().click();

    const container = page.locator('[data-testid="document-preview-container"]');
    await expect(container).toBeVisible();

    // Generic card visible
    const genericCard = page.locator('[data-testid="doc-preview-generic"]');
    await expect(genericCard).toBeVisible();
    await expect(genericCard).toContainText("Project_Assets.zip");
    await expect(genericCard).toContainText("ZIP");

    // Download button
    const genericDownloadBtn = page.locator('[data-testid="generic-download-btn"]');
    await expect(genericDownloadBtn).toBeVisible();
  });

  test("Responsive layout: Mobile shows back button and Desktop closes on Escape", async ({ page, isMobile }) => {
    await page.goto("/docs");
    await page.getByText("Revenue_Chart.png").first().click();

    const container = page.locator('[data-testid="document-preview-container"]');
    await expect(container).toBeVisible();

    if (isMobile) {
      // Mobile has back button
      const backBtn = page.locator('[data-testid="doc-preview-back"]');
      await expect(backBtn).toBeVisible();
      await backBtn.click();
      await expect(container).not.toBeVisible();
    } else {
      // Desktop closes on Escape
      await page.keyboard.press("Escape");
      await expect(container).not.toBeVisible();
    }
  });

  test("Security & Content-Disposition header verification for view vs download and error responses", async ({
    page,
  }) => {
    await page.goto("/docs");

    const getHeaders = async (url: string) => {
      return page.evaluate(async (fetchUrl) => {
        const res = await fetch(fetchUrl);
        const headers: Record<string, string> = {};
        res.headers.forEach((val, key) => {
          headers[key.toLowerCase()] = val;
        });
        return { status: res.status, headers };
      }, url);
    };

    // 1. View mode returns inline headers
    const viewRes = await getHeaders("/api/drive/file?id=sample-file-png&mode=view");
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers["content-disposition"]).toContain("inline");
    expect(viewRes.headers["content-type"]).toBe("image/png");

    // 2. Download mode returns attachment headers
    const downloadRes = await getHeaders("/api/drive/file?id=sample-file-png&mode=download");
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers["content-disposition"]).toContain("attachment");

    // 3. ID outside root returns 403
    const forbiddenRes = await getHeaders("/api/drive/file?id=outside_root&mode=view");
    expect(forbiddenRes.status).toBe(403);

    // 4. Missing ID returns 404
    const notFoundRes = await getHeaders("/api/drive/file?id=wrong_id&mode=view");
    expect(notFoundRes.status).toBe(404);
  });
});
