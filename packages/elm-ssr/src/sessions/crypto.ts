// HMAC-SHA256 helpers used by the session middleware to sign cookie values.
// Stays in the WebCrypto API so it runs unchanged on Cloudflare Workers + Bun.

const textEncoder = new TextEncoder();

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

const toBase64Url = (bytes: Uint8Array | ArrayBuffer): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.byteLength; i += 1) {
    binary += String.fromCharCode(view[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (encoded: string): Uint8Array => {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

// crypto.subtle.sign wants a BufferSource backed by an ArrayBuffer specifically
// (not SharedArrayBuffer) under the strict DOM lib. Copy into a fresh one.
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
};

/** HMAC-sign a string, returning `value.signature` (both URL-safe Base64). */
export const signValue = async (secret: string, value: string): Promise<string> => {
  const key = await importKey(secret);
  const valueBytes = textEncoder.encode(value);
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(valueBytes));
  return `${toBase64Url(valueBytes)}.${toBase64Url(signature)}`;
};

/** Verify a signed value. Returns the original string or `null` on tamper/mismatch. */
export const verifyValue = async (secret: string, signed: string): Promise<string | null> => {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const encodedValue = signed.slice(0, dot);
  const encodedSignature = signed.slice(dot + 1);
  let valueBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    valueBytes = fromBase64Url(encodedValue);
    signatureBytes = fromBase64Url(encodedSignature);
  } catch {
    return null;
  }
  const key = await importKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(valueBytes)));
  if (!constantTimeEqual(expected, signatureBytes)) {
    return null;
  }
  return new TextDecoder().decode(valueBytes);
};

/** Generate a new opaque session id (UUID v4 via WebCrypto). */
export const generateSessionId = (): string => crypto.randomUUID();

/** Generate a 32-byte random CSRF token, URL-safe Base64. */
export const generateCsrfToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};
