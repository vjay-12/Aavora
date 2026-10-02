/**
 * User formatting & display rules for Aavora.
 *
 * Rules:
 * - Greeting: "Good morning / Good afternoon / Good evening, <given_name>" (first name only).
 * - Full name: Google profile name or manual admin name.
 * - Fallback: Email prefix with the first letter capitalised (e.g. vhrbaskaran -> Vhrbaskaran).
 * - User card: Full name with role below and Google picture as avatar (fallback to initials).
 */

export interface UserLike {
  name?: string | null;
  givenName?: string | null;
  email?: string | null;
  picture?: string | null;
  role?: string | null;
}

/**
 * Returns the email prefix (the portion before @) or a fallback string.
 */
export function getEmailPrefix(email?: string | null): string {
  if (!email || !email.includes("@")) return (email || "").trim();
  return email.split("@")[0].trim();
}

/**
 * Capitalises the first letter of the email prefix.
 * e.g. "vhrbaskaran@gmail.com" -> "Vhrbaskaran"
 */
export function getEmailFallback(email?: string | null): string {
  const prefix = getEmailPrefix(email);
  if (!prefix) return "User";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/**
 * Returns the user's first/given name only.
 * Priority:
 * 1. user.givenName if present and non-empty.
 * 2. First word of user.name (if not purely an uncapitalized email prefix).
 * 3. Fallback: Email prefix with first letter capitalized.
 */
export function getUserGivenName(user?: UserLike | null): string {
  if (!user) return "User";

  const given = (user.givenName || "").trim();
  if (given) return given;

  const emailPrefix = getEmailPrefix(user.email).toLowerCase();
  const rawName = (user.name || "").trim();

  if (rawName) {
    const firstWord = rawName.split(/\s+/)[0];
    // If the name is just the uncapitalized email prefix, capitalize it properly
    if (firstWord.toLowerCase() === emailPrefix) {
      return getEmailFallback(user.email);
    }
    return firstWord;
  }

  return getEmailFallback(user.email);
}

/**
 * Returns the user's full display name.
 * Priority:
 * 1. user.name if present and non-empty (capitalized if matching raw email prefix).
 * 2. Fallback: Email prefix with first letter capitalized.
 */
export function getUserFullName(user?: UserLike | null): string {
  if (!user) return "User";

  const rawName = (user.name || "").trim();
  const emailPrefix = getEmailPrefix(user.email).toLowerCase();

  if (rawName) {
    if (rawName.toLowerCase() === emailPrefix) {
      return getEmailFallback(user.email);
    }
    return rawName;
  }

  return getEmailFallback(user.email);
}

/**
 * Returns 1-2 uppercase initials for avatar fallback.
 * e.g. "Vijay Hr Baskaran" -> "VB"
 *      "Vijay" -> "VI"
 *      "vhrbaskaran@example.com" -> "VH"
 */
export function getUserInitials(name?: string | null, email?: string | null): string {
  const fullName = getUserFullName({ name, email });
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const firstInitial = parts[0][0] || "";
    const lastInitial = parts[parts.length - 1][0] || "";
    return (firstInitial + lastInitial).toUpperCase();
  }

  if (parts.length === 1 && parts[0].length > 0) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return "U";
}

/**
 * Returns time-aware greeting prefix:
 * - 05:00 - 11:59: "Good morning"
 * - 12:00 - 16:59: "Good afternoon"
 * - 17:00 - 04:59: "Good evening"
 */
export function getTimeGreeting(date: Date = new Date()): string {
  const hours = date.getHours();
  if (hours >= 5 && hours < 12) {
    return "Good morning";
  }
  if (hours >= 12 && hours < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

/**
 * Returns complete time-aware greeting with given name:
 * e.g. "Good morning, Vijay" or "Good evening, Vhrbaskaran"
 */
export function getGreeting(user?: UserLike | null, date: Date = new Date()): string {
  const timeGreeting = getTimeGreeting(date);
  const givenName = getUserGivenName(user);
  return `${timeGreeting}, ${givenName}`;
}
