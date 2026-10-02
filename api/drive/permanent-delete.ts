import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { deleteDriveItemPermanently } from "../_utils/drive";
import { json, error, parseJsonBody } from "../_utils/response";
import { db } from "../../src/db";
import { activity, stars } from "../../src/db/schema";
import { eq } from "drizzle-orm";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return error(res, "Method not allowed", 405);
  }

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    // ADMIN ONLY check
    if (session.role !== "admin") {
      return error(res, "Forbidden: Only admins can permanently delete files", 403);
    }

    const body = await parseJsonBody<{
      fileId: string;
      name: string;
      confirmationText: string;
    }>(req);

    if (!body.fileId || body.confirmationText !== "DELETE") {
      return error(res, "Invalid confirmation. Type DELETE to confirm.", 400);
    }

    await deleteDriveItemPermanently(body.fileId);

    // Clean up stars if any & log activity in Neon
    await Promise.all([
      db.delete(stars).where(eq(stars.driveId, body.fileId)),
      db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "delete",
        driveId: body.fileId,
        name: body.name || "Item",
        meta: { permanent: true },
      }),
    ]);

    return json(res, { success: true });
  } catch (err: any) {
    return error(res, err.message || "Failed to permanently delete item", 500);
  }
}
