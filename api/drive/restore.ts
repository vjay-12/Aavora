import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { setDriveTrashed } from "../_utils/drive";
import { json, error, parseJsonBody } from "../_utils/response";
import { db } from "../../src/db";
import { activity } from "../../src/db/schema";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return error(res, "Method not allowed", 405);

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const body = await parseJsonBody<{
      fileId: string;
      name?: string;
    }>(req);

    if (!body.fileId) return error(res, "File ID is required", 400);

    const item = await setDriveTrashed(body.fileId, false);

    // Record activity in Neon
    await db.insert(activity).values({
      userId: session.email,
      userName: session.name,
      action: "restore",
      driveId: body.fileId,
      name: body.name || item.name,
    });

    return json(res, { item, success: true });
  } catch (err: any) {
    return error(res, err.message || "Failed to restore item", 500);
  }
}
