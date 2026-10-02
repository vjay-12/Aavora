import "dotenv/config";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import fs from "fs";

// Vite dev server plugin to execute /api serverless handlers locally
function apiDevServerPlugin(): Plugin {
  return {
    name: "api-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) {
          return next();
        }

        const url = new URL(req.url, `http://${req.headers.host || "localhost:5173"}`);
        let pathname = url.pathname; // e.g. /api/drive/list

        // Map pathname to file path
        let targetFile = path.resolve(import.meta.dirname, `.${pathname}.ts`);
        if (!fs.existsSync(targetFile)) {
          targetFile = path.resolve(import.meta.dirname, `.${pathname}/index.ts`);
        }

        // Map to consolidated catch-all handlers
        if (!fs.existsSync(targetFile)) {
          if (
            pathname.startsWith("/api/auth/") ||
            pathname === "/api/callback" ||
            pathname === "/api/logout" ||
            pathname === "/api/me"
          ) {
            targetFile = path.resolve(import.meta.dirname, "./api/auth/[action].ts");
          } else if (pathname.startsWith("/api/drive/") || pathname.startsWith("/api/upload/")) {
            targetFile = path.resolve(import.meta.dirname, "./api/drive/[action].ts");
          } else if (pathname.startsWith("/api/admin/")) {
            targetFile = path.resolve(import.meta.dirname, "./api/admin/[action].ts");
          } else if (pathname.startsWith("/api/activity")) {
            targetFile = path.resolve(import.meta.dirname, "./api/activity/[action].ts");
          } else if (pathname.startsWith("/api/stars")) {
            targetFile = path.resolve(import.meta.dirname, "./api/stars/[action].ts");
          }
        }

        if (fs.existsSync(targetFile)) {
          try {
            const module = await server.ssrLoadModule(targetFile);
            const handler = module.default;
            if (typeof handler === "function") {
              await handler(req, res);
              return;
            }
          } catch (err: any) {
            console.error(`[API Dev Server Error] ${pathname}:`, err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message || "Internal server error" }));
            return;
          }
        }

        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    apiDevServerPlugin(),
    VitePWA({
      devOptions: {
        enabled: false,
      },
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Aavora",
        short_name: "Aavora",
        description: "Private Google Drive & Neon powered secure cloud document vault",
        theme_color: "#070b12",
        background_color: "#070b12",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\/.*/],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
