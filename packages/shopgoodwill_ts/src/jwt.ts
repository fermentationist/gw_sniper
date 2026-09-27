/**
 * JWT decode-only helper. Does NOT verify signatures — the server did that.
 * We only need `exp` and any convenient claims exposed to callers.
 */

export interface DecodedJwt {
  claims: Record<string, unknown>;
  expiresAt: Date | undefined;
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "====".slice(input.length % 4);
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length < 2) {
    return { claims: {}, expiresAt: undefined };
  }
  const payloadPart = parts[1];
  if (!payloadPart) return { claims: {}, expiresAt: undefined };

  let claims: Record<string, unknown> = {};
  try {
    const decoded = JSON.parse(base64UrlDecode(payloadPart));
    if (decoded && typeof decoded === "object") {
      claims = decoded as Record<string, unknown>;
    }
  } catch {
    return { claims: {}, expiresAt: undefined };
  }

  let expiresAt: Date | undefined;
  const exp = claims["exp"];
  if (typeof exp === "number" && Number.isFinite(exp)) {
    expiresAt = new Date(exp * 1000);
  }
  return { claims, expiresAt };
}
