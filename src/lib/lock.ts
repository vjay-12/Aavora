import { get, set, del } from "idb-keyval";

const LOCK_VERIFIER_KEY = "aavora_device_lock_verifier";
const LOCK_SALT_KEY = "aavora_device_lock_salt";
const WEBAUTHN_CREDENTIAL_ID_KEY = "aavora_webauthn_cred_id";
const AUTO_LOCK_TIMEOUT_KEY = "aavora_auto_lock_timeout_mins";

// Helper to convert buffer to hex and base64
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

// Derive PBKDF2 hash for pin/password
export async function deriveKeyAndHash(
  pin: string,
  saltBytes?: Uint8Array
): Promise<{ salt: string; hash: string; rawKey: CryptoKey }> {
  const enc = new TextEncoder();
  const salt = saltBytes || window.crypto.getRandomValues(new Uint8Array(16));

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveKey", "deriveBits"]
  );

  // Derive AES-GCM key for offline local encryption
  const rawKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  // Derive verifier hash
  const verifierBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    256
  );

  return {
    salt: buf2hex(salt.buffer as ArrayBuffer),
    hash: buf2hex(verifierBits),
    rawKey,
  };
}

// Check if device lock is configured
export async function isDeviceLockConfigured(): Promise<boolean> {
  const verifier = await get<string>(LOCK_VERIFIER_KEY);
  return !!verifier;
}

// Setup or change local app password
export async function setupDeviceLock(pin: string): Promise<boolean> {
  const { salt, hash } = await deriveKeyAndHash(pin);
  await set(LOCK_SALT_KEY, salt);
  await set(LOCK_VERIFIER_KEY, hash);
  return true;
}

// Verify entered password
export async function verifyDevicePassword(pin: string): Promise<boolean> {
  const savedSaltHex = await get<string>(LOCK_SALT_KEY);
  const savedHashHex = await get<string>(LOCK_VERIFIER_KEY);

  if (!savedSaltHex || !savedHashHex) return false;

  const saltBytes = hex2buf(savedSaltHex);
  const { hash } = await deriveKeyAndHash(pin, saltBytes);

  return hash === savedHashHex;
}

// WebAuthn Biometric Support (Windows Hello / Fingerprint / FaceID)
export async function isBiometricsAvailable(): Promise<boolean> {
  if (
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
  ) {
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }
  return false;
}

export async function isBiometricsRegistered(): Promise<boolean> {
  const credId = await get<string>(WEBAUTHN_CREDENTIAL_ID_KEY);
  return !!credId;
}

export async function registerBiometric(userName = "Aavora User"): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;

  try {
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const userId = window.crypto.getRandomValues(new Uint8Array(16));

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "Aavora Cloud Vault",
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "preferred",
          residentKey: "preferred",
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    if (credential && credential.id) {
      await set(WEBAUTHN_CREDENTIAL_ID_KEY, credential.id);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("WebAuthn registration error or user cancelled:", err);
    return false;
  }
}

export async function verifyBiometric(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  const credentialIdStr = await get<string>(WEBAUTHN_CREDENTIAL_ID_KEY);
  if (!credentialIdStr) return false;

  try {
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        userVerification: "preferred",
        timeout: 60000,
      },
    });

    return !!assertion;
  } catch (err) {
    console.warn("Biometric verification failed or cancelled:", err);
    return false;
  }
}

// Auto-lock settings
export async function getAutoLockTimeoutMinutes(): Promise<number> {
  const timeout = await get<number>(AUTO_LOCK_TIMEOUT_KEY);
  return timeout ?? 5; // Default 5 mins
}

export async function setAutoLockTimeoutMinutes(minutes: number): Promise<void> {
  await set(AUTO_LOCK_TIMEOUT_KEY, minutes);
}

// Reset/Wipe device lock (Used on Google re-auth or lock reset)
export async function resetDeviceLock(): Promise<void> {
  await del(LOCK_VERIFIER_KEY);
  await del(LOCK_SALT_KEY);
  await del(WEBAUTHN_CREDENTIAL_ID_KEY);
}
