import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import {
  getAdminAccessToken,
  getVaultRootId,
  AdminDriveError,
} from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }

    if (user.role !== "admin") {
      return error(res, "Forbidden: Admin diagnostics only", 403);
    }

    const rootId = getVaultRootId();

    let adminToken: string;
    try {
      adminToken = await getAdminAccessToken();
    } catch (err: any) {
      if (err instanceof AdminDriveError || err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
        return json(
          res,
          {
            rootFolderFound: false,
            rootFolderName: null,
            canRead: false,
            itemCount: 0,
            adminDriveConnected: false,
            code: "ADMIN_DRIVE_NOT_CONNECTED",
            error: "Admin Google Drive is not connected.",
          },
          200
        );
      }
      throw err;
    }

    // Inspect root folder
    let rootFolderFound = false;
    let rootFolderName: string | null = null;
    let canRead = false;
    let itemCount = 0;

    const getRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${rootId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );

    if (getRes.ok) {
      const getData = await getRes.json();
      rootFolderFound = true;
      rootFolderName = getData.name || null;
      canRead = !getData.trashed;

      // Count items directly under root
      const listParams = new URLSearchParams({
        q: `'${rootId}' in parents and trashed = false`,
        fields: "files(id)",
        pageSize: "100",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });

      const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${listParams.toString()}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (listRes.ok) {
        const listData = await listRes.json();
        itemCount = (listData.files || []).length;
      }
    }

    return json(res, {
      rootFolderFound,
      rootFolderName,
      canRead,
      itemCount,
      adminDriveConnected: true,
    });
  } catch (err: any) {
    console.error("[Drive Health Check Error]:", err);
    return error(res, err.message || "Failed to check drive health", 500);
  }
}
