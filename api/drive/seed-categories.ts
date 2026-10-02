import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { getEnv } from "../_utils/env";
import { json, error } from "../_utils/response";

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

    const env = getEnv();
    const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    if (!rootId) {
      return error(res, "GOOGLE_DRIVE_ROOT_FOLDER_ID not configured", 500);
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
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });

    if (!listRes.ok) {
      const errData = await listRes.json();
      return error(res, errData.error?.message || "Failed to inspect root folder in Google Drive", listRes.status);
    }

    const listData = await listRes.json();
    const existingFolders = new Map<string, string>(); // lowerName -> id
    for (const f of listData.files || []) {
      existingFolders.set(f.name.toLowerCase().trim(), f.id);
    }

    const created: Array<{ id: string; name: string }> = [];
    const skipped: string[] = [];

    // 2. Create missing categories
    for (const catName of DEFAULT_CATEGORIES) {
      if (existingFolders.has(catName.toLowerCase())) {
        skipped.push(catName);
        continue;
      }

      const createRes = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: catName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [rootId],
        }),
      });

      if (!createRes.ok) {
        const createErr = await createRes.json();
        console.error(`[Seed Categories Error] Failed to create ${catName}:`, createErr);
        continue;
      }

      const createdFolder = await createRes.json();
      created.push({ id: createdFolder.id, name: createdFolder.name });
    }

    return json(res, {
      success: true,
      createdCount: created.length,
      created,
      skipped,
    });
  } catch (err: any) {
    console.error("[Seed Categories Exception]:", err);
    return error(res, err.message || "Failed to seed default categories", 500);
  }
}
