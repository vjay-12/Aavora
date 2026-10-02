interface GoogleTokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: GoogleTokenCache | null = null;

// Exchange Admin Refresh Token for short-lived Access Token
export async function getAdminAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADMIN_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google OAuth credentials or GOOGLE_ADMIN_REFRESH_TOKEN");
  }

  // Return cached token if valid (with 60-second buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google OAuth token refresh failed: ${data.error_description || data.error}`);
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
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

// Get root folder ID from environment or 'root'
export function getRootFolderId(): string {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "root";
}

// List files and folders
export async function listDriveItems(
  folderId?: string,
  searchQuery?: string,
  trashed = false
): Promise<{ files: DriveItem[]; nextPageToken?: string }> {
  const accessToken = await getAdminAccessToken();
  const targetFolder = folderId || getRootFolderId();

  let q = `'${targetFolder}' in parents and trashed = ${trashed}`;
  if (searchQuery) {
    q = `name contains '${searchQuery.replace(/'/g, "\\'")}' and trashed = ${trashed}`;
  }

  const params = new URLSearchParams({
    q,
    fields:
      "nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, owners, appProperties, thumbnailLink, iconLink, webViewLink, webContentLink, parents, trashed)",
    pageSize: "100",
    orderBy: "folder,name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to list Google Drive files");
  }

  return data;
}

// Get file metadata
export async function getDriveFile(fileId: string): Promise<DriveItem> {
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

// Create a new folder
export async function createDriveFolder(
  name: string,
  parentId?: string,
  appProperties?: Record<string, string>
): Promise<DriveItem> {
  const accessToken = await getAdminAccessToken();
  const parent = parentId || getRootFolderId();

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
  return data;
}

// Rename file or folder
export async function renameDriveItem(fileId: string, newName: string): Promise<DriveItem> {
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

// Move file or folder
export async function moveDriveItem(
  fileId: string,
  newParentId: string,
  oldParentId: string
): Promise<DriveItem> {
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

// Trash / Untrash file or folder
export async function setDriveTrashed(fileId: string, trashed: boolean): Promise<DriveItem> {
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

// Permanent delete (Admin only)
export async function deleteDriveItemPermanently(fileId: string): Promise<boolean> {
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

// Update file metadata / appProperties (tags, notes)
export async function updateDriveAppProperties(
  fileId: string,
  appProperties: Record<string, string>
): Promise<DriveItem> {
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

// Create Resumable Upload Session (Direct upload from browser to Google Drive)
export async function createResumableUploadSession(
  name: string,
  mimeType: string,
  size: number,
  parentId?: string,
  appProperties?: Record<string, string>
): Promise<{ uploadUrl: string }> {
  const accessToken = await getAdminAccessToken();
  const parent = parentId || getRootFolderId();

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

// Drive Storage Quota and About info
export async function getDriveStorageQuota(providedToken?: string): Promise<{
  limit?: string;
  usage?: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
}> {
  const accessToken = providedToken || (await getAdminAccessToken());
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=storageQuota,user",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to fetch storage info");
  return data.storageQuota || {};
}
