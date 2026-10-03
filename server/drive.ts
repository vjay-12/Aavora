import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, decryptSecretWithFallback } from "./crypto.js";
import { getEnv, getOAuthRedirectUri } from "./env.js";
import { maskEmail } from "./auth.js";
import { decodeJwt } from "jose";
import type { IncomingMessage, ServerResponse } from "http";

export class AdminDriveError extends Error {
  code: string;
  constructor(message: string, code = "ADMIN_DRIVE_NOT_CONNECTED") {
    super(message);
    this.name = "AdminDriveError";
    this.code = code;
  }
}

export class AdminDriveTransientError extends Error {
  code: string;
  statusCode: number;
  retryable: boolean;
  constructor(message: string, code = "GOOGLE_TRANSIENT_ERROR", statusCode = 503) {
    super(message);
    this.name = "AdminDriveTransientError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = true;
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
 * Returns the settings table key for storing the admin refresh token.
 * Prevents Vercel Preview deployments from reading or overwriting the production token.
 */
export function getAdminTokenSettingKey(): string {
  if (process.env.ADMIN_TOKEN_SETTING_KEY) {
    return process.env.ADMIN_TOKEN_SETTING_KEY.trim();
  }
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview") {
    return "admin_drive_refresh_token_preview";
  }
  return "admin_drive_refresh_token";
}

/**
 * Persists an encrypted admin refresh token to Neon settings table.
 * Never overwrites with an empty value.
 */
export async function saveAdminRefreshToken(refreshToken: string): Promise<void> {
  const trimmed = (refreshToken || "").trim();
  if (!trimmed) {
    console.warn("[AdminDrive] Attempted to save empty refresh token; ignored.");
    return;
  }

  const key = getAdminTokenSettingKey();
  const encryptedToken = encryptSecret(trimmed);
  await db
    .insert(settings)
    .values({
      key,
      valueEncrypted: encryptedToken,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        valueEncrypted: encryptedToken,
        updatedAt: new Date(),
      },
    });

  invalidateAdminTokenCache();
  invalidateVaultCache();
}

/**
 * Records the timestamp of a successful token refresh for health monitoring.
 */
