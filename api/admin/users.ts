import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { json, error, parseJsonBody } from "../_utils/response.js";
import { db } from "../../src/db/index.js";
import { users } from "../../src/db/schema.js";
import { eq, desc } from "drizzle-orm";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    // Admin only
    if (session.role !== "admin") {
      return error(res, "Forbidden: Admin privileges required", 403);
    }

    if (req.method === "GET") {
      const allUsers = await db
        .select()
        .from(users)
        .orderBy(desc(users.createdAt));

      return json(res, { users: allUsers });
    }

    if (req.method === "POST") {
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

    if (req.method === "PATCH") {
      const body = await parseJsonBody<{
        id: number;
        active?: boolean;
        role?: "admin" | "member";
      }>(req);

      if (!body.id) return error(res, "User ID is required", 400);

      // Prevent admin deactivating self
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

    if (req.method === "DELETE") {
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

    return error(res, "Method not allowed", 405);
  } catch (err: any) {
    return error(res, err.message || "Failed to manage users", 500);
  }
}
