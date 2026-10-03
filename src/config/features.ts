/**
 * Shared Feature Flags & Access Control
 * Used by BOTH the server and the client.
 *
 * To re-enable member delete later, change MEMBER_DELETE_ENABLED from false to true on line 8.
 */
export const MEMBER_DELETE_ENABLED = false;

/**
 * Temporary feature flag: Bin page is disabled for everyone including admin.
 * Deleted files can be restored from the admin's Google Drive Bin within 30 days.
 * Set to true to re-enable the in-app Bin.
 */
export const BIN_PAGE_ENABLED = false;

export const DELETE_RESTRICTED_CODE = "DELETE_RESTRICTED";
export const DELETE_RESTRICTED_MESSAGE = "Only the admin can delete files right now.";
export const MOVE_TO_BIN_MESSAGE = "Moved to the Drive Bin. You can restore it from Google Drive within 30 days.";

/**
 * Client helper to check whether the current user is permitted to delete/trash/restore.
 * Only returns true if isAdmin is true (or in backward compatible role/flag testing).
 */
export function canUserDelete(userOrAdminOrRole?: { isAdmin?: boolean; role?: string } | boolean | string | null): boolean {
  if (typeof userOrAdminOrRole === "boolean") return userOrAdminOrRole;
  if (userOrAdminOrRole && typeof userOrAdminOrRole === "object") {
    if (typeof userOrAdminOrRole.isAdmin === "boolean") {
      return userOrAdminOrRole.isAdmin;
    }
    return userOrAdminOrRole.role === "admin" || MEMBER_DELETE_ENABLED;
  }
  if (userOrAdminOrRole === "admin") return true;
  return MEMBER_DELETE_ENABLED;
}

/**
 * Permanent deletion is strictly restricted to admin.
 */
export function canUserPermanentDelete(userOrAdminOrRole?: { isAdmin?: boolean; role?: string } | boolean | string | null): boolean {
  if (typeof userOrAdminOrRole === "boolean") return userOrAdminOrRole;
  if (userOrAdminOrRole && typeof userOrAdminOrRole === "object") {
    if (typeof userOrAdminOrRole.isAdmin === "boolean") {
      return userOrAdminOrRole.isAdmin;
    }
    return userOrAdminOrRole.role === "admin";
  }
  return userOrAdminOrRole === "admin";
}