export async function recordAdminDriveLastRefreshed(): Promise<void> {
  try {
    const key = `${getAdminTokenSettingKey()}_last_refreshed`;
    const encrypted = encryptSecret(new Date().toISOString());
    await db
      .insert(settings)
      .values({
        key,
        valueEncrypted: encrypted,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          valueEncrypted: encrypted,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Non-blocking
  }
}

/**
 * Returns the admin drive health status.
 */
export async function getAdminDriveHealth(): Promise<{
  connected: boolean;
  status: "connected" | "disconnected" | "transient_error";
  code?: string;
  lastRefreshedAt: string | null;
  message?: string;
}> {
  try {
    await getAdminAccessToken(false);
    return {
      connected: true,
      status: "connected",
      lastRefreshedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    if (err instanceof AdminDriveError) {
      return {
        connected: false,
        status: "disconnected",
        code: err.code || "ADMIN_DRIVE_NOT_CONNECTED",
        lastRefreshedAt: null,
        message: err.message,
      };
    }
    return {
      connected: false,
      status: "transient_error",
      code: err.code || "GOOGLE_TRANSIENT_ERROR",
      lastRefreshedAt: null,
      message: err.message,
    };
  }
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
 * falling back to legacy key decryption and re-encrypting with new ENCRYPTION_KEY if needed.
 * Logs error code only when retrieval or decryption fails.
 */
async function getStoredAdminRefreshToken(): Promise<string | null> {
  const key = getAdminTokenSettingKey();
  let row: any = null;

  try {
    const [found] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    row = found;
  } catch (err: any) {
    console.error("[AdminDrive] Failed reading settings table:", err?.message || err);
  }

  if (row?.valueEncrypted) {
    try {
      const { plainText, usedFallback, keyName } = decryptSecretWithFallback(row.valueEncrypted);
      if (usedFallback && plainText) {
        console.log(`[AdminDrive] Upgrading token encryption with primary key (decrypted via ${keyName})`);
        saveAdminRefreshToken(plainText).catch((saveErr) => {
          console.warn("[AdminDrive] Re-encryption save warning:", saveErr?.message);
        });
      }
      return plainText;
    } catch {
      console.error("[AdminDrive] Connection failed: DECRYPT_FAILED");
      const envToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN?.trim();
      if (envToken) {
        return envToken;
      }
      return null;
    }
  }

  const envToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  console.error("[AdminDrive] Connection failed: TOKEN_MISSING");
  return null;
}

/**
 * Exchanges admin refresh token for short-lived access token with in-memory caching.
 * Retries transient errors (network, 5xx, rate limits) with exponential backoff.
 * Throws AdminDriveError (ADMIN_DRIVE_NOT_CONNECTED) ONLY on invalid_grant, revoked token, or missing row.
 */
export async function getAdminAccessToken(forceRefresh = false): Promise<string> {
  const env = getEnv();

  // Return cached token if valid (with 60-second buffer) unless forceRefresh is true
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  const refreshToken = await getStoredAdminRefreshToken();
  if (!refreshToken) {
    throw new AdminDriveError(
      "Admin Google Drive is not connected. Please connect the Drive as admin.",
      "ADMIN_DRIVE_NOT_CONNECTED"
    );
  }

  const maxRetries = 3;
  let lastTransientError: AdminDriveTransientError | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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

      // Transient Google HTTP errors (5xx or 429 rate limit)
      if (res.status >= 500 || res.status === 429) {
        lastTransientError = new AdminDriveTransientError(
          `Google OAuth returned transient HTTP ${res.status}`,
          "GOOGLE_TRANSIENT_ERROR",
          503
        );
        if (attempt < maxRetries) {
          const delayMs = Math.min(300 * Math.pow(2, attempt - 1), 2000);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        break;
      }

      const data = await res.json();
      if (!res.ok || !data.access_token) {
        tokenCache = null;
        const errCode = data.error || "";
        if (errCode === "invalid_grant" || errCode === "unauthorized_client") {
          console.error("[AdminDrive] Connection failed: GOOGLE_INVALID_GRANT");
          throw new AdminDriveError(
            `Google Drive admin token is invalid or revoked (${errCode}): ${data.error_description || "Token refresh failed"}`,
            "ADMIN_DRIVE_NOT_CONNECTED"
          );
        }

        // Other non-200 responses are treated as transient
        lastTransientError = new AdminDriveTransientError(
          `Google OAuth error (${errCode || res.status}): ${data.error_description || "Token refresh failed"}`,
          "GOOGLE_TRANSIENT_ERROR",
          503
        );
        if (attempt < maxRetries) {
          const delayMs = Math.min(300 * Math.pow(2, attempt - 1), 2000);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        break;
      }

      // Handle Google token rotation: persist new refresh token if returned
      if (data.refresh_token && typeof data.refresh_token === "string" && data.refresh_token.trim().length > 0) {
        console.log("[AdminDrive] Google returned rotated refresh token; persisting to database.");
        saveAdminRefreshToken(data.refresh_token.trim()).catch((saveErr) => {
          console.warn("[AdminDrive] Failed to persist rotated refresh token:", saveErr?.message);
        });
      }

      tokenCache = {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      };

      recordAdminDriveLastRefreshed().catch(() => {});

      return data.access_token;
    } catch (err: any) {
      if (err instanceof AdminDriveError) {
        throw err;
      }
      lastTransientError = new AdminDriveTransientError(
        `Network error communicating with Google OAuth: ${err?.message || "fetch failed"}`,
        "GOOGLE_TRANSIENT_ERROR",
        503
      );
      if (attempt < maxRetries) {
        const delayMs = Math.min(300 * Math.pow(2, attempt - 1), 2000);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }

  console.error("[AdminDrive] Connection failed: GOOGLE_TRANSIENT_ERROR");
  throw lastTransientError || new AdminDriveTransientError("Failed to refresh Google Drive token after transient error retries");
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
      if (res.status === 404) {
        const notFoundErr: any = new Error(`Item ${currentId} not found in Google Drive.`);
        notFoundErr.statusCode = 404;
        notFoundErr.status = 404;
        throw notFoundErr;
      }
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
 * Always asserts the folder is within DRIVE_ROOT_FOLDER_ID.
 */
export async function listDriveItems(
  folderId?: string,
  pageSize = 100,
  pageToken?: string
): Promise<{
  files: DriveItem[];
  nextPageToken?: string;
  currentFolderId: string;
}> {
  const rootId = getVaultRootId();
  const targetFolderId = folderId || rootId;

  // Enforce root boundary
  await assertInsideVault(targetFolderId);

  const accessToken = await getAdminAccessToken();
  const q = `'${targetFolderId}' in parents and trashed = false`;
  const fields =
    "nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, owners, appProperties, thumbnailLink, iconLink, webViewLink, webContentLink, parents, trashed)";

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", fields);
  url.searchParams.set("pageSize", String(Math.min(pageSize, 100)));
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("orderBy", "folder,name");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to list Google Drive files");
  }

  // Cache targetFolderId and returned folders as verified
  const now = Date.now();
  verifiedFolderIds.set(targetFolderId, now);
  if (Array.isArray(data.files)) {
    for (const f of data.files) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        verifiedFolderIds.set(f.id, now);
      }
    }
  }

  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
    currentFolderId: targetFolderId,
  };
}

/**
 * Gets a file by ID, enforcing that it is inside the vault.
 */
export async function getDriveFile(fileId: string): Promise<DriveItem> {
  await assertInsideVault(fileId);

  const accessToken = await getAdminAccessToken();
  const fields =
    "id, name, mimeType, size, modifiedTime, createdTime, owners, appProperties, thumbnailLink, iconLink, webViewLink, webContentLink, parents, trashed";

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(
      fields
    )}&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to get file from Google Drive");
  return data;
}

/**
 * Creates a folder inside a parent folder in the vault.
 */
export async function createDriveFolder(
  name: string,
  parentId?: string,
  color?: string
): Promise<DriveItem> {
  const rootId = getVaultRootId();
  const targetParent = parentId || rootId;

  // Boundary check: must be inside root
  await assertInsideVault(targetParent);

  const accessToken = await getAdminAccessToken();
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [targetParent],
  };

  if (color) {
    body.appProperties = { folderColor: color };
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

  // Cache newly created folder as verified
  verifiedFolderIds.set(data.id, Date.now());

  return data;
}

/**
 * Renames a Drive file or folder in the vault.
 */
export async function renameDriveItem(itemId: string, newName: string): Promise<DriveItem> {
  await assertInsideVault(itemId);
  const accessToken = await getAdminAccessToken();

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?supportsAllDrives=true`,
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
 * Moves a Drive file or folder to a new parent within the vault.
 */
export async function moveDriveItem(
  itemId: string,
  newParentId: string,
  currentParentId?: string
): Promise<DriveItem> {
  await assertInsideVault(itemId);
  await assertInsideVault(newParentId);

  const accessToken = await getAdminAccessToken();
  let removeParents = currentParentId;

  if (!removeParents) {
    const file = await getDriveFile(itemId);
    removeParents = file.parents?.join(",");
  }

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}`);
  url.searchParams.set("addParents", newParentId);
  if (removeParents) url.searchParams.set("removeParents", removeParents);
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to move item");
  return data;
}

/**
 * Moves an item to Drive Trash (soft-delete).
 */
export async function setDriveTrashed(itemId: string, trashed: boolean): Promise<DriveItem> {
  if (!trashed) {
    // Restoring: verify it belongs to vault before restoring
    await assertInsideVault(itemId);
  } else {
    await assertInsideVault(itemId);
  }

  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?supportsAllDrives=true`,
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
  if (!res.ok) throw new Error(data.error?.message || `Failed to ${trashed ? "trash" : "restore"} item`);
  return data;
}

/**
 * Permanently deletes an item from Google Drive (admin-only).
 */
export async function deleteDriveItemPermanently(itemId: string): Promise<void> {
  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?supportsAllDrives=true`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Failed to permanently delete item");
  }

  verifiedFolderIds.delete(itemId);
}

