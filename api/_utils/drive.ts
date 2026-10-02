import { db } from "../../src/db/index.js";
import { settings } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./crypto.js";
import { getEnv } from "./env.js";

export class AdminDriveError extends Error {
  code: string;
  constructor(message: string, code = "ADMIN_DRIVE_NOT_CONNECTED") {
    super(message);
    this.name = "AdminDriveError";
    this.code = code;
  }
}

interface GoogleTokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: GoogleTokenCache | null = null;
const verifiedFolderIds = new Map<string, number>();
const VERIFIED_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export function invalidateAdminTokenCache() {
  tokenCache = null;
}

export function invalidateVaultCache() {
  verifiedFolderIds.clear();
}

/**
 * Returns the Vault root folder ID.
 * Never falls back to 'root' or 'me'.
 */
export function getVaultRootId(): string {
  const env = getEnv();
  const root = env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (!root || root.toLowerCase() === "root") {
    throw new Error("Missing or invalid GOOGLE_DRIVE_ROOT_FOLDER_ID configuration");
  }
  return root;
}

/**
 * Retrieves the admin refresh token from Neon settings table,
 * falling back to GOOGLE_ADMIN_REFRESH_TOKEN env only if not set in DB.
 */
async function getStoredAdminRefreshToken(): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "admin_drive_refresh_token"))
      .limit(1);

    if (row?.valueEncrypted) {
      return decryptSecret(row.valueEncrypted);
    }
  } catch (err) {
    console.error("[Drive]: Failed to read admin token from settings table:", err);
  }

  const envToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  return null;
}

/**
 * Exchanges admin refresh token for short-lived access token with in-memory caching.
 * Throws AdminDriveError with code ADMIN_DRIVE_NOT_CONNECTED if token is missing or revoked.
 */
export async function getAdminAccessToken(): Promise<string> {
  const env = getEnv();

  // Return cached token if valid (with 60-second buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  const refreshToken = await getStoredAdminRefreshToken();
  if (!refreshToken) {
    throw new AdminDriveError(
      "Admin Google Drive is not connected. Please connect the Drive as admin.",
      "ADMIN_DRIVE_NOT_CONNECTED"
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    tokenCache = null;
    throw new AdminDriveError(
      `Google Drive admin token is invalid or revoked (${data.error || "invalid_grant"}): ${data.error_description || "Token refresh failed"}`,
      "ADMIN_DRIVE_NOT_CONNECTED"
    );
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
}

/**
 * Server-side helper that returns an authenticated Drive client context.
 */
export async function getAdminDrive() {
  const token = await getAdminAccessToken();
  return {
    accessToken: token,
    rootFolderId: getVaultRootId(),
  };
}

/**
 * Verifies that a folder or file ID is DRIVE_ROOT_FOLDER_ID or a descendant
 * by walking the parents chain. Caches verified IDs for 5 minutes.
 */
export async function isInsideVault(id: string, token?: string): Promise<boolean> {
  const rootId = getVaultRootId();
  if (!id) return false;
  if (id === rootId) return true;
  if (id.toLowerCase() === "root" || id.toLowerCase() === "me") return false;

  const cached = verifiedFolderIds.get(id);
  if (cached && Date.now() - cached < VERIFIED_TTL_MS) {
    return true;
  }

  const accessToken = token || (await getAdminAccessToken());
  let currentId: string | undefined = id;
  const visited = new Set<string>();
  const chain: string[] = [id];

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(currentId)}?fields=id,parents,trashed&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!res.ok) {
      return false;
    }

    const data = await res.json();
    const parents: string[] = data.parents || [];

    if (parents.includes(rootId)) {
      const now = Date.now();
      for (const item of chain) {
        verifiedFolderIds.set(item, now);
      }
      return true;
    }

    if (parents.length === 0) {
      return false;
    }

    currentId = parents[0];
    chain.push(currentId);
  }

  return false;
}

/**
 * Asserts that an item ID belongs to the vault root tree.
 * Throws an error with statusCode = 403 if it is outside the tree.
 */
export async function assertInsideVault(id: string, token?: string): Promise<void> {
  const ok = await isInsideVault(id, token);
  if (!ok) {
    const err: any = new Error(`Access denied: Item ${id} is not within the vault root.`);
    err.statusCode = 403;
    err.status = 403;
    throw err;
  }
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  appProperties?: Record<string, string>;
  thumbnailLink?: string;
  iconLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  trashed?: boolean;
}

/**
 * Lists files and folders under a folder in the vault.
 * Defaults to DRIVE_ROOT_FOLDER_ID and verifies ancestry.
 */
