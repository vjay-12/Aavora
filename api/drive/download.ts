import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import { getAdminAccessToken, getDriveFile } from "../_utils/drive.js";
import { error } from "../_utils/response.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const fileId = url.searchParams.get("id");
    if (!fileId) return error(res, "Missing file ID", 400);

    const [accessToken, fileMeta] = await Promise.all([
      getAdminAccessToken(),
      getDriveFile(fileId),
    ]);

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!driveRes.ok) {
      return error(res, "Failed to download file from Google Drive", driveRes.status);
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", fileMeta.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileMeta.name)}"`
    );
    if (fileMeta.size) {
      res.setHeader("Content-Length", fileMeta.size);
    }

    // Stream body to client
    const arrayBuf = await driveRes.arrayBuffer();
    res.end(Buffer.from(arrayBuf));
  } catch (err: any) {
    if (err.statusCode === 403 || err.status === 403) {
      return error(res, "Forbidden: Requested file is outside the family vault", 403);
    }
    if (err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return error(res, "Vault Google Drive is not connected.", 503);
    }
    return error(res, err.message || "Download failed", 500);
  }
}
