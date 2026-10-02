import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { renameDriveItem } from "../_utils/drive";
import { json, error, parseJsonBody } from "../_utils/response";
import { db } from "../../src/db";
import { activity } from "../../src/db/schema";

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
    return error(res, err.message || "Failed to rename item", 500);
  }
}
