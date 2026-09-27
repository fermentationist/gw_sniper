/**
 * AES-128-CBC obfuscation for the login endpoint. Static key/IV lifted from
 * the site's front-end bundle — this is obfuscation, not security.
 *
 * The output binary is base64-encoded and then URL-encoded before being
 * placed into the JSON string payload (yes, on top of JSON escaping; the
 * front-end really does encodeURIComponent the base64 value).
 */

export interface CredentialCipher {
  encrypt(plaintext: string): Promise<string>;
}

const DEFAULT_KEY_HEX = "6696D2E6F042FEC4D6E3F32AD541143B";
const DEFAULT_IV_HEX = "00000000000000000000000000000000";

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string must have even length, got ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex byte at position ${i * 2}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

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
  const keyBytes = hexToBytes(params.key ?? DEFAULT_KEY_HEX);
  const ivBytes = hexToBytes(params.iv ?? DEFAULT_IV_HEX);

  if (keyBytes.length !== 16) {
    throw new Error(`AES-128 requires a 16-byte key, got ${keyBytes.length}`);
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
      const encoded = new TextEncoder().encode(plaintext);
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
