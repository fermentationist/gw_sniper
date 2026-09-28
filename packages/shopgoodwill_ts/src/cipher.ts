/**
 * AES-256-CBC obfuscation for the login/refresh endpoints. Key and IV are
 * static parameters hardcoded in the site's main.js bundle, and are used as
 * UTF-8 byte strings (not hex-decoded): the key string happens to look like
 * hex but is treated as 32 ASCII bytes → AES-256 key size; the IV is 16 ASCII
 * '0' characters (0x30 each), not 16 zero bytes.
 *
 * The ciphertext is base64-encoded then URL-encoded before being placed into
 * the JSON string payload (yes, on top of JSON escaping).
 */

export interface CredentialCipher {
  encrypt(plaintext: string): Promise<string>;
}

const DEFAULT_KEY_UTF8 = "6696D2E6F042FEC4D6E3F32AD541143B";
const DEFAULT_IV_UTF8 = "0000000000000000";

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function createCipher(params: {
  key?: string;
  iv?: string;
  subtle?: SubtleCrypto;
} = {}): CredentialCipher {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(params.key ?? DEFAULT_KEY_UTF8);
  const ivBytes = encoder.encode(params.iv ?? DEFAULT_IV_UTF8);

  if (keyBytes.length !== 16 && keyBytes.length !== 24 && keyBytes.length !== 32) {
    throw new Error(
      `AES key must be 16, 24, or 32 bytes; got ${keyBytes.length}`,
    );
  }
  if (ivBytes.length !== 16) {
    throw new Error(`AES-CBC requires a 16-byte IV, got ${ivBytes.length}`);
  }

  const subtle = params.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "WebCrypto SubtleCrypto is unavailable. Node 18+ or a modern browser is required.",
    );
  }

  let cachedKey: CryptoKey | undefined;
  const getKey = async (): Promise<CryptoKey> => {
    if (cachedKey) return cachedKey;
    cachedKey = await subtle.importKey(
      "raw",
      keyBytes as BufferSource,
      { name: "AES-CBC" },
      false,
      ["encrypt"],
    );
    return cachedKey;
  };

  return {
    async encrypt(plaintext: string): Promise<string> {
      const key = await getKey();
      const encoded = encoder.encode(plaintext);
      const cipherBuffer = await subtle.encrypt(
        { name: "AES-CBC", iv: ivBytes as BufferSource },
        key,
        encoded as BufferSource,
      );
      const base64 = bytesToBase64(new Uint8Array(cipherBuffer));
      return encodeURIComponent(base64);
    },
  };
}
