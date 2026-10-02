import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { listDriveItems } from "../_utils/drive";
import { json, error } from "../_utils/response";

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
    return error(res, err.message || "Failed to list bin", 500);
  }
}
