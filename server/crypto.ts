import crypto from "crypto";
import { getEnv } from "./env.js";

/**
 * Derives a 32-byte Buffer from a secret string.
 * Handles 64-char hex, 32-byte raw utf-8, or SHA-256 hash.
 */
function derive32ByteKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  if (Buffer.byteLength(trimmed, "utf8") === 32) {
    return Buffer.from(trimmed, "utf8");
  }
  return crypto.createHash("sha256").update(trimmed).digest();
}

/**
 * Returns the primary encryption key.
 * Prioritizes the dedicated, stable ENCRYPTION_KEY env var (32 bytes).
 * If ENCRYPTION_KEY is not set, falls back to legacy derivation from COOKIE_SECRET/SESSION_SECRET.
 */
export function getPrimaryEncryptionKey(): Buffer {
  const env = getEnv();
  const dedicated = (process.env.ENCRYPTION_KEY || env.ENCRYPTION_KEY || "").trim();
  if (dedicated) {
    return derive32ByteKey(dedicated);
  }
  // Legacy derivation: SHA-256 of (COOKIE_SECRET || SESSION_SECRET)
  const legacySecret = (process.env.COOKIE_SECRET || env.SESSION_SECRET).trim();
  return crypto.createHash("sha256").update(legacySecret).digest();
}

interface CandidateKey {
  key: Buffer;
  isFallback: boolean;
  name: string;
}

/**
 * Returns candidate encryption keys in order of preference.
 * Enables zero-downtime rotation from legacy keys to dedicated ENCRYPTION_KEY.
 */
function getCandidateKeys(): CandidateKey[] {
  const env = getEnv();
  const candidates: CandidateKey[] = [];
  const seenHex = new Set<string>();

  const addCandidate = (key: Buffer, isFallback: boolean, name: string) => {
    const hex = key.toString("hex");
    if (!seenHex.has(hex)) {
      seenHex.add(hex);
      candidates.push({ key, isFallback, name });
    }
  };

  const dedicated = (process.env.ENCRYPTION_KEY || env.ENCRYPTION_KEY || "").trim();
  if (dedicated) {
    // 1. Primary: dedicated ENCRYPTION_KEY derived as 32-byte key
    addCandidate(derive32ByteKey(dedicated), false, "ENCRYPTION_KEY");
    // Also include pure sha256 of dedicated if direct buffer was used
    addCandidate(crypto.createHash("sha256").update(dedicated).digest(), false, "ENCRYPTION_KEY_SHA256");

    // 2. Fallbacks: legacy derivation for existing tokens
    const legacyCombined = (process.env.COOKIE_SECRET || env.SESSION_SECRET).trim();
    if (legacyCombined) {
      addCandidate(crypto.createHash("sha256").update(legacyCombined).digest(), true, "LEGACY_COOKIE_OR_SESSION");
    }
    if (env.SESSION_SECRET) {
      addCandidate(crypto.createHash("sha256").update(env.SESSION_SECRET.trim()).digest(), true, "LEGACY_SESSION_SECRET");
    }
    if (process.env.COOKIE_SECRET) {
      addCandidate(crypto.createHash("sha256").update(process.env.COOKIE_SECRET.trim()).digest(), true, "LEGACY_COOKIE_SECRET");
    }
  } else {
    // If ENCRYPTION_KEY is not yet configured, legacy is primary
    const legacyCombined = (process.env.COOKIE_SECRET || env.SESSION_SECRET).trim();
    if (legacyCombined) {
      addCandidate(crypto.createHash("sha256").update(legacyCombined).digest(), false, "LEGACY_COOKIE_OR_SESSION");
    }
    if (env.SESSION_SECRET) {
      addCandidate(crypto.createHash("sha256").update(env.SESSION_SECRET.trim()).digest(), false, "LEGACY_SESSION_SECRET");
    }
  }

  return candidates;
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 * Output format: ivHex:tagHex:encryptedHex
 */
export function encryptSecret(plainText: string, customKey?: Buffer): string {
  const key = customKey || getPrimaryEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export interface DecryptResult {
  plainText: string;
  usedFallback: boolean;
  keyName: string;
}

/**
 * Decrypts an AES-256-GCM encrypted secret with automatic fallback to legacy keys.
 * Reports whether a fallback key was used so the caller can re-encrypt with the new primary key.
 */
export function decryptSecretWithFallback(cipherText: string): DecryptResult {
  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid cipher text format");
  }
  const [ivHex, tagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const candidates = getCandidateKeys();
  let lastErr: any = null;

  for (const candidate of candidates) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", candidate.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = decipher.update(encrypted) + decipher.final("utf8");
      return {
        plainText: decrypted,
        usedFallback: candidate.isFallback,
        keyName: candidate.name,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  const decryptError = new Error("Decryption failed: Unable to authenticate or decrypt data with configured encryption keys");
  (decryptError as any).code = "DECRYPT_FAILED";
  (decryptError as any).cause = lastErr;
  throw decryptError;
}

/**
 * Decrypts an AES-256-GCM encrypted secret.
 */
export function decryptSecret(cipherText: string): string {
  return decryptSecretWithFallback(cipherText).plainText;
}
