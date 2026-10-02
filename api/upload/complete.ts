import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { assertInsideVault } from "../_utils/drive.js";
import { json, error, parseJsonBody } from "../_utils/response.js";
import { db } from "../../src/db/index.js";
import { activity } from "../../src/db/schema.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return error(res, "Method not allowed", 405);

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const body = await parseJsonBody<{
      driveId: string;
      name: string;
      path?: string;
      size?: number;
      mimeType?: string;
      tags?: string[];
      notes?: string;
    }>(req);

    if (!body.driveId || !body.name) {
      return error(res, "driveId and name are required", 400);
    }

    try {
      await assertInsideVault(body.driveId);
    } catch {
      return error(res, "Forbidden: Uploaded file is outside the family vault", 403);
    }

    // Record upload in Neon activity table
    await db.insert(activity).values({
      userId: session.email,
      userName: session.name,
      action: "upload",
      driveId: body.driveId,
      name: body.name,
      path: body.path,
      meta: {
        size: body.size,
        mimeType: body.mimeType,
        tags: body.tags || [],
        notes: body.notes || "",
      },
    });

    return json(res, { success: true });
  } catch (err: any) {
    console.error("Upload complete error:", err);
    return error(res, err.message || "Failed to record upload completion", 500);
  }
}
