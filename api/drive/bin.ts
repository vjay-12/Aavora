import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { listDriveItems } from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    // List trashed items (trashed = true)
    const result = await listDriveItems(undefined, undefined, true);

    return json(res, {
      items: result.files || [],
    });
  } catch (err: any) {
    if (err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return json(res, { error: "Vault Google Drive is not connected.", code: "ADMIN_DRIVE_NOT_CONNECTED" }, 503);
    }
    return error(res, err.message || "Failed to list bin", 500);
  }
}
