import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { createDriveFolder } from "../_utils/drive.js";
import { json, error, parseJsonBody } from "../_utils/response.js";
import { db } from "../../src/db/index.js";
import { activity } from "../../src/db/schema.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return error(res, "Method not allowed", 405);

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const body = await parseJsonBody<{
      name: string;
      parentId?: string;
      color?: string;
      icon?: string;
    }>(req);

    if (!body.name || !body.name.trim()) {
      return error(res, "Folder name is required", 400);
    }

    const appProperties: Record<string, string> = {
      createdBy: session.email,
      createdByName: session.name,
    };
    if (body.color) appProperties.cardColor = body.color;
    if (body.icon) appProperties.cardIcon = body.icon;

    const folder = await createDriveFolder(body.name.trim(), body.parentId, appProperties);

    // Record activity in Neon
    await db.insert(activity).values({
      userId: session.email,
      userName: session.name,
      action: "create_folder",
      driveId: folder.id,
      name: folder.name,
      path: body.parentId,
      meta: { color: body.color, icon: body.icon },
    });

    return json(res, { folder });
  } catch (err: any) {
    if (err.statusCode === 403 || err.status === 403) {
      return error(res, "Forbidden: Target folder is outside the family vault", 403);
    }
    if (err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return json(res, { error: "Vault Google Drive is not connected.", code: "ADMIN_DRIVE_NOT_CONNECTED" }, 503);
    }
    console.error("Create folder error:", err);
    return error(res, err.message || "Failed to create folder", 500);
  }
}
