// crypto.js — all encryption happens locally via the browser's Web Crypto API.
// Nothing here ever touches the network.

const PBKDF2_ITERATIONS = 250000;

function toBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;
}

async function deriveKey(password, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true, // extractable, so we can cache the raw key for a timed unlock session
    ["encrypt", "decrypt"]
  );
}

function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

async function encryptJSON(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  return { iv: toBase64(iv), data: toBase64(ciphertext) };
}

async function decryptJSON(key, payload) {
  const iv = new Uint8Array(fromBase64(payload.iv));
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    fromBase64(payload.data)
  );
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

async function exportRawKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64(raw);
}

async function importRawKey(b64) {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(b64),
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}
