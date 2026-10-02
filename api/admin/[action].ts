import type { IncomingMessage, ServerResponse } from "http";
import {
  authenticateRequest,
  parseCookies,
  createOAuthState,
  verifyOAuthState,
  OAUTH_STATE_COOKIE,
} from "../../server/auth.js";
import { handleAdminDriveConnectCallback } from "../../server/drive.js";
import { getEnv, getOAuthRedirectUri } from "../../server/env.js";
import { db } from "../../server/db/index.js";
import { users } from "../../server/db/schema.js";
import { eq, desc } from "drizzle-orm";
import { json, error, parseJsonBody } from "../../server/response.js";

function getAdminAction(req: IncomingMessage): string {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
  const pathname = url.pathname.toLowerCase();

  if (pathname.includes("/admin/drive/connect") || pathname.endsWith("/drive-connect") || pathname.endsWith("/connect")) {
    return "drive-connect";
  }
  if (pathname.includes("/admin/drive/callback") || pathname.endsWith("/drive-callback") || pathname.endsWith("/callback")) {
    return "drive-callback";
  }
  if (pathname.includes("/admin/users") || pathname.endsWith("/users")) {
    return "users";
  }

  const segments = pathname.split("/").filter(Boolean);
  const adminIdx = segments.indexOf("admin");
  if (adminIdx !== -1 && segments[adminIdx + 1]) {
    return segments.slice(adminIdx + 1).join("-");
  }
  return segments[segments.length - 1] || "";
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const action = getAdminAction(req);
  const method = req.method?.toUpperCase();

  // 1. GET /api/admin/drive/connect
  if (action === "drive-connect") {
    try {
      const user = await authenticateRequest(req, res);
      if (!user) {
        return error(res, "Unauthorized", 401);
      }

      const env = getEnv();
      if (user.role !== "admin" || user.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
        return error(res, "Forbidden: Only the designated admin can connect Google Drive.", 403);
      }

      const { stateParam, cookieValue } = createOAuthState("admin-connect", { adminEmail: user.email });
      const isProd = process.env.NODE_ENV === "production";
      res.setHeader(
        "Set-Cookie",
        `${OAUTH_STATE_COOKIE}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isProd ? "; Secure" : ""}`
      );

      const redirectUri = getOAuthRedirectUri();
      const scope = [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive",
      ].join(" ");

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        state: stateParam,
        scope,
        login_hint: user.email,
        prompt: "select_account consent",
        access_type: "offline",
        include_granted_scopes: "false",
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      res.statusCode = 302;
      res.setHeader("Location", authUrl);
      return res.end();
    } catch (err: any) {
      console.error("[Admin Drive Connect Error]:", err);
      return error(res, err.message || "Failed to initiate admin Drive connection", 500);
    }
  }

  // 2. GET /api/admin/drive/callback
  if (action === "drive-callback") {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const cookies = parseCookies(req.headers.cookie);
    const cookieState = cookies[OAUTH_STATE_COOKIE];

    // Clear admin OAuth state cookie
    const isProd = process.env.NODE_ENV === "production";
    res.setHeader(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`
    );

    const stateResult = verifyOAuthState(state, cookieState);
    if (errorParam || !code || !stateResult.valid) {
      res.statusCode = 302;
      const reason = errorParam || (!code ? "missing_code" : "invalid_state");
      res.setHeader(
        "Location",
        `/more?driveError=${encodeURIComponent(reason)}&msg=${encodeURIComponent("Authentication session expired or was cancelled.")}`
      );
      return res.end();
    }

    return await handleAdminDriveConnectCallback(req, res, code);
  }

  // 3. /api/admin/users
  if (action === "users") {
    try {
      const session = await authenticateRequest(req);
      if (!session) return error(res, "Unauthorized", 401);

      if (session.role !== "admin") {
        return error(res, "Forbidden: Admin privileges required", 403);
      }

      if (method === "GET") {
        const allUsers = await db
          .select()
          .from(users)
          .orderBy(desc(users.createdAt));
        return json(res, { users: allUsers });
      }

      if (method === "POST") {
        const body = await parseJsonBody<{
          email: string;
          name: string;
          role?: "admin" | "member";
        }>(req);

        if (!body.email || !body.name) {
          return error(res, "Email and name are required", 400);
        }

        const email = body.email.toLowerCase().trim();
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
          return error(res, "A user with this email already exists", 409);
        }

        const [newUser] = await db
          .insert(users)
          .values({
            email,
            name: body.name.trim(),
            role: body.role || "member",
            active: true,
          })
          .returning();

        return json(res, { user: newUser });
      }

      if (method === "PATCH") {
        const body = await parseJsonBody<{
          id: number;
          active?: boolean;
          role?: "admin" | "member";
        }>(req);

        if (!body.id) return error(res, "User ID is required", 400);

        if (body.id === session.id && body.active === false) {
          return error(res, "You cannot deactivate your own admin account", 400);
        }

        const updateData: Record<string, any> = {};
        if (typeof body.active === "boolean") updateData.active = body.active;
        if (body.role) updateData.role = body.role;

        const [updated] = await db
          .update(users)
          .set(updateData)
          .where(eq(users.id, body.id))
          .returning();

        return json(res, { user: updated });
      }

      if (method === "DELETE") {
        const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
        const idStr = url.searchParams.get("id");
        if (!idStr) return error(res, "User ID is required", 400);

        const userId = parseInt(idStr, 10);
        if (userId === session.id) {
          return error(res, "You cannot delete your own admin account", 400);
        }

        await db.delete(users).where(eq(users.id, userId));
        return json(res, { success: true });
      }

      return error(res, `Method ${method} not allowed`, 405);
    } catch (err: any) {
      console.error("[Admin Users Error]:", err);
      return error(res, err.message || "Failed to process user operation", 500);
    }
  }

  return error(res, `Unknown admin action: ${action}`, 404);
}
