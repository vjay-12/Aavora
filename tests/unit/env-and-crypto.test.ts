import { describe, it, expect } from "vitest";
import { formatBytes, formatDate, cn } from "../../src/lib/utils";
import { validateEnv } from "../../server/env";
import { createSessionToken, verifySessionToken } from "../../server/auth";

describe("Unit Tests: Formatters & Utilities", () => {
  it("formatBytes correctly formats file sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1073741824)).toBe("1 GB");
  });

  it("formatDate handles ISO strings and returns readable dates", () => {
    const formatted = formatDate("2026-03-15T12:00:00Z");
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe("string");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate(new Date())).toBe("Just now");
  });

  it("cn utility merges class names correctly", () => {
    expect(cn("bg-red-500", "text-white")).toBe("bg-red-500 text-white");
    expect(cn("p-4", "p-2")).toBe("p-2"); // tailwind-merge override
  });

  it("validateEnv throws descriptive error when variables are missing without leaking secrets", () => {
    expect(() => {
      validateEnv({});
    }).toThrow(/Missing required environment variables/);

    expect(() => {
      validateEnv({
        DATABASE_URL: "postgres://fake",
        GOOGLE_CLIENT_ID: "client_id",
        GOOGLE_CLIENT_SECRET: "client_secret",
        GOOGLE_REDIRECT_URI: "http://localhost:5173/api/auth/callback",
        GOOGLE_DRIVE_ROOT_FOLDER_ID: "folder_id",
        ADMIN_EMAIL: "admin@example.com",
        SESSION_SECRET: "too_short",
        APP_URL: "http://localhost:5173",
      });
    }).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });
});

describe("Unit Tests: Auth Crypto & Session Tokens (jose AES-256-GCM)", () => {
  const samplePayload = {
    id: 1,
    email: "test.admin@aavora.internal",
    name: "Admin Tester",
    role: "admin" as const,
  };

  it("creates encrypted JWE token with 5 compact parts", async () => {
    const token = await createSessionToken(samplePayload);
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts.length).toBe(5);
  });

  it("verifies and decrypts token payload correctly", async () => {
    const token = await createSessionToken(samplePayload);
    const decrypted = await verifySessionToken(token);
    expect(decrypted).not.toBeNull();
    expect(decrypted?.email).toBe(samplePayload.email);
    expect(decrypted?.role).toBe("admin");
    expect(decrypted?.name).toBe(samplePayload.name);
  });

  it("returns null for tampered ciphertext", async () => {
    const token = await createSessionToken(samplePayload);
    const tampered = token.slice(0, -6) + "xxxxxx";
    const result = await verifySessionToken(tampered);
    expect(result).toBeNull();
  });
});