export async function listDriveItems(
  folderId?: string,
  searchQuery?: string,
  trashed = false
): Promise<{ files: DriveItem[]; nextPageToken?: string; folderName?: string }> {
  const targetFolder = folderId || getVaultRootId();
  await assertInsideVault(targetFolder);

  const accessToken = await getAdminAccessToken();

  let q = `'${targetFolder}' in parents and trashed = ${trashed}`;
  if (searchQuery) {
    q = `name contains '${searchQuery.replace(/'/g, "\\'")}' and trashed = ${trashed}`;
  }

  const allFiles: DriveItem[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const params = new URLSearchParams({
      q,
      fields:
        "nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, owners, appProperties, thumbnailLink, iconLink, webViewLink, webContentLink, parents, trashed)",
      pageSize: "100",
      orderBy: "folder,name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "Failed to list Google Drive files");
    }

    if (Array.isArray(data.files)) {
      allFiles.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { files: allFiles };
}

/**
 * Fetches file metadata, asserting it is inside the vault.
 */
export async function getDriveFile(fileId: string): Promise<DriveItem> {
  await assertInsideVault(fileId);

  const accessToken = await getAdminAccessToken();
  const params = new URLSearchParams({
    fields:
      "id, name, mimeType, size, modifiedTime, createdTime, owners, appProperties, thumbnailLink, iconLink, webViewLink, webContentLink, parents, trashed",
    supportsAllDrives: "true",
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "File not found");
  return data;
}

/**
 * Creates a folder inside parentId (defaults to vault root), asserting parent is in vault.
 */
export async function createDriveFolder(
  name: string,
  parentId?: string,
  appProperties?: Record<string, string>
): Promise<DriveItem> {
  const parent = parentId || getVaultRootId();
  await assertInsideVault(parent);

  const accessToken = await getAdminAccessToken();

  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parent],
  };

  if (appProperties) {
    body.appProperties = appProperties;
  }

  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to create folder");

  // Cache new folder as verified
  verifiedFolderIds.set(data.id, Date.now());

  return data;
}

/**
 * Renames an item inside the vault.
 */
export async function renameDriveItem(fileId: string, newName: string): Promise<DriveItem> {
  await assertInsideVault(fileId);

  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to rename item");
  return data;
}

/**
 * Moves an item inside the vault (asserts file and both parents are inside the vault).
 */
export async function moveDriveItem(
  fileId: string,
  newParentId: string,
  oldParentId: string
): Promise<DriveItem> {
  await assertInsideVault(fileId);
  await assertInsideVault(newParentId);
  await assertInsideVault(oldParentId);

  const accessToken = await getAdminAccessToken();
  const params = new URLSearchParams({
    addParents: newParentId,
    removeParents: oldParentId,
    enforceSingleParent: "true",
    supportsAllDrives: "true",
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to move item");
  return data;
}

/**
 * Sets trashed status on a file inside the vault.
 */
export async function setDriveTrashed(fileId: string, trashed: boolean): Promise<DriveItem> {
  await assertInsideVault(fileId);

  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to update trash status");
  return data;
}

/**
 * Permanently deletes a file inside the vault.
 */
export async function deleteDriveItemPermanently(fileId: string): Promise<boolean> {
  await assertInsideVault(fileId);

  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok && res.status !== 204) {
    const data = await res.json();
    throw new Error(data.error?.message || "Failed to delete file permanently");
  }
  return true;
}

/**
 * Updates appProperties (tags, notes) on an item inside the vault.
 */
export async function updateDriveAppProperties(
  fileId: string,
  appProperties: Record<string, string>
): Promise<DriveItem> {
  await assertInsideVault(fileId);

  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appProperties }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to update appProperties");
  return data;
}

/**
 * Initiates resumable upload session in parentId (defaults to vault root).
 */
export async function createResumableUploadSession(
  name: string,
  mimeType: string,
  size: number,
  parentId?: string,
  appProperties?: Record<string, string>
): Promise<{ uploadUrl: string }> {
  const parent = parentId || getVaultRootId();
  await assertInsideVault(parent);

  const accessToken = await getAdminAccessToken();

  const metadata: Record<string, unknown> = {
    name,
    parents: [parent],
    mimeType,
  };

  if (appProperties) {
    metadata.appProperties = appProperties;
  }

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": size.toString(),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (res.status !== 200) {
    const errorData = await res.json();
    throw new Error(errorData.error?.message || "Failed to initiate resumable upload session");
  }

  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Missing Location header from Google Drive resumable upload endpoint");
  }

  return { uploadUrl };
}

/**
 * Fetches admin's storage quota for vault storage meter.
 * Handles missing limit for unlimited plans.
 */
export async function getDriveStorageQuota(): Promise<{
  limit?: string;
  usage: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
  isUnlimited: boolean;
}> {
  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=storageQuota",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to fetch storage info");

  const quota = data.storageQuota || {};
  const isUnlimited = !quota.limit || quota.limit === "0" || quota.limit === "-1";

  return {
    limit: quota.limit,
    usage: quota.usage || "0",
    usageInDrive: quota.usageInDrive,
    usageInDriveTrash: quota.usageInDriveTrash,
    isUnlimited,
  };
}
