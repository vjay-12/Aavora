import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { getDriveFile } from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";
import { db } from "../../src/db/index.js";
import { stars } from "../../src/db/schema.js";
import { and, eq } from "drizzle-orm";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const fileId = url.searchParams.get("id");
    if (!fileId) return error(res, "Missing file ID", 400);

    const [file, [isStarred]] = await Promise.all([
      getDriveFile(fileId),
      db
        .select()
        .from(stars)
        .where(and(eq(stars.userId, session.email), eq(stars.driveId, fileId)))
        .limit(1),
    ]);

    return json(res, {
      file: {
        ...file,
        starred: !!isStarred,
        isFolder: file.mimeType === "application/vnd.google-apps.folder",
      },
    });
  } catch (err: any) {
    return error(res, err.message || "Failed to get file details", 500);
  }
}