/**
 * Updates appProperties (e.g. tags, notes) for a file in the vault.
 */
export async function updateDriveAppProperties(
  itemId: string,
  appProperties: Record<string, string>
): Promise<DriveItem> {
  await assertInsideVault(itemId);
  const accessToken = await getAdminAccessToken();

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?supportsAllDrives=true`,
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
  if (!res.ok) throw new Error(data.error?.message || "Failed to update item metadata");
  return data;
}

export interface VerifiedUploadedFile {
  id: string;
  name: string;
  size?: number | string;
  mimeType?: string;
  parents?: string[];
  createdTime?: string;
}

/**
 * Initiates a Google Drive resumable upload session for direct client uploads.
 * Forwards browser's Origin header (or APP_URL) so Google returns CORS headers for client PUTs.
 * Bypasses Vercel 4.5MB serverless payload limit.
 */
export async function createResumableUploadSession(
  name: string,
  mimeType: string,
  parentId?: string,
  appProperties?: Record<string, string>,
  origin?: string
): Promise<{ uploadUrl: string }> {
  const rootId = getVaultRootId();
  const targetParent = parentId || rootId;

  // Boundary check
  await assertInsideVault(targetParent);

  const accessToken = await getAdminAccessToken();
  const metadata: Record<string, unknown> = {
    name,
    mimeType,
    parents: [targetParent],
  };

  if (appProperties) {
    metadata.appProperties = appProperties;
  }

  const env = getEnv();
  const effectiveOrigin = (origin || env.APP_URL || "").trim();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Upload-Content-Type": mimeType || "application/octet-stream",
  };

  if (effectiveOrigin) {
    headers["Origin"] = effectiveOrigin;
  }

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers,
      body: JSON.stringify(metadata),
    }
  );

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Failed to initiate resumable upload session");
  }

  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("Missing Location header from Google Drive resumable upload endpoint");
  }

  return { uploadUrl };
}

/**
 * Robustly verifies whether an uploaded file exists in Google Drive:
 * 1. By direct driveId if provided and inside vault.
 * 2. By querying the resumable upload session URL (PUT Content-Range: bytes * / <size>).
 * 3. By querying Google Drive files.list (matching name, parent, and optionally size, created in last 10 mins).
 * Returns the verified file metadata, or null if verification confirms it is missing.
 */
export async function verifyOrFindUploadedFile(params: {
  driveId?: string;
  uploadUrl?: string;
  name: string;
  parentId?: string;
  size?: number;
  mimeType?: string;
}): Promise<VerifiedUploadedFile | null> {
  const rootId = getVaultRootId();
  const targetParent = params.parentId || rootId;

  // 1. Direct driveId verification
  if (params.driveId && params.driveId !== "unknown") {
    try {
      await assertInsideVault(params.driveId);
      const file = await getDriveFile(params.driveId);
      if (file && !file.trashed) {
        return {
          id: file.id,
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          parents: file.parents,
          createdTime: file.createdTime,
        };
      }
    } catch {
      // Continue to next verification strategies
    }
  }

  // 2. Query resumable upload session status from Google Drive
  if (params.uploadUrl) {
    try {
      const sessionCheckRes = await fetch(params.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes */${typeof params.size === "number" && params.size > 0 ? params.size : "*"}`,
        },
      });

      if (sessionCheckRes.status === 200 || sessionCheckRes.status === 201) {
        const sessionData = await sessionCheckRes.json().catch(() => null);
        if (sessionData && sessionData.id) {
          return {
            id: sessionData.id,
            name: sessionData.name || params.name,
            size: sessionData.size,
            mimeType: sessionData.mimeType,
            parents: sessionData.parents,
            createdTime: sessionData.createdTime,
          };
        }
      }
    } catch (sessionErr) {
      console.warn("[Upload Verify] Querying upload session failed:", sessionErr);
    }
  }

  // 3. Query files.list in parent folder matching name and recent creation time
  try {
    const accessToken = await getAdminAccessToken();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const safeName = params.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = `name = '${safeName}' and '${targetParent}' in parents and trashed = false and createdTime >= '${tenMinutesAgo}'`;

    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=${encodeURIComponent(
      "files(id, name, mimeType, size, createdTime, parents, trashed)"
    )}&orderBy=${encodeURIComponent("createdTime desc")}&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const listRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (listRes.ok) {
      const listData = await listRes.json().catch(() => ({}));
      const candidateFiles: any[] = listData.files || [];
      if (candidateFiles.length > 0) {
        let matched = candidateFiles[0];
        if (typeof params.size === "number" && params.size > 0) {
          const sizeMatch = candidateFiles.find((f: any) => String(f.size) === String(params.size));
          if (sizeMatch) matched = sizeMatch;
        }
        return {
          id: matched.id,
          name: matched.name,
          size: matched.size,
          mimeType: matched.mimeType,
          parents: matched.parents,
          createdTime: matched.createdTime,
        };
      }
    }
  } catch (listErr) {
    console.warn("[Upload Verify] files.list check failed:", listErr);
  }

  return null;
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

