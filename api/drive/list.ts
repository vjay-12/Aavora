import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest, clearSessionCookie } from "../_utils/auth";
import { getEnv } from "../_utils/env";
import { json, error } from "../_utils/response";

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

// Cache of verified folder IDs in the root tree to guarantee single-request listing
const verifiedFolders = new Set<string>();

export function getVerifiedFolders(rootId: string) {
  verifiedFolders.add(rootId);
  return verifiedFolders;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // 1. Verify session & active user (automatically performs silent refresh if token is expired)
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }

    const env = getEnv();
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
    const requestedFolderId = url.searchParams.get("folderId");
    const targetFolderId = requestedFolderId || env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const knownFolders = getVerifiedFolders(env.GOOGLE_DRIVE_ROOT_FOLDER_ID);

    // 2. Tree boundary security check:
    // If a subfolder is requested and not yet known, verify it belongs to root tree
    if (requestedFolderId && requestedFolderId !== env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      if (!knownFolders.has(requestedFolderId)) {
        const metaRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${requestedFolderId}?fields=id,parents,trashed&supportsAllDrives=true`,
          {
            headers: { Authorization: `Bearer ${user.accessToken}` },
          }
        );

        if (metaRes.status === 401) {
          clearSessionCookie(res);
          return error(res, "Unauthorized", 401);
        }

        if (metaRes.status === 404) {
          return error(res, "Folder not found", 404);
        }

        if (!metaRes.ok) {
          return error(res, "Failed to inspect folder", metaRes.status);
        }

        const folderMeta = await metaRes.json();
        if (folderMeta.trashed) {
          return error(res, "Folder is in bin", 404);
        }

        const parents: string[] = folderMeta.parents || [];
        const isDescendant = parents.some((p) => knownFolders.has(p));

        if (!isDescendant) {
          return error(res, "Forbidden: Folder is outside the Aavora root tree", 403);
        }

        knownFolders.add(requestedFolderId);
      }
    }

    // 3. Fetch files and folders from Google Drive in one call
    const q = `'${targetFolderId}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, lastModifyingUser, owners, parents)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });

    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
      },
    });

    if (driveRes.status === 401) {
      clearSessionCookie(res);
      return error(res, "Unauthorized - Drive session expired or revoked", 401);
    }

    if (driveRes.status === 404) {
      return error(res, "Folder not found", 404);
    }

    const data = await driveRes.json();
    if (!driveRes.ok) {
      console.error("[Drive API Error]:", data);
      return error(res, data.error?.message || "Failed to list Google Drive files", driveRes.status);
    }

    // 4. Process items: Separate folders and files, sort folders first then files
    const rawFiles: any[] = data.files || [];

    const mappedItems: DriveListItem[] = rawFiles.map((f) => ({
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
        "Member",
      parents: f.parents,
    }));

    // Register all child folders in verified tree cache
    for (const item of mappedItems) {
      if (item.isFolder) {
        knownFolders.add(item.id);
      }
    }

    // Folders first (alphabetical), then files (alphabetical)
    mappedItems.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return json(res, {
      items: mappedItems,
      files: mappedItems,
      currentFolderId: targetFolderId,
      rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    });
  } catch (err: any) {
    console.error("[Drive List Error]:", err);
    return error(res, err.message || "Internal server error", 500);
  }
}
