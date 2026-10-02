import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { createResumableUploadSession } from "../_utils/drive";
import { json, error, parseJsonBody } from "../_utils/response";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return error(res, "Method not allowed", 405);

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const body = await parseJsonBody<{
      name: string;
      mimeType: string;
      size: number;
      parentId?: string;
      tags?: string[];
      notes?: string;
    }>(req);

    if (!body.name || !body.size) {
      return error(res, "File name and size are required", 400);
    }

    const appProperties: Record<string, string> = {
      uploadedBy: session.email,
      uploadedByName: session.name,
      uploadedAt: new Date().toISOString(),
    };

    if (body.tags && body.tags.length > 0) {
      appProperties.tags = body.tags.join(",");
    }
    if (body.notes) {
      appProperties.notes = body.notes.slice(0, 1000);
    }

    // Creates resumable upload session using Admin refresh token (owned by admin!)
    const { uploadUrl } = await createResumableUploadSession(
      body.name,
      body.mimeType || "application/octet-stream",
      body.size,
      body.parentId,
      appProperties
    );

    return json(res, { uploadUrl });
  } catch (err: any) {
    console.error("Resumable upload session error:", err);
    return error(res, err.message || "Failed to create upload session", 500);
  }
}
