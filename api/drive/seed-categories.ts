import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth.js";
import {
  getAdminAccessToken,
  getVaultRootId,
  AdminDriveError,
  createDriveFolder,
} from "../_utils/drive.js";
import { json, error } from "../_utils/response.js";

const DEFAULT_CATEGORIES = [
  "Identity",
  "Medical",
  "Property",
  "Finance",
  "Education",
  "Vehicle",
];

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    return error(res, "Method not allowed", 405);
  }

  try {
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }

    if (user.role !== "admin") {
      return error(res, "Forbidden: Admin role required to seed default categories", 403);
    }

    const rootId = getVaultRootId();

    let adminToken: string;
    try {
      adminToken = await getAdminAccessToken();
    } catch (err: any) {
      if (err instanceof AdminDriveError || err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
        return json(
          res,
          { error: "Vault Google Drive is not connected.", code: "ADMIN_DRIVE_NOT_CONNECTED" },
          503
        );
      }
      throw err;
    }

    // 1. Fetch existing subfolders in root
    const q = `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listParams = new URLSearchParams({
      q,
      fields: "files(id, name)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });

    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${listParams.toString()}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!listRes.ok) {
      const errData = await listRes.json().catch(() => ({}));
      return error(res, errData.error?.message || "Failed to inspect root folder in Google Drive", listRes.status);
    }

    const listData = await listRes.json();
    const existingFolders = new Map<string, string>();
    for (const f of listData.files || []) {
      existingFolders.set(f.name.toLowerCase().trim(), f.id);
    }

    // 2. Create missing categories
    const created: Array<{ name: string; id: string }> = [];
    const skipped: string[] = [];

    for (const category of DEFAULT_CATEGORIES) {
      const key = category.toLowerCase().trim();
      if (existingFolders.has(key)) {
        skipped.push(category);
        continue;
      }

      const folder = await createDriveFolder(category, rootId, {
        isVaultCategory: "true",
        categoryName: category,
      });

      created.push({ name: category, id: folder.id });
    }

    return json(res, {
      success: true,
      message: `Vault categories verified: ${created.length} created, ${skipped.length} already existed`,
      created,
      skipped,
    });
  } catch (err: any) {
    if (err instanceof AdminDriveError || err.code === "ADMIN_DRIVE_NOT_CONNECTED") {
      return json(
        res,
        { error: "Vault Google Drive is not connected.", code: "ADMIN_DRIVE_NOT_CONNECTED" },
        503
      );
    }
    console.error("[Seed Categories Error]:", err);
    return error(res, err.message || "Failed to seed default categories", 500);
  }
}
