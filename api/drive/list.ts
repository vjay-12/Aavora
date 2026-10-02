import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest, clearSessionCookie } from "../_utils/auth.js";
import { getEnv } from "../_utils/env.js";
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

// In-memory cache of verified folder IDs in the root tree
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

    // 2. Validate folder existence, accessibility, and permissions via files.get
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${targetFolderId}?fields=id,name,mimeType,trashed,capabilities(canListChildren,canAddChildren),parents&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      }
    );

    if (metaRes.status === 401) {
      clearSessionCookie(res);
      return error(res, "Unauthorized - Drive session expired or revoked", 401);
    }

    if (metaRes.status === 404) {
      return error(
        res,
        `Google Drive folder (${targetFolderId}) not found. Please ensure the folder exists and is shared with ${user.email}.`,
        404
      );
    }

    if (metaRes.status === 403) {
      return error(
        res,
        `Access denied to Google Drive folder. Please share the folder with ${user.email} in Google Drive with Editor or Viewer permissions.`,
        403
      );
    }

    if (!metaRes.ok) {
      const errData = await metaRes.json().catch(() => ({}));
      return error(res, errData.error?.message || "Failed to inspect Google Drive folder", metaRes.status);
    }

    const folderMeta = await metaRes.json();
    if (folderMeta.trashed) {
      return error(res, "Folder is in bin", 404);
    }

    // Tree boundary check for subfolders
    if (requestedFolderId && requestedFolderId !== env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      if (!knownFolders.has(requestedFolderId)) {
        const parents: string[] = folderMeta.parents || [];
        const isDescendant = parents.some((p) => knownFolders.has(p));

        if (!isDescendant) {
          return error(res, "Forbidden: Folder is outside the Aavora root tree", 403);
        }

        knownFolders.add(requestedFolderId);
      }
    } else {
      knownFolders.add(targetFolderId);
    }

    // 3. Fetch files and folders inside target folder with pagination support
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
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });

      if (driveRes.status === 401) {
        clearSessionCookie(res);
        return error(res, "Unauthorized - Drive session expired or revoked", 401);
      }

      if (!driveRes.ok) {
        const data = await driveRes.json();
        console.error("[Drive API Error]:", data);
        return error(res, data.error?.message || "Failed to list Google Drive files", driveRes.status);
      }

      const data = await driveRes.json();
      if (data.files && Array.isArray(data.files)) {
        allFiles.push(...data.files);
      }
      pageToken = data.nextPageToken;
      pageCount++;
    } while (pageToken && pageCount < 5);

    // 4. Process items: Separate folders and files, sort folders first then files
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
      folderName: folderMeta.name || "Vault Root",
      rootFolderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
      canAddChildren: folderMeta.capabilities?.canAddChildren ?? true,
      canListChildren: folderMeta.capabilities?.canListChildren ?? true,
    });
  } catch (err: any) {
    console.error("[Drive List Error]:", err);
    return error(res, err.message || "Internal server error", 500);
  }
}
