import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getUserGivenName,
  getUserFullName,
  getUserInitials,
  getTimeGreeting,
  getGreeting,
  getEmailFallback,
} from "../../src/lib/user-format.js";
import authHandler from "../../api/auth/[action].js";
import activityHandler from "../../api/activity/[action].js";
import adminHandler from "../../api/admin/[action].js";
import { db } from "../../server/db/index.js";
import { users, activity } from "../../server/db/schema.js";
import { eq } from "drizzle-orm";
import {
  createSessionToken,
  COOKIE_NAME,
  createOAuthState,
  OAUTH_STATE_COOKIE,
} from "../../server/auth.js";
import { SignJWT } from "jose";

describe("User Display & Greeting Rules", () => {
  describe("Formatting Helpers & Fallbacks", () => {
    it("capitalizes the first letter of email prefix as fallback", () => {
      expect(getEmailFallback("vhrbaskaran@gmail.com")).toBe("Vhrbaskaran");
      expect(getEmailFallback("alex.smith@example.org")).toBe("Alex.smith");
      expect(getEmailFallback("")).toBe("User");
      expect(getEmailFallback(null)).toBe("User");
    });

    it("extracts given name (first name only) with priority", () => {
      // 1. Explicit givenName
      expect(
        getUserGivenName({
          givenName: "Vijay",
          name: "Vijay Hr Baskaran",
          email: "vhrbaskaran@gmail.com",
        })
      ).toBe("Vijay");

      // 2. First word from full name
      expect(
        getUserGivenName({
          name: "Vijay Hr Baskaran",
          email: "vhrbaskaran@gmail.com",
        })
      ).toBe("Vijay");

      // 3. Fallback when name is empty or identical to uncapitalized email prefix
      expect(
        getUserGivenName({
          name: "vhrbaskaran",
          email: "vhrbaskaran@gmail.com",
        })
      ).toBe("Vhrbaskaran");

      expect(
        getUserGivenName({
          name: "",
          email: "testuser@domain.com",
        })
      ).toBe("Testuser");
    });

    it("extracts full name with proper fallback", () => {
      expect(
        getUserFullName({
          name: "Vijay Hr Baskaran",
          email: "vhrbaskaran@gmail.com",
        })
      ).toBe("Vijay Hr Baskaran");

      expect(
        getUserFullName({
          name: "vhrbaskaran",
          email: "vhrbaskaran@gmail.com",
        })
      ).toBe("Vhrbaskaran");

      expect(
        getUserFullName({
          name: "",
          email: "member@vault.internal",
        })
      ).toBe("Member");
    });

    it("generates correct 1-2 letter initials", () => {
      expect(getUserInitials("Vijay Hr Baskaran")).toBe("VB");
      expect(getUserInitials("Vijay")).toBe("VI");
      expect(getUserInitials("", "vhrbaskaran@gmail.com")).toBe("VH");
    });

    it("produces time-aware greetings and uses first name only", () => {
      const morningDate = new Date("2026-10-02T08:30:00");
      const afternoonDate = new Date("2026-10-02T14:15:00");
      const eveningDate = new Date("2026-10-02T20:45:00");

      expect(getTimeGreeting(morningDate)).toBe("Good morning");
      expect(getTimeGreeting(afternoonDate)).toBe("Good afternoon");
      expect(getTimeGreeting(eveningDate)).toBe("Good evening");

      const user = {
        name: "Vijay Hr Baskaran",
        givenName: "Vijay",
        email: "vhrbaskaran@gmail.com",
      };

      expect(getGreeting(user, morningDate)).toBe("Good morning, Vijay");
      expect(getGreeting(user, afternoonDate)).toBe("Good afternoon, Vijay");
      expect(getGreeting(user, eveningDate)).toBe("Good evening, Vijay");

      // Fallback user
      const fallbackUser = {
        name: "vhrbaskaran",
        email: "vhrbaskaran@gmail.com",
      };
      expect(getGreeting(fallbackUser, morningDate)).toBe("Good morning, Vhrbaskaran");
    });
  });

  describe("Authentication, Profile Persistence & Lock Rules", () => {
    let originalFetch: typeof global.fetch;
    const testUserEmail = "test_user_greeting_spec@aavora.internal";
    const testAdminEmail = "test_admin_backfill_spec@aavora.internal";

    const createFakeRes = () => {
      let statusCode = 200;
      const headers: Record<string, any> = {};
      let bodyData = "";

      const res: any = {
        setHeader(name: string, val: any) {
          headers[name.toLowerCase()] = val;
        },
        getHeader(name: string) {
          return headers[name.toLowerCase()] || null;
        },
        end(data?: string) {
          if (data) bodyData = data;
        },
      };

      Object.defineProperty(res, "statusCode", {
        set(val) {
          statusCode = val;
        },
        get() {
          return statusCode;
        },
      });

      return {
        res,
        getCode: () => statusCode,
        getHeader: (k: string) => headers[k.toLowerCase()],
        getBody: () => {
          try {
            return JSON.parse(bodyData);
          } catch {
            return bodyData;
          }
        },
      };
    };

    const createFakeReq = (options: {
      method?: string;
      url: string;
      cookies?: Record<string, string>;
      body?: any;
    }) => {
      const { method = "GET", url, cookies = {}, body } = options;
      const bodyStr = body ? JSON.stringify(body) : "";

      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("; ");

      const listeners: Record<string, Function[]> = {};

      const req: any = {
        method,
        url,
        body,
        headers: {
          host: "localhost:5173",
          cookie: cookieHeader,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(bodyStr).toString(),
        },
        on(event: string, cb: Function) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
          return req;
        },
      };

      setTimeout(() => {
        if (bodyStr && listeners["data"]) {
          listeners["data"].forEach((cb) => cb(Buffer.from(bodyStr)));
        }
        if (listeners["end"]) {
          listeners["end"].forEach((cb) => cb());
        }
      }, 5);

      return req;
    };

    beforeEach(async () => {
      originalFetch = global.fetch;

      // Clean up previous test users if any
      await db.delete(users).where(eq(users.email, testUserEmail));
      await db.delete(users).where(eq(users.email, testAdminEmail));
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("saves real name, given_name and picture from Google on login callback", async () => {
      // 1. Seed user with default email prefix
      await db.insert(users).values({
        email: testUserEmail,
        name: "test_user_greeting_spec",
        role: "member",
        active: true,
        nameLocked: false,
      });

      // 2. Prepare mock Google OAuth tokens
      const mockIdToken = await new SignJWT({
        email: testUserEmail,
        email_verified: true,
        name: "Vijay Hr Baskaran",
        given_name: "Vijay",
        picture: "https://lh3.googleusercontent.com/a/mock-pic-123",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("any-secret-for-decodeJwt-unit-test-12345"));

      global.fetch = (async (url: any, init?: any) => {
        const urlStr = String(url);
        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: "mock_google_access_token_123",
              id_token: mockIdToken,
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url, init);
      }) as any;

      const { stateParam, cookieValue } = createOAuthState("login");

      const req = createFakeReq({
        method: "GET",
        url: `/api/auth/callback?code=mock_code&state=${stateParam}`,
        cookies: {
          [OAUTH_STATE_COOKIE]: cookieValue,
        },
      });
      const { res, getCode, getHeader } = createFakeRes();

      await authHandler(req, res);

      expect(getCode()).toBe(302);
      expect(getHeader("location")).toBe("/docs");

      // Verify row in Neon users table
      const [updated] = await db
        .select()
        .from(users)
        .where(eq(users.email, testUserEmail))
        .limit(1);

      expect(updated.name).toBe("Vijay Hr Baskaran");
      expect(updated.givenName).toBe("Vijay");
      expect(updated.picture).toBe("https://lh3.googleusercontent.com/a/mock-pic-123");
    });

    it("does NOT overwrite manually set or locked name on login callback", async () => {
      // 1. Seed user with locked manual name
      await db.insert(users).values({
        email: testUserEmail,
        name: "Custom Manual Name",
        givenName: "Custom",
        role: "member",
        active: true,
        nameLocked: true,
      });

      const mockIdToken = await new SignJWT({
        email: testUserEmail,
        email_verified: true,
        name: "Google Different Name",
        given_name: "Google",
        picture: "https://lh3.googleusercontent.com/a/new-picture-456",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("any-secret-for-decodeJwt-unit-test-12345"));

      global.fetch = (async (url: any, init?: any) => {
        const urlStr = String(url);
        if (urlStr.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: "mock_google_access_token_123",
              id_token: mockIdToken,
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url, init);
      }) as any;

      const { stateParam, cookieValue } = createOAuthState("login");

      const req = createFakeReq({
        method: "GET",
        url: `/api/auth/callback?code=mock_code&state=${stateParam}`,
        cookies: {
          [OAUTH_STATE_COOKIE]: cookieValue,
        },
      });
      const { res, getCode } = createFakeRes();

      await authHandler(req, res);
      expect(getCode()).toBe(302);

      // Verify row in Neon users table was preserved!
      const [updated] = await db
        .select()
        .from(users)
        .where(eq(users.email, testUserEmail))
        .limit(1);

      expect(updated.name).toBe("Custom Manual Name");
      expect(updated.givenName).toBe("Custom");
      // Picture can still be updated if provided
      expect(updated.picture).toBe("https://lh3.googleusercontent.com/a/new-picture-456");
    });

    it("locks the name when admin updates a user via /api/admin/users", async () => {
      // 1. Create member user
      const [seeded] = await db
        .insert(users)
        .values({
          email: testUserEmail,
          name: "Original Name",
          role: "member",
          active: true,
          nameLocked: false,
        })
        .returning();

      // 2. Ensure an admin exists in database
      const [existingAdmin] = await db
        .select()
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);

      let adminUser = existingAdmin;
      if (!adminUser) {
        const [createdAdmin] = await db
          .insert(users)
          .values({
            email: testAdminEmail,
            name: "Admin Tester",
            role: "admin",
            active: true,
          })
          .returning();
        adminUser = createdAdmin;
      }

      // Admin session token
      const adminToken = await createSessionToken({
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: "admin",
      });

      const patchReq = createFakeReq({
        method: "PATCH",
        url: "/api/admin/users",
        cookies: { [COOKIE_NAME]: adminToken },
        body: {
          id: seeded.id,
          name: "Admin Given Override",
        },
      });
      const { res, getCode, getBody } = createFakeRes();

      await adminHandler(patchReq, res);
      expect(getCode()).toBe(200);
      expect(getBody().user.nameLocked).toBe(true);

      const [inDb] = await db.select().from(users).where(eq(users.id, seeded.id)).limit(1);
      expect(inDb.name).toBe("Admin Given Override");
      expect(inDb.nameLocked).toBe(true);
    });

    it("protects user email privacy from non-admin clients in activity feed", async () => {
      const otherUserEmail = "secret_other_user@gmail.com";

      // Seed activity item with another user's email
      const [insertedActivity] = await db
        .insert(activity)
        .values({
          userId: otherUserEmail,
          userName: "Secret User",
          action: "upload",
          driveId: "test_drive_file_privacy_123",
          name: "Confidential.pdf",
        })
        .returning();

      // Seed member in users table
      const [seededMember] = await db
        .insert(users)
        .values({
          email: testUserEmail,
          name: "Normal Member",
          role: "member",
          active: true,
        })
        .returning();

      // 1. Member session querying activity
      const memberToken = await createSessionToken({
        id: seededMember.id,
        email: seededMember.email,
        name: seededMember.name,
        role: "member",
      });

      const memberReq = createFakeReq({
        method: "GET",
        url: "/api/activity",
        cookies: { [COOKIE_NAME]: memberToken },
      });
      const memberRes = createFakeRes();

      await activityHandler(memberReq, memberRes.res);
      expect(memberRes.getCode()).toBe(200);

      const memberItems: any[] = memberRes.getBody().items;
      const targetItemForMember = memberItems.find((i) => i.id === insertedActivity.id);
      expect(targetItemForMember).toBeDefined();
      // Other user's email is stripped for member!
      expect(targetItemForMember.userId).toBe("");
      expect(targetItemForMember.userName).toBe("Secret User");

      // 2. Admin session querying activity
      const [existingAdmin] = await db
        .select()
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);

      const adminToken = await createSessionToken({
        id: existingAdmin.id,
        email: existingAdmin.email,
        name: existingAdmin.name,
        role: "admin",
      });

      const adminReq = createFakeReq({
        method: "GET",
        url: "/api/activity",
        cookies: { [COOKIE_NAME]: adminToken },
      });
      const adminRes = createFakeRes();

      await activityHandler(adminReq, adminRes.res);
      expect(adminRes.getCode()).toBe(200);

      const adminItems: any[] = adminRes.getBody().items;
      const targetItemForAdmin = adminItems.find((i) => i.id === insertedActivity.id);
      expect(targetItemForAdmin).toBeDefined();
      // Admin sees the email
      expect(targetItemForAdmin.userId).toBe(otherUserEmail);

      // Clean up activity
      await db.delete(activity).where(eq(activity.id, insertedActivity.id));
    });
  });
});
