import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "./_utils/auth.js";
import { json, error } from "./_utils/response.js";
import { db } from "../src/db/index.js";
import { activity } from "../src/db/schema.js";
import { desc, eq, and, lt } from "drizzle-orm";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const actionFilter = url.searchParams.get("action");
    const userFilter = url.searchParams.get("user");
    const cursor = url.searchParams.get("cursor"); // ISO timestamp cursor
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

    const conditions = [];

    if (actionFilter && actionFilter !== "all") {
      conditions.push(eq(activity.action, actionFilter as any));
    }
    if (userFilter && userFilter !== "all") {
      conditions.push(eq(activity.userId, userFilter));
    }
    if (cursor) {
      conditions.push(lt(activity.createdAt, new Date(cursor)));
    }

    // Single indexed query as per Neon speed plan
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select()
      .from(activity)
      .where(whereClause)
      .orderBy(desc(activity.createdAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    const records = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? records[records.length - 1].createdAt.toISOString() : null;

    return json(res, {
      items: records,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    console.error("Activity feed query error:", err);
    return error(res, err.message || "Failed to fetch activity", 500);
  }
}
