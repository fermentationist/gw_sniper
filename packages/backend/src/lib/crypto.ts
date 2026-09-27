import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../env.js";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SCRYPT_SALT = "gw-sniper:v1";

const derivedKey = scryptSync(env.APP_SECRET, SCRYPT_SALT, KEY_LENGTH);

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// Session cookie signing — separate HMAC key derived from APP_SECRET.
const cookieHmacKey = scryptSync(env.APP_SECRET, "gw-sniper:cookie", KEY_LENGTH);

export function signSessionToken(payload: string): string {
  const mac = createHmac("sha256", cookieHmacKey).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifySessionToken(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = createHmac("sha256", cookieHmacKey)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return payload;
}

export function verifyAppPassword(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.APP_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
