import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest, requireAdmin } from "../../server/auth.js";
import {
  getVaultRootId,
  listDriveItems,
  getDriveFile,
  createDriveFolder,
  renameDriveItem,
  moveDriveItem,
  setDriveTrashed,
  updateDriveAppProperties,
  getDriveStorageQuota,
  createResumableUploadSession,
  verifyOrFindUploadedFile,
  getAdminAccessToken,
  assertInsideVault,
  isInsideVault,
  AdminDriveError,
  AdminDriveTransientError,
  getAdminDriveHealth,
} from "../../server/drive.js";
import { json, error, parseJsonBody } from "../../server/response.js";
import { db } from "../../server/db/index.js";
import { activity, stars } from "../../server/db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import {
  DELETE_RESTRICTED_CODE,
  DELETE_RESTRICTED_MESSAGE,
  BIN_PAGE_ENABLED,
} from "../../src/config/features.js";

function getDriveAction(req: IncomingMessage): string {
  if ((req as any).query?.action) {
    return String((req as any).query.action).toLowerCase();
  }
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
    // 1. Cron keepalive (authorized via Vercel Cron header, CRON_SECRET, or admin session)
    if (action === "cron" || action === "keepalive") {
      const isVercelCron = Boolean(req.headers["x-vercel-cron"]);
      const authHeader = String(req.headers["authorization"] || "");
      const cronSecret = process.env.CRON_SECRET?.trim();
      const isCronSecret = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

      const session = await authenticateRequest(req);
      if (!isVercelCron && !isCronSecret && !requireAdmin(session)) {
        return error(res, "Unauthorized cron invocation", 401);
      }

      try {
        await getAdminAccessToken(true); // Force proactive refresh
        return json(res, {
          success: true,
          status: "connected",
          refreshedAt: new Date().toISOString(),
          message: "Admin Google Drive token refreshed successfully",
        });
      } catch (err: any) {
        if (err instanceof AdminDriveError) {
          return json(res, { success: false, status: "disconnected", code: err.code, error: err.message }, 503);
        }
        return json(res, { success: false, status: "transient_error", code: err.code || "GOOGLE_TRANSIENT_ERROR", error: err.message }, 503);
      }
    }

    // 2. Health status endpoint
    if (action === "status") {
      const health = await getAdminDriveHealth();
      return json(res, health);
    }

    // All remaining Drive actions require an authenticated session
    const session = await authenticateRequest(req);
    if (!session) return error(res, "Unauthorized", 401);

    // Global guard: ALL DELETE methods on Drive endpoints strictly require admin
    if (method === "DELETE" && !requireAdmin(session)) {
      return error(res, DELETE_RESTRICTED_MESSAGE, 403, { code: DELETE_RESTRICTED_CODE });
    }

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

      // Fetch user's starred files
      let starredSet = new Set<string>();
      try {
        const userStarred = await db
          .select({ driveId: stars.driveId })
          .from(stars)
          .where(eq(stars.userId, session.email));
        starredSet = new Set(userStarred.map((s) => s.driveId));
      } catch (starErr) {
        console.warn("[Drive List] Could not read user stars:", starErr);
      }

      // Resolve uploader for files lacking uploadedByName
      const missingUploaderDriveIds = result.files
        .filter((f) => !f.appProperties?.uploadedByName && f.mimeType !== "application/vnd.google-apps.folder")
        .map((f) => f.id);

      const activityUploaderMap = new Map<string, string>();
      if (missingUploaderDriveIds.length > 0) {
        try {
          const actRows = await db
            .select({ driveId: activity.driveId, userName: activity.userName, userId: activity.userId })
            .from(activity)
            .where(
              and(
                eq(activity.action, "upload"),
                inArray(activity.driveId, missingUploaderDriveIds)
              )
            );
          for (const row of actRows) {
            if (row.driveId && (row.userName || row.userId)) {
              activityUploaderMap.set(row.driveId, row.userName || row.userId);
            }
          }
        } catch {
          // Ignore lookup failure; will fall back to Unknown
        }
      }

      const items = result.files.map((file) => {
        const isFolder = file.mimeType === "application/vnd.google-apps.folder";
        const props = file.appProperties ? { ...file.appProperties } : {};

        let resolvedUploader = props.uploadedByName || props.uploadedBy;
        if (!resolvedUploader) {
          if (!isFolder) {
            resolvedUploader = activityUploaderMap.get(file.id) || "Unknown";
          } else {
            resolvedUploader = "Unknown";
          }
          props.uploadedByName = resolvedUploader;
        }

        let parsedTags: string[] = [];
        if (props.tags) {
          if (typeof props.tags === "string" && props.tags.trim().startsWith("[")) {
            try {
              parsedTags = JSON.parse(props.tags);
            } catch {
              parsedTags = props.tags.split(",").map((t) => t.trim()).filter(Boolean);
            }
          } else if (typeof props.tags === "string") {
            parsedTags = props.tags.split(",").map((t) => t.trim()).filter(Boolean);
          }
        }

        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          isFolder,
          size: file.size,
          modifiedTime: file.modifiedTime,
          createdTime: file.createdTime,
          uploadedByName: resolvedUploader,
          lastModifyingUser: resolvedUploader,
          parents: file.parents,
          thumbnailLink: file.thumbnailLink,
          iconLink: file.iconLink,
          webViewLink: file.webViewLink,
          webContentLink: file.webContentLink,
          starred: starredSet.has(file.id),
          appProperties: props,
          tags: parsedTags,
          notes: props.notes || "",
        };
      });

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

    // 5. GET /api/drive/file and GET /api/drive/download
    if (action === "file" || action === "download") {
      const fileId = url.searchParams.get("id");
      if (!fileId) return error(res, "Missing file ID", 400);

      try {
        await assertInsideVault(fileId);
      } catch (vaultErr: any) {
        const statusCode = vaultErr.statusCode || vaultErr.status || 403;
        return error(res, vaultErr.message || "Forbidden: File is outside vault", statusCode);
      }

      let fileMeta: any;
      try {
        fileMeta = await getDriveFile(fileId);
      } catch (metaErr: any) {
        const statusCode = metaErr.statusCode || metaErr.status || 404;
        return error(res, metaErr.message || "File not found", statusCode);
      }

      if (fileMeta.mimeType === "application/vnd.google-apps.folder") {
        return error(res, "Cannot stream a folder", 400);
      }

      const modeParam = url.searchParams.get("mode");
      const mode = (modeParam || (action === "download" ? "download" : "view")).toLowerCase();

      // Look up real mimeType from Drive, fallback to extension only if application/octet-stream
      let realMimeType = (fileMeta.mimeType || "").trim().toLowerCase();
      if (!realMimeType || realMimeType === "application/octet-stream") {
        const ext = (fileMeta.name || "").split(".").pop()?.toLowerCase();
        const extMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
          svg: "image/svg+xml",
          pdf: "application/pdf",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          doc: "application/msword",
          zip: "application/zip",
          txt: "text/plain",
          csv: "text/csv",
          json: "application/json",
        };
        realMimeType = (ext && extMap[ext]) ? extMap[ext] : "application/octet-stream";
      }

      const isGoogleDoc = realMimeType === "application/vnd.google-apps.document";
      const isWordDoc =
        realMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        realMimeType === "application/msword" ||
        (fileMeta.name && /\.(docx|doc)$/i.test(fileMeta.name));

      const accessToken = await getAdminAccessToken();

      // Set base security and caching headers
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self';");
      res.setHeader("Accept-Ranges", "bytes");

      // WORD & GOOGLE DOCS VIEW MODE: Convert to PDF
      if (mode === "view" && (isGoogleDoc || isWordDoc)) {
        if (isGoogleDoc) {
          try {
            const exportRes = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!exportRes.ok) {
              throw new Error(`Google Docs export returned status ${exportRes.status}`);
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/pdf");
            const cleanName = (fileMeta.name || "document").replace(/\.[^/.]+$/, "") + ".pdf";
            const encodedName = encodeURIComponent(cleanName);
            res.setHeader(
              "Content-Disposition",
              `inline; filename="${cleanName.replace(/"/g, "")}"; filename*=UTF-8''${encodedName}`
            );

            const arrayBuf = await exportRes.arrayBuffer();
            res.setHeader("Content-Length", arrayBuf.byteLength.toString());
            return res.end(Buffer.from(arrayBuf));
          } catch (err: any) {
            console.error("[Drive Export Error]:", err);
            return error(res, "Word preview conversion unavailable. Please download the original file to view.", 415, {
              code: "CONVERSION_UNAVAILABLE",
              fileName: fileMeta.name,
            });
          }
        } else if (isWordDoc) {
          // Word files (.docx / .doc) cannot be rendered inline without temporary conversion.
          // In adherence to strict Zero-Delete and Data Safety policy (no automatic file removals),
          // Word files return 415 CONVERSION_UNAVAILABLE so users can download and view the original file safely.
          return error(res, "Word preview conversion unavailable. Please download the original file to view.", 415, {
            code: "CONVERSION_UNAVAILABLE",
            fileName: fileMeta.name,
          });
        }
      }

      // STANDARD VIEW OR DOWNLOAD STREAMING
      const driveHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };

      const fileSizeNum = fileMeta.size ? parseInt(fileMeta.size, 10) : 0;
      const MAX_VERCEL_PAYLOAD = 4.5 * 1024 * 1024; // 4.5 MB limit

      // Check if client provided Range header
      if (req.headers.range) {
        driveHeaders["Range"] = req.headers.range;
      } else if (mode === "view" && fileSizeNum > MAX_VERCEL_PAYLOAD) {
        // If file exceeds 4.5 MB and requested in view mode without Range,
        // serve initial 4 MB chunk with 206 Partial Content so Vercel limit is never exceeded.
        driveHeaders["Range"] = "bytes=0-4194303";
      }

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: driveHeaders }
      );

      if (!driveRes.ok && driveRes.status !== 206) {
        return error(res, "Failed to stream file from Google Drive", driveRes.status);
      }

      res.statusCode = driveRes.status; // 200 or 206
      res.setHeader("Content-Type", realMimeType);

      const dispositionType = mode === "download" ? "attachment" : "inline";
      const cleanFilename = (fileMeta.name || "document").replace(/"/g, "");
      const encodedFilename = encodeURIComponent(fileMeta.name || "document");
      res.setHeader(
        "Content-Disposition",
        `${dispositionType}; filename="${cleanFilename}"; filename*=UTF-8''${encodedFilename}`
      );

      if (driveRes.headers.get("content-range")) {
        res.setHeader("Content-Range", driveRes.headers.get("content-range")!);
      }
      if (driveRes.headers.get("content-length")) {
        res.setHeader("Content-Length", driveRes.headers.get("content-length")!);
      }

      if (driveRes.body) {
        const reader = driveRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        return res.end();
      } else {
        const arrayBuf = await driveRes.arrayBuffer();
        return res.end(Buffer.from(arrayBuf));
      }
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

    // DELETE /api/drive/file or DELETE /api/drive/folder
    if ((action === "file" || action === "folder") && method === "DELETE") {
      if (!requireAdmin(session)) {
        return error(res, DELETE_RESTRICTED_MESSAGE, 403, { code: DELETE_RESTRICTED_CODE });
      }
      const qFileId = url.searchParams.get("id") || url.searchParams.get("fileId");
      if (!qFileId) return error(res, "Missing file ID", 400);
      await assertInsideVault(qFileId);
      const trashed = await setDriveTrashed(qFileId, true);
      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "trash",
        driveId: trashed.id,
        name: trashed.name,
        path: "trash",
      });
      return json(res, { item: trashed, message: "Item moved to Bin" });
    }

    // 9. POST or DELETE /api/drive/trash or /api/drive/delete or /api/drive/remove (single and bulk)
    if (action === "trash" || action === "delete" || action === "remove") {
      if (!requireAdmin(session)) {
        return error(res, DELETE_RESTRICTED_MESSAGE, 403, { code: DELETE_RESTRICTED_CODE });
      }

      const body = await parseJsonBody<{ fileId?: string; fileIds?: string[]; name?: string }>(req).catch(() => ({} as any));
      const qFileId = url.searchParams.get("id") || url.searchParams.get("fileId");
      const targetIds: string[] =
        body?.fileIds && Array.isArray(body.fileIds) && body.fileIds.length > 0
          ? body.fileIds
          : body?.fileId
          ? [body.fileId]
          : qFileId
          ? [qFileId]
          : [];

      if (targetIds.length === 0) return error(res, "Missing file ID", 400);

      const trashedItems = [];
      for (const id of targetIds) {
        await assertInsideVault(id);
        const trashed = await setDriveTrashed(id, true);

        await db.insert(activity).values({
          userId: session.email,
          userName: session.name,
          action: "trash",
          driveId: trashed.id,
          name: (targetIds.length === 1 && body?.name) ? body.name : trashed.name,
          path: "trash",
        });
        trashedItems.push(trashed);
      }

      return json(res, {
        item: trashedItems[0],
        items: trashedItems,
        message: targetIds.length > 1 ? `${targetIds.length} items moved to Bin` : "Item moved to Bin",
      });
    }

    // 10. POST /api/drive/restore (single and bulk)
    if (action === "restore") {
      if (!requireAdmin(session)) {
        return error(res, DELETE_RESTRICTED_MESSAGE, 403, { code: DELETE_RESTRICTED_CODE });
      }

      const body = await parseJsonBody<{ fileId?: string; fileIds?: string[]; name?: string }>(req).catch(() => ({} as any));
      const qFileId = url.searchParams.get("id") || url.searchParams.get("fileId");
      const targetIds: string[] =
        body?.fileIds && Array.isArray(body.fileIds) && body.fileIds.length > 0
          ? body.fileIds
          : body?.fileId
          ? [body.fileId]
          : qFileId
          ? [qFileId]
          : [];

      if (targetIds.length === 0) return error(res, "Missing file ID", 400);

      const restoredItems = [];
      for (const id of targetIds) {
        await assertInsideVault(id);
        const restored = await setDriveTrashed(id, false);

        await db.insert(activity).values({
          userId: session.email,
          userName: session.name,
          action: "restore",
          driveId: restored.id,
          name: (targetIds.length === 1 && body?.name) ? body.name : restored.name,
          path: restored.parents?.[0] || getVaultRootId(),
        });
        restoredItems.push(restored);
      }

      return json(res, {
        item: restoredItems[0],
        items: restoredItems,
        message: targetIds.length > 1 ? `${targetIds.length} items restored successfully` : "Item restored successfully",
      });
    }

    // 11. GET /api/drive/bin (Disabled when BIN_PAGE_ENABLED is false)
    if (action === "bin") {
      if (!BIN_PAGE_ENABLED) {
        return error(res, "Bin is disabled", 404);
      }

      if (!requireAdmin(session)) {
        return error(res, DELETE_RESTRICTED_MESSAGE, 403, { code: DELETE_RESTRICTED_CODE });
      }

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

      // Filter to only items inside DRIVE_ROOT_FOLDER_ID tree
      const rawFiles: any[] = data.files || [];
      const vaultItems: any[] = [];
      for (const file of rawFiles) {
        try {
          if (await isInsideVault(file.id, accessToken)) {
            vaultItems.push(file);
          }
        } catch {
          // If unverified, omit
        }
      }

      return json(res, { items: vaultItems });
    }

    // 12. POST /api/drive/edit-uploader (Admin only: update file uploader metadata)
    if (action === "edit-uploader" || action === "uploader") {
      if (!requireAdmin(session)) {
        return error(res, "Only the admin can edit file uploader metadata.", 403);
      }

      const body = await parseJsonBody<{ driveId: string; uploaderName: string }>(req).catch(() => ({} as any));
      if (!body.driveId || !body.uploaderName?.trim()) {
        return error(res, "driveId and uploaderName are required", 400);
      }

      await assertInsideVault(body.driveId);
      const newUploader = body.uploaderName.trim();
      const updated = await updateDriveAppProperties(body.driveId, {
        uploadedByName: newUploader,
        uploadedAt: new Date().toISOString(),
      });

      await db.insert(activity).values({
        userId: session.email,
        userName: session.name,
        action: "edit_uploader",
        driveId: body.driveId,
        name: updated.name,
        path: updated.parents?.[0] || getVaultRootId(),
        meta: { newUploaderName: newUploader },
      });

      return json(res, { success: true, item: updated, uploadedByName: newUploader });
    }

    // 13. POST /api/drive/seed-categories
    if (action === "seed-categories") {
      if (!requireAdmin(session)) {
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

      // Read uploader strictly from verified session (never client input)
      const uploadedById = String(session.id);
      const uploadedByName = session.name || session.email;
      const uploadedAt = new Date().toISOString();

      appProperties.uploadedById = uploadedById;
      appProperties.uploadedByName = uploadedByName;
      appProperties.uploadedAt = uploadedAt;
      if (session.email) appProperties.uploadedByEmail = session.email;

      // Forward client Origin header (or referer origin) to Google Drive
      let originHeader = (req.headers.origin || "").trim();
      if (!originHeader && req.headers.referer) {
        try {
          originHeader = new URL(req.headers.referer).origin;
        } catch {
          // ignore
        }
      }

      const { uploadUrl, fileName } = await createResumableUploadSession(
        body.name,
        body.mimeType || "application/octet-stream",
        targetParent,
        appProperties,
        originHeader
      );

      return json(res, {
        uploadUrl,
        fileName,
        uploadedByName,
        uploadedById,
        uploadedAt,
      });
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

      // Read uploader strictly from verified session (never client input)
      const uploadedById = String(session.id);
      const uploadedByName = session.name || session.email;
      const uploadedAt = new Date().toISOString();

      // Ensure Drive appProperties contains uploader metadata
      try {
        await updateDriveAppProperties(verifiedFile.id, {
          uploadedById,
          uploadedByName,
          uploadedAt,
          ...(session.email ? { uploadedByEmail: session.email } : {}),
        });
      } catch (propErr) {
        console.warn("[Upload Complete] AppProperties update notice:", propErr);
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
          userName: uploadedByName,
          action: "upload",
          driveId: verifiedFile.id,
          name: verifiedFile.name,
          path: targetParent,
          meta: {
            size: verifiedFile.size || body.size,
            mimeType: verifiedFile.mimeType || body.mimeType,
            uploadedById,
            uploadedByName,
            uploadedAt,
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
    if (
      err instanceof AdminDriveTransientError ||
      err.code === "GOOGLE_TRANSIENT_ERROR" ||
      err.code === "DRIVE_TRANSIENT_ERROR"
    ) {
      return json(
        res,
        {
          error: "Google Drive service temporarily unavailable. Please retry in a few moments.",
          code: "DRIVE_TRANSIENT_ERROR",
          retryable: true,
        },
        503
      );
    }
    if (err.statusCode === 400 || err.status === 400) {
      return error(res, err.message, 400, { code: err.code || "BAD_REQUEST" });
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
