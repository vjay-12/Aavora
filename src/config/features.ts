/**
 * Shared Feature Flags & Access Control
 * Used by BOTH the server and the client.
 *
 * To re-enable member delete later, change MEMBER_DELETE_ENABLED from false to true on line 8.
 */
export const MEMBER_DELETE_ENABLED = false;

export const DELETE_RESTRICTED_CODE = "DELETE_RESTRICTED";
export const DELETE_RESTRICTED_MESSAGE = "Only the admin can delete files right now.";

/**
 * Single source of truth for whether a user role can perform delete/trash/restore/bin operations.
 * - 'admin' is always permitted.
 * - 'member' is governed strictly by MEMBER_DELETE_ENABLED.
 */
export function canUserDelete(role?: string | null): boolean {
  if (role === "admin") return true;
  return MEMBER_DELETE_ENABLED;
}

/**
 * Permanent deletion is strictly restricted to admin.
 */
export function canUserPermanentDelete(role?: string | null): boolean {
  return role === "admin";
}
