import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { renameDriveItem } from "../_utils/drive.js";
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
      newName: string;
      oldName?: string;
    }>(req);

    if (!body.fileId || !body.newName || !body.newName.trim()) {
      return error(res, "File ID and new name are required", 400);
    }

    const item = await renameDriveItem(body.fileId, body.newName.trim());

    // Record activity in Neon
    await db.insert(activity).values({
      userId: session.email,
      userName: session.name,
      action: "rename",
      driveId: body.fileId,
      name: body.newName.trim(),
      meta: { oldName: body.oldName },
    });

    return json(res, { item });
  } catch (err: any) {
    if (err.statusCode === 403 || err.status === 403) {
      return error(res, "Forbidden: Item is outside the family vault", 403);
    }
    if (err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return json(res, { error: "Vault Google Drive is not connected.", code: "ADMIN_DRIVE_NOT_CONNECTED" }, 503);
    }
    return error(res, err.message || "Failed to rename item", 500);
  }
}
