import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { getDriveStorageQuota } from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const quota = await getDriveStorageQuota(session.accessToken);
    return json(res, { quota });
  } catch (err: any) {
    return error(res, err.message || "Failed to fetch storage", 500);
  }
}
