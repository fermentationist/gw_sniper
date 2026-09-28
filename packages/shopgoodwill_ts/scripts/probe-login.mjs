#!/usr/bin/env node
/**
 * Probe /SignIn/Login to answer two questions:
 *   1. Does `remember: true` produce a longer-lived JWT than `remember: false`?
 *   2. Does the login response include a refresh token or a session cookie
 *      that could be persisted instead of the password?
 *
 * Runs the login twice (once per remember value) and prints, for each:
 *   - HTTP status
 *   - All response headers (including any Set-Cookie)
 *   - The full JSON body
 *   - The decoded JWT claims + computed TTL
 *
 * The output contains live bearer tokens for your account. Read it locally,
 * do not paste it anywhere public.
 *
 * Usage:
 *   # inline env
 *   GW_USERNAME=you GW_PASSWORD=pw node scripts/probe-login.mjs
 *
 *   # or via a .env file at the package or repo root:
 *   pnpm --filter shopgoodwill-client probe:login
 *   (the npm script uses `node --env-file-if-exists=.env --env-file-if-exists=../../.env`)
 */

const BASE_URL = "https://buyerapi.shopgoodwill.com/api";
// Captured 2026-09-27 from live browser login — the stale
// "00099a1be3bb023ff17d" was causing "incorrect username or password".
const APP_VERSION = "918356f8354624fa";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
// Both are used as UTF-8 byte strings (NOT hex-decoded). Key is 32 bytes →
// AES-256-CBC. IV is 16 bytes of ASCII '0' (0x30). Extracted from the site's
// main.js bundle 2026-09-27 — the client library still uses the older
// AES-128 interpretation and needs to be updated.
const CIPHER_KEY_UTF8 = "6696D2E6F042FEC4D6E3F32AD541143B";
const CIPHER_IV_UTF8 = "0000000000000000";

const username = process.env.GW_USERNAME;
const password = process.env.GW_PASSWORD;
if (!username || !password) {
  console.error("GW_USERNAME and GW_PASSWORD env vars are required");
  process.exit(1);
}

async function obfuscate(plain) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(CIPHER_KEY_UTF8),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode(CIPHER_IV_UTF8) },
    key,
    new TextEncoder().encode(plain),
  );
  const b64 = Buffer.from(new Uint8Array(encrypted)).toString("base64");
  return encodeURIComponent(b64);
}

function decodeJwtClaims(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  const pad = payload.length % 4 === 0 ? "" : "====".slice(payload.length % 4);
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractToken(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.accessToken === "string") return payload.accessToken;
  if (typeof payload.token === "string") return payload.token;
  const data = payload.data;
  if (
    data &&
    typeof data === "object" &&
    typeof data.accessToken === "string"
  ) {
    return data.accessToken;
  }
  return null;
}

async function probe(remember) {
  const body = {
    userName: await obfuscate(username),
    password: await obfuscate(password),
    remember,
    appVersion: APP_VERSION,
    browser: USER_AGENT.toLowerCase(),
  };

  const res = await fetch(`${BASE_URL}/SignIn/Login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = rawText;
  }

  console.log(`\n── remember: ${remember} ──────────────────────────`);
  console.log(`HTTP ${res.status} ${res.statusText}`);

  console.log("\nResponse headers:");
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    console.log("\nSet-Cookie entries:");
    for (const c of setCookie) console.log(`  ${c}`);
  }

  console.log("\nResponse body:");
  console.log(
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
  );

  const token = extractToken(payload);
  if (!token) {
    console.log("\nNo bearer token field detected in response.");
    return;
  }
  const claims = decodeJwtClaims(token);
  if (claims?.exp) {
    const now = Math.floor(Date.now() / 1000);
    const ttlSec = claims.exp - now;
    console.log(
      `\nJWT exp: ${new Date(claims.exp * 1000).toISOString()}` +
        `   TTL ≈ ${ttlSec}s (${(ttlSec / 3600).toFixed(2)} h / ${(ttlSec / 86400).toFixed(2)} d)`,
    );
  } else {
    console.log("\nJWT has no `exp` claim.");
  }
  console.log("\nAll JWT claims:");
  console.log(JSON.stringify(claims, null, 2));

  // Look for anything that smells like a refresh mechanism
  const suspects = ["refreshToken", "refresh_token", "renewToken", "sessionId"];
  const hits = suspects.filter(
    (k) => payload && typeof payload === "object" && k in payload,
  );
  if (hits.length) {
    console.log(
      `\nPossible refresh-mechanism fields present: ${hits.join(", ")}`,
    );
  } else {
    console.log("\nNo refreshToken-shaped fields found at top level of body.");
  }
}

await probe(false);
await probe(true);
