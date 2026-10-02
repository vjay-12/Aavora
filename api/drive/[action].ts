import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../../server/auth.js";
import {
  getVaultRootId,
  listDriveItems,
  getDriveFile,
  createDriveFolder,
  renameDriveItem,
  moveDriveItem,
  setDriveTrashed,
  deleteDriveItemPermanently,
  getDriveStorageQuota,
  createResumableUploadSession,
  verifyOrFindUploadedFile,
  getAdminAccessToken,
  assertInsideVault,
  AdminDriveError,
} from "../../server/drive.js";
import { json, error, parseJsonBody } from "../../server/response.js";
import { db } from "../../server/db/index.js";
import { activity } from "../../server/db/schema.js";
import { eq, and } from "drizzle-orm";

function getDriveAction(req: IncomingMessage): string {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);
  const pathname = url.pathname.toLowerCase();

  // Normalize upload rewrites if arriving via /api/upload/...
  if (pathname.includes("/upload/session") || pathname.endsWith("/upload-session")) return "upload-session";
  if (pathname.includes("/upload/complete") || pathname.endsWith("/upload-complete")) return "upload-complete";

  const segments = pathname.split("/").filter(Boolean);
  const driveIdx = segments.indexOf("drive");
  if (driveIdx !== -1 && segments[driveIdx + 1]) {
    return segments[driveIdx + 1].toLowerCase();
  }
  return (segments[segments.length - 1] || "list").toLowerCase();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const action = getDriveAction(req);
  const method = req.method?.toUpperCase();

  try {
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    const url = new URL(req.url || "", `http://${req.headers.host || "localhost:5173"}`);

    // 1. GET /api/drive/list
    if (action === "list") {
      const rootFolderId = getVaultRootId();
      const requestedFolderId = (url.searchParams.get("folderId") || rootFolderId).trim();

      if (requestedFolderId.toLowerCase() === "root" || requestedFolderId.toLowerCase() === "me") {
        return error(res, "Access to Google Drive 'root' or personal drive is strictly forbidden.", 403);
      }

      await assertInsideVault(requestedFolderId);

      const pageSize = parseInt(url.searchParams.get("pageSize") || "100", 10);
      const pageToken = url.searchParams.get("pageToken") || undefined;

      const result = await listDriveItems(requestedFolderId, pageSize, pageToken);

      const items = result.files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        isFolder: file.mimeType === "application/vnd.google-apps.folder",
        size: file.size,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime,
        lastModifyingUser: (file as any).lastModifyingUser?.displayName || file.owners?.[0]?.displayName || "Vault Admin",
        parents: file.parents,
        thumbnailLink: file.thumbnailLink,
        iconLink: file.iconLink,
        webViewLink: file.webViewLink,
        webContentLink: file.webContentLink,
        tags: file.appProperties?.tags ? JSON.parse(file.appProperties.tags) : [],
        notes: file.appProperties?.notes || "",
      }));

      // Sort folders first, then alphabetically by name
      items.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });

      return json(res, {
        items,
        files: items,
        nextPageToken: result.nextPageToken,
        currentFolderId: result.currentFolderId,
        rootFolderId,
      });
    }

    // 2. GET /api/drive/storage
    if (action === "storage") {
      const quota = await getDriveStorageQuota();
      return json(res, { quota });
    }

    // 3. GET /api/drive/health
    if (action === "health") {
      const rootId = getVaultRootId();
      try {
        const rootInfo = await getDriveFile(rootId);
        const { files } = await listDriveItems(rootId, 10);
        return json(res, {
          adminDriveConnected: true,
          rootFolderId: rootId,
          rootFolderName: rootInfo.name,
          rootMimeType: rootInfo.mimeType,
          itemCount: files.length,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        return json(res, {
          adminDriveConnected: false,
          rootFolderId: rootId,
          error: err.message,
          code: err.code || "ADMIN_DRIVE_NOT_CONNECTED",
        });
      }
    }

    // 4. POST /api/drive/folder
    if (action === "folder") {
      const body = await parseJsonBody<{ name: string; parentId?: string; color?: string }>(req);
      if (!body.name?.trim()) return error(res, "Folder name is required", 400);

      const parentId = body.parentId || getVaultRootId();
      await assertInsideVault(parentId);

      const folder = await createDriveFolder(body.name.trim(), parentId, body.color);

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "create_folder",
        driveId: folder.id,
        name: folder.name,
        path: parentId,
        meta: { folderColor: body.color },
      });

      return json(res, { folder });
    }

    // 5. GET /api/drive/file
    if (action === "file") {
      const fileId = url.searchParams.get("id");
      if (!fileId) return error(res, "Missing file ID", 400);

      await assertInsideVault(fileId);
      const file = await getDriveFile(fileId);
      return json(res, { file });
    }

    // 6. GET /api/drive/download
    if (action === "download") {
      const fileId = url.searchParams.get("id");
      if (!fileId) return error(res, "Missing file ID", 400);

      await assertInsideVault(fileId);

      const [accessToken, fileMeta] = await Promise.all([
        getAdminAccessToken(),
        getDriveFile(fileId),
      ]);

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
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

      const arrayBuf = await driveRes.arrayBuffer();
      return res.end(Buffer.from(arrayBuf));
    }

    // 7. POST /api/drive/rename
    if (action === "rename") {
      const body = await parseJsonBody<{ itemId: string; newName: string }>(req);
      if (!body.itemId || !body.newName?.trim()) {
        return error(res, "Missing itemId or newName", 400);
      }

      await assertInsideVault(body.itemId);
      const updated = await renameDriveItem(body.itemId, body.newName.trim());

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "rename",
        driveId: updated.id,
        name: updated.name,
        meta: { previousName: body.newName },
      });

      return json(res, { item: updated });
    }

    // 8. POST /api/drive/move
    if (action === "move") {
      const body = await parseJsonBody<{ itemId: string; newParentId: string; currentParentId?: string }>(req);
      if (!body.itemId || !body.newParentId) {
        return error(res, "Missing itemId or newParentId", 400);
      }

      await assertInsideVault(body.itemId);
      await assertInsideVault(body.newParentId);

      const moved = await moveDriveItem(body.itemId, body.newParentId, body.currentParentId);

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "move",
        driveId: moved.id,
        name: moved.name,
        path: body.newParentId,
        meta: { oldParentId: body.currentParentId },
      });

      return json(res, { item: moved });
    }

    // 9. POST /api/drive/trash
    if (action === "trash") {
      const body = await parseJsonBody<{ fileId: string; name?: string }>(req);
      if (!body.fileId) return error(res, "Missing file ID", 400);

      await assertInsideVault(body.fileId);
      const trashed = await setDriveTrashed(body.fileId, true);

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "trash",
        driveId: trashed.id,
        name: body.name || trashed.name,
        path: "trash",
      });

      return json(res, { item: trashed, message: "Item moved to Bin" });
    }

    // 10. POST /api/drive/restore
    if (action === "restore") {
      const body = await parseJsonBody<{ fileId: string; name?: string }>(req);
      if (!body.fileId) return error(res, "Missing file ID", 400);

      await assertInsideVault(body.fileId);
      const restored = await setDriveTrashed(body.fileId, false);

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "restore",
        driveId: restored.id,
        name: body.name || restored.name,
        path: restored.parents?.[0] || getVaultRootId(),
      });

      return json(res, { item: restored, message: "Item restored successfully" });
    }

    // 11. GET /api/drive/bin
    if (action === "bin") {
      const accessToken = await getAdminAccessToken();
      const fields = "files(id, name, mimeType, size, modifiedTime, createdTime, parents, trashed)";
      const q = "trashed = true";

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          q
        )}&fields=${encodeURIComponent(fields)}&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await driveRes.json();
      if (!driveRes.ok) throw new Error(data.error?.message || "Failed to list bin");

      return json(res, { items: data.files || [] });
    }

    // 12. POST or DELETE /api/drive/permanent-delete
    if (action === "permanent-delete") {
      if (session.role !== "admin") {
        return error(res, "Forbidden: Admin privileges required", 403);
      }

      let fileId = url.searchParams.get("id");
      let itemName = "Document";

      if (!fileId && method === "POST") {
        const body = await parseJsonBody<{ fileId: string; name?: string }>(req);
        fileId = body.fileId;
        if (body.name) itemName = body.name;
      }

      if (!fileId) return error(res, "Missing file ID", 400);

      await deleteDriveItemPermanently(fileId);

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "delete",
        driveId: fileId,
        name: itemName,
        path: "permanently-deleted",
      });

      return json(res, { message: "Item permanently deleted" });
    }

    // 13. POST /api/drive/seed-categories
    if (action === "seed-categories") {
      if (session.role !== "admin") {
        return error(res, "Forbidden: Only admins can seed categories", 403);
      }

      const rootId = getVaultRootId();
      const defaultCategories = [
        { name: "Identity & Personal", color: "sky" },
        { name: "Medical & Health", color: "rose" },
        { name: "Property & Real Estate", color: "emerald" },
        { name: "Finance & Taxation", color: "amber" },
        { name: "Education & Certificates", color: "indigo" },
        { name: "Vehicles & Transport", color: "purple" },
      ];

      const existing = await listDriveItems(rootId);
      const existingNames = new Set(existing.files.map((f) => f.name.toLowerCase().trim()));

      const created: string[] = [];
      for (const cat of defaultCategories) {
        if (!existingNames.has(cat.name.toLowerCase().trim())) {
          await createDriveFolder(cat.name, rootId, cat.color);
          created.push(cat.name);
        }
      }

      return json(res, {
        message: `Created ${created.length} categories`,
        created,
        rootFolderId: rootId,
      });
    }

    // 14. POST /api/drive/upload-session or session
    if (action === "upload-session" || action === "session") {
      const body = await parseJsonBody<{
        name: string;
        mimeType: string;
        size?: number;
        parentId?: string;
        tags?: string[];
        notes?: string;
      }>(req);

      if (!body.name) return error(res, "File name is required", 400);

      const targetParent = body.parentId || getVaultRootId();
      await assertInsideVault(targetParent);

      const appProperties: Record<string, string> = {};
      if (body.tags && body.tags.length > 0) appProperties.tags = JSON.stringify(body.tags);
      if (body.notes) appProperties.notes = body.notes;

      // Forward client Origin header (or referer origin) to Google Drive
      let originHeader = (req.headers.origin || "").trim();
      if (!originHeader && req.headers.referer) {
        try {
          originHeader = new URL(req.headers.referer).origin;
        } catch {
          // ignore
        }
      }

      const { uploadUrl } = await createResumableUploadSession(
        body.name,
        body.mimeType || "application/octet-stream",
        targetParent,
        appProperties,
        originHeader
      );

      return json(res, { uploadUrl });
    }

    // 15. POST /api/drive/upload-complete or complete
    if (action === "upload-complete" || action === "complete") {
      const body = await parseJsonBody<{
        driveId?: string;
        uploadUrl?: string;
        name: string;
        path?: string;
        parentId?: string;
        size?: number;
        mimeType?: string;
        tags?: string[];
        notes?: string;
      }>(req);

      if (!body.name) {
        return error(res, "Missing file name", 400);
      }

      const targetParent = body.parentId || body.path || getVaultRootId();
      await assertInsideVault(targetParent);

      // Verify file existence in Google Drive via ID, upload session, or files.list
      const verifiedFile = await verifyOrFindUploadedFile({
        driveId: body.driveId,
        uploadUrl: body.uploadUrl,
        name: body.name,
        parentId: targetParent,
        size: body.size,
        mimeType: body.mimeType,
      });

      if (!verifiedFile) {
        return error(res, "Upload verification failed: file could not be verified in Google Drive", 404);
      }

      // Check idempotency: file already recorded in activity?
      const existingActivity = await db
        .select()
        .from(activity)
        .where(
          and(
            eq(activity.action, "upload"),
            eq(activity.driveId, verifiedFile.id)
          )
        )
        .limit(1);

      if (existingActivity.length > 0) {
        return json(res, {
          success: true,
          item: verifiedFile,
          file: verifiedFile,
          activity: existingActivity[0],
          alreadyLogged: true,
        });
      }

      // Log activity once
      const [act] = await db
        .insert(activity)
        .values({
          userId: session.email,
          userName: session.name,
          action: "upload",
          driveId: verifiedFile.id,
          name: verifiedFile.name,
          path: targetParent,
          meta: {
            size: verifiedFile.size || body.size,
            mimeType: verifiedFile.mimeType || body.mimeType,
            tags: body.tags || [],
            notes: body.notes || "",
          },
        })
        .returning();

      return json(res, { success: true, item: verifiedFile, file: verifiedFile, activity: act });
    }

    return error(res, `Unknown drive action: ${action}`, 404);
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
    if (err.statusCode === 403 || err.status === 403) {
      return error(res, err.message || "Forbidden: Access denied to item outside the family vault", 403);
    }
    if (err.statusCode === 404 || err.status === 404) {
      return error(res, err.message || "Item not found in Google Drive", 404);
    }
    console.error(`[Drive Action Error - ${action}]:`, err);
    return error(res, err.message || "Drive operation failed", 500);
  }
}
