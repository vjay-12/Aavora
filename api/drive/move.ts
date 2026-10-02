import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { moveDriveItem } from "../_utils/drive.js";
import { json, error, parseJsonBody } from "../_utils/response.js";
import { db } from "../../src/db/index.js";
import { activity } from "../../src/db/schema.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST" && req.method !== "PATCH") {
    return error(res, "Method not allowed", 405);
  }

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const body = await parseJsonBody<{
      fileId: string;
      fileName: string;
      newParentId: string;
      oldParentId: string;
    }>(req);

    if (!body.fileId || !body.newParentId || !body.oldParentId) {
      return error(res, "Missing fileId, newParentId, or oldParentId", 400);
    }

    const item = await moveDriveItem(body.fileId, body.newParentId, body.oldParentId);

    // Record activity in Neon
    await db.insert(activity).values({
      userId: session.email,
      userName: session.name,
      action: "move",
      driveId: body.fileId,
      name: body.fileName || item.name,
      path: body.newParentId,
      meta: { oldParentId: body.oldParentId, newParentId: body.newParentId },
    });

    return json(res, { item });
  } catch (err: any) {
    return error(res, err.message || "Failed to move item", 500);
  }
}
