import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import {
  getAdminAccessToken,
  getVaultRootId,
  assertInsideVault,
  AdminDriveError,
  DriveItem,
} from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";

export interface DriveListItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size?: string;
  modifiedTime?: string;
  lastModifyingUser?: string;
  parents?: string[];
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // 1. Verify user session (identity check against Neon users table)
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }

    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const requestedFolderId = url.searchParams.get("folderId");
    const rootFolderId = getVaultRootId();
    const targetFolderId = requestedFolderId?.trim() || rootFolderId;

    // 2. Reject "root", "me", or empty IDs, and assert folder is within vault root tree
    if (targetFolderId.toLowerCase() === "root" || targetFolderId.toLowerCase() === "me") {
      return error(res, "Forbidden: Access to root or personal My Drive is not allowed.", 403);
    }

    // 3. Acquire admin access token
    let adminToken: string;
    try {
      adminToken = await getAdminAccessToken();
    } catch (err: any) {
      if (err instanceof AdminDriveError || err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
        return json(
          res,
          {
            error: "Vault Google Drive is not connected.",
            code: "ADMIN_DRIVE_NOT_CONNECTED",
          },
          503
        );
      }
      throw err;
    }

    // 4. Verify folder is inside vault
    try {
      await assertInsideVault(targetFolderId, adminToken);
    } catch (err: any) {
      if (err.statusCode === 403 || err.status === 403) {
        return error(res, "Forbidden: Folder is outside the family vault.", 403);
      }
      throw err;
    }

    // 5. Inspect target folder via files.get using admin token
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${targetFolderId}?fields=id,name,mimeType,trashed,capabilities(canListChildren,canAddChildren),parents&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );

    if (metaRes.status === 404) {
      return error(res, `Vault folder (${targetFolderId}) not found in Google Drive.`, 404);
    }

    if (metaRes.status === 403) {
      return error(res, "Google Drive API access forbidden for admin token.", 403);
    }

    if (!metaRes.ok) {
      const errData = await metaRes.json().catch(() => ({}));
      return error(res, errData.error?.message || "Failed to inspect vault folder", metaRes.status);
    }

    const folderMeta = await metaRes.json();
    if (folderMeta.trashed) {
      return error(res, "Folder is in bin", 404);
    }

    // 6. Fetch items strictly inside targetFolderId
    const q = `'${targetFolderId}' in parents and trashed = false`;
    let allFiles: any[] = [];
    let pageToken: string | undefined = undefined;
    let pageCount = 0;

    do {
      const params = new URLSearchParams({
        q,
        fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, lastModifyingUser, owners, parents)",
        pageSize: "100",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (!driveRes.ok) {
        const data = await driveRes.json().catch(() => ({}));
        return error(res, data.error?.message || "Failed to list Google Drive files", driveRes.status);
      }

      const data = await driveRes.json();
      if (data.files && Array.isArray(data.files)) {
        allFiles.push(...data.files);
      }
      pageToken = data.nextPageToken;
      pageCount++;
    } while (pageToken && pageCount < 5);

    // 7. Map items and sort: folders first, then files
    const mappedItems: DriveListItem[] = allFiles.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === "application/vnd.google-apps.folder",
      size: f.size,
      modifiedTime: f.modifiedTime,
      lastModifyingUser:
        f.lastModifyingUser?.displayName ||
        f.owners?.[0]?.displayName ||
        f.owners?.[0]?.emailAddress ||
        "Admin",
      parents: f.parents,
    }));

    mappedItems.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return json(res, {
      items: mappedItems,
      files: mappedItems,
      currentFolderId: targetFolderId,
      folderName: folderMeta.name || "Vault Root",
      rootFolderId,
      canAddChildren: folderMeta.capabilities?.canAddChildren ?? true,
      canListChildren: folderMeta.capabilities?.canListChildren ?? true,
    });
  } catch (err: any) {
    if (err instanceof AdminDriveError || err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return json(
        res,
        {
          error: "Vault Google Drive is not connected.",
          code: "ADMIN_DRIVE_NOT_CONNECTED",
        },
        503
      );
    }
    console.error("[Drive List Error]:", err);
    return error(res, err.message || "Internal server error", 500);
  }
}
