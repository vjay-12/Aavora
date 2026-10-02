import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "./_utils/auth.js";
import { json, error, parseJsonBody } from "./_utils/response.js";
import { db } from "../src/db/index.js";
import { stars } from "../src/db/schema.js";
import { and, eq } from "drizzle-orm";
import { getDriveFile } from "./_utils/drive.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    if (req.method === "GET") {
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
      const includeFiles = url.searchParams.get("includeFiles") === "true";

      const userStars = await db
        .select()
        .from(stars)
        .where(eq(stars.userId, session.email));

      if (!includeFiles) {
        return json(res, { stars: userStars });
      }

      // Concurrently fetch metadata for starred files from Drive
      const filePromises = userStars.map(async (s: any) => {
        try {
          const file = await getDriveFile(s.driveId);
          return {
            ...file,
            starred: true,
            isFolder: file.mimeType === "application/vnd.google-apps.folder",
          };
        } catch {
          return null;
        }
      });

      const files = (await Promise.all(filePromises)).filter(Boolean);
      return json(res, { files });
    }

    if (req.method === "POST") {
      const body = await parseJsonBody<{ driveId: string }>(req);
      if (!body.driveId) return error(res, "driveId is required", 400);

      await db
        .insert(stars)
        .values({
          userId: session.email,
          driveId: body.driveId,
        })
        .onConflictDoNothing();

      return json(res, { success: true, starred: true });
    }

    if (req.method === "DELETE") {
      const body = await parseJsonBody<{ driveId: string }>(req);
      if (!body.driveId) return error(res, "driveId is required", 400);

      await db
        .delete(stars)
        .where(
          and(eq(stars.userId, session.email), eq(stars.driveId, body.driveId))
        );

      return json(res, { success: true, starred: false });
    }

    return error(res, "Method not allowed", 405);
  } catch (err: any) {
    return error(res, err.message || "Failed to process stars request", 500);
  }
}
