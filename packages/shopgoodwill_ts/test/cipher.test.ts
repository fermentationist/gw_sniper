import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import { createCipher } from "../src/cipher.js";

const subtle = (webcrypto as unknown as { subtle: SubtleCrypto }).subtle;

test("cipher produces URL-encoded, base64-encoded ciphertext", async () => {
  const cipher = createCipher({ subtle });
  const out = await cipher.encrypt("hello");
  assert.ok(out.length > 0, "output non-empty");
  // Should be URL-encoded — the base64 padding "=" turns into %3D.
  const decoded = decodeURIComponent(out);
  assert.match(decoded, /^[A-Za-z0-9+/=]+$/, "decoded value is base64");
});

test("cipher round-trips against a known plaintext deterministically", async () => {
  // With a static key/IV, AES-CBC is deterministic — same plaintext must
  // produce the same ciphertext every run. This is why the site uses it as
  // obfuscation, not security, and why we can pin an expected value.
  const cipher = createCipher({ subtle });
  const a = await cipher.encrypt("username@example.com");
  const b = await cipher.encrypt("username@example.com");
  assert.equal(a, b, "deterministic output for identical input");
});

test("cipher rejects bad hex key length", () => {
  assert.throws(() => createCipher({ subtle, key: "AABB" }), /16-byte key/);
});

test("cipher rejects bad hex IV length", () => {
  assert.throws(() => createCipher({ subtle, iv: "AABB" }), /16-byte IV/);
});

test("cipher rejects odd-length hex", () => {
  assert.throws(
    () => createCipher({ subtle, key: "AAA" }),
    /even length/,
  );
});

test("cipher output can be decrypted back with the same key/IV", async () => {
  // Sanity: prove that our encoding path is symmetric with a Node-side decrypt.
  const cipher = createCipher({ subtle });
  const plaintext = "hunter2";
  const encoded = await cipher.encrypt(plaintext);
  const b64 = decodeURIComponent(encoded);
  const ciphertext = Buffer.from(b64, "base64");
  const keyBytes = Buffer.from("6696D2E6F042FEC4D6E3F32AD541143B", "hex");
  const key = await subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const plainBuf = await subtle.decrypt(
    { name: "AES-CBC", iv: new Uint8Array(16) },
    key,
    ciphertext,
  );
  assert.equal(new TextDecoder().decode(plainBuf), plaintext);
});
