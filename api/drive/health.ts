import type { IncomingMessage, ServerResponse } from "http";
import { authenticateRequest } from "../_utils/auth";
import { getEnv } from "../_utils/env";
import { json, error } from "../_utils/response";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const user = await authenticateRequest(req, res);
    if (!user) {
      return error(res, "Unauthorized", 401);
    }

    const env = getEnv();
    const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    if (!rootId) {
      return json(res, {
        rootFolderFound: false,
        rootFolderName: null,
        canRead: false,
        itemCount: 0,
        error: "GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured in environment",
      });
    }

    // 1. Inspect user token scopes
    let tokenScopes: string[] = [];
    try {
      const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${user.accessToken}`);
      if (tokenInfoRes.ok) {
        const tokenInfo = await tokenInfoRes.json();
        tokenScopes = (tokenInfo.scope || "").split(" ");
      }
    } catch {
      // Ignore tokeninfo failure
    }

    // 2. Drive API files.get on root folder ID
    let rootFolderFound = false;
    let rootFolderName: string | null = null;
    let canRead = false;
    let googleError: { code?: number; message?: string } | null = null;
    let folderMeta: any = null;

    try {
      const getRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${rootId}?fields=id,name,mimeType,trashed,capabilities(canListChildren,canAddChildren,canReadRevisions),owners(emailAddress,displayName),shared&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${user.accessToken}` },
        }
      );

      const getData = await getRes.json();
      if (getRes.ok) {
        rootFolderFound = true;
        rootFolderName = getData.name || null;
        canRead = !getData.trashed;
        folderMeta = {
          name: getData.name,
          mimeType: getData.mimeType,
          trashed: getData.trashed,
          capabilities: getData.capabilities,
          owners: getData.owners,
          shared: getData.shared,
        };
      } else {
        googleError = {
          code: getRes.status,
          message: getData.error?.message || "Failed to inspect root folder",
        };
      }
    } catch (err: any) {
      googleError = { code: 500, message: err.message };
    }

    // 3. Drive API files.list inside root folder
    let itemCount = 0;
    let childItems: Array<{ id: string; name: string; mimeType: string }> = [];

    if (rootFolderFound && canRead) {
      try {
        const q = `'${rootId}' in parents and trashed = false`;
        const listParams = new URLSearchParams({
          q,
          fields: "files(id, name, mimeType)",
          pageSize: "100",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });

        const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${listParams.toString()}`, {
          headers: { Authorization: `Bearer ${user.accessToken}` },
        });

        const listData = await listRes.json();
        if (listRes.ok) {
          childItems = (listData.files || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
          }));
          itemCount = childItems.length;
        } else if (!googleError) {
          googleError = {
            code: listRes.status,
            message: listData.error?.message || "Failed to list children",
          };
        }
      } catch (err: any) {
        if (!googleError) googleError = { code: 500, message: err.message };
      }
    }

    return json(res, {
      userEmail: user.email,
      userRole: user.role,
      hasFullDriveScope: tokenScopes.includes("https://www.googleapis.com/auth/drive"),
      rootFolderFound,
      rootFolderName,
      canRead,
      itemCount,
      childItems,
      googleError,
      folderMeta,
    });
  } catch (err: any) {
    return error(res, err.message || "Failed to execute health check", 500);
  }
}