/**
 * Completes the Admin Drive OAuth connection callback:
 * 1. Exchanges code for tokens using byte-for-byte identical redirect_uri
 * 2. Reads verified email from ID token, ensuring it equals ADMIN_EMAIL
 * 3. Enforces that a refresh token was returned by Google
 * 4. Encrypts and stores the refresh token in the settings table
 * 5. Invalidates caches and redirects to /home?driveConnected=true
 */
export async function handleAdminDriveConnectCallback(
  req: IncomingMessage,
  res: ServerResponse,
  code: string
): Promise<void> {
  const env = getEnv();
  const redirectUri = getOAuthRedirectUri();

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[Admin Drive OAuth] Token exchange failed:", tokenData);
      res.statusCode = 302;
      res.setHeader(
        "Location",
        `/more?driveError=token_exchange_failed&msg=${encodeURIComponent(
          tokenData.error_description || "Token exchange failed"
        )}`
      );
      res.end();
      return;
    }

    // Read verified email from ID token
    let verifiedEmail = "";
    if (tokenData.id_token) {
      try {
        const claims = decodeJwt(tokenData.id_token);
        if (claims.email && (claims.email_verified === true || claims.email_verified === "true")) {
          verifiedEmail = String(claims.email).toLowerCase().trim();
        }
      } catch (err) {
        console.error("[Admin Drive OAuth] Failed to decode id_token:", err);
      }
    }

    // Fallback to userinfo if needed
    if (!verifiedEmail && tokenData.access_token) {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json();
      if (profile.email) {
        verifiedEmail = String(profile.email).toLowerCase().trim();
      }
    }

    // Must match ADMIN_EMAIL (case-insensitive)
    if (verifiedEmail.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
      console.error(
        "[Admin Drive OAuth] Email mismatch: authenticated Google account is not the configured admin."
      );
      const maskedAdmin = maskEmail(env.ADMIN_EMAIL);
      const msg = `Please connect with ${maskedAdmin}`;
      res.statusCode = 302;
      res.setHeader(
        "Location",
        `/more?driveError=wrong_account&msg=${encodeURIComponent(msg)}`
      );
      res.end();
      return;
    }

    // Must return a refresh token
    if (!tokenData.refresh_token) {
      console.warn("[Admin Drive OAuth] No refresh token returned by Google");
      const msg =
        "Google did not return a refresh token. Remove Aavora at myaccount.google.com/permissions and try again.";
      res.statusCode = 302;
      res.setHeader(
        "Location",
        `/more?driveError=missing_refresh_token&msg=${encodeURIComponent(msg)}`
      );
      res.end();
      return;
    }

    // Encrypt and store in settings table via saveAdminRefreshToken
    await saveAdminRefreshToken(tokenData.refresh_token);

    res.statusCode = 302;
    res.setHeader("Location", "/home?driveConnected=true");
    res.end();
    return;
  } catch (err: any) {
    console.error("[Admin Drive OAuth Callback Error]:", err);
    res.statusCode = 302;
    res.setHeader(
      "Location",
      `/more?driveError=server_error&msg=${encodeURIComponent(err.message || "Failed to connect Google Drive")}`
    );
    res.end();
    return;
  }
}
