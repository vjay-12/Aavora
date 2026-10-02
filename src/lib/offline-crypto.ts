import { get, set, del, keys } from "idb-keyval";

const OFFLINE_DEVICE_KEY = "aavora_offline_device_master_key";
const OFFLINE_FILE_PREFIX = "aavora_offline_file_";
const OFFLINE_META_PREFIX = "aavora_offline_meta_";

export interface OfflineFileMeta {
  driveId: string;
  name: string;
  mimeType: string;
  size: number;
  savedAt: string;
  ivHex: string;
}

// Get or generate local device-bound AES-GCM key for offline vault
async function getDeviceEncryptionKey(): Promise<CryptoKey> {
  const exported = await get<JsonWebKey>(OFFLINE_DEVICE_KEY);
  if (exported) {
    return await window.crypto.subtle.importKey(
      "jwk",
      exported,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  }

  const newKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const jwk = await window.crypto.subtle.exportKey("jwk", newKey);
  await set(OFFLINE_DEVICE_KEY, jwk);

  return newKey;
}

function buf2hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function hex2buf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Encrypt file and save to IndexedDB
export async function saveFileOffline(
  driveId: string,
  name: string,
  mimeType: string,
  arrayBuffer: ArrayBuffer
): Promise<void> {
  const key = await getDeviceEncryptionKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit standard AES-GCM IV

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as any },
    key,
    arrayBuffer
  );

  const meta: OfflineFileMeta = {
    driveId,
    name,
    mimeType,
    size: arrayBuffer.byteLength,
    savedAt: new Date().toISOString(),
    ivHex: buf2hex(iv.buffer as ArrayBuffer),
  };

  await set(`${OFFLINE_META_PREFIX}${driveId}`, meta);
  await set(`${OFFLINE_FILE_PREFIX}${driveId}`, ciphertext);
}

// Decrypt file from IndexedDB
export async function getOfflineFile(
  driveId: string
): Promise<{ meta: OfflineFileMeta; blob: Blob } | null> {
  const meta = await get<OfflineFileMeta>(`${OFFLINE_META_PREFIX}${driveId}`);
  const ciphertext = await get<ArrayBuffer>(`${OFFLINE_FILE_PREFIX}${driveId}`);

  if (!meta || !ciphertext) return null;

  try {
    const key = await getDeviceEncryptionKey();
    const iv = hex2buf(meta.ivHex);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as any },
      key,
      ciphertext
    );

    const blob = new Blob([decrypted], { type: meta.mimeType });
    return { meta, blob };
  } catch (err) {
    console.error("Failed to decrypt offline file:", err);
    return null;
  }
}

// Check if a file is saved offline
export async function isFileOffline(driveId: string): Promise<boolean> {
  const meta = await get<OfflineFileMeta>(`${OFFLINE_META_PREFIX}${driveId}`);
  return !!meta;
}

// List all offline files
export async function listOfflineFiles(): Promise<OfflineFileMeta[]> {
  const allKeys = await keys();
  const metaKeys = allKeys.filter((k) =>
    k.toString().startsWith(OFFLINE_META_PREFIX)
  );
  const results: OfflineFileMeta[] = [];

  for (const k of metaKeys) {
    const meta = await get<OfflineFileMeta>(k);
    if (meta) results.push(meta);
  }

  return results.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
  );
}

// Remove an offline file
export async function removeOfflineFile(driveId: string): Promise<void> {
  await del(`${OFFLINE_META_PREFIX}${driveId}`);
  await del(`${OFFLINE_FILE_PREFIX}${driveId}`);
}

// Wipe all offline files and master key (On logout or forgot password)
export async function wipeOfflineStorage(): Promise<void> {
  const allKeys = await keys();
  for (const k of allKeys) {
    const kStr = k.toString();
    if (
      kStr.startsWith(OFFLINE_META_PREFIX) ||
      kStr.startsWith(OFFLINE_FILE_PREFIX) ||
      kStr === OFFLINE_DEVICE_KEY
    ) {
      await del(k);
    }
  }
}
