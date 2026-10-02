import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { getDriveStorageQuota, AdminDriveError } from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const quota = await getDriveStorageQuota();
    return json(res, { quota });
  } catch (err: any) {
    if (err instanceof AdminDriveError || err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return json(
        res,
        { error: "Vault Google Drive is not connected.", code: "ADMIN_DRIVE_NOT_CONNECTED" },
        503
      );
    }
    console.error("[Drive Storage Error]:", err);
    return error(res, err.message || "Failed to fetch storage", 500);
  }
}
