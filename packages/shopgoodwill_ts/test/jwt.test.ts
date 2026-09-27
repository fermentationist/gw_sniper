import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeJwt } from "../src/jwt.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

test("decodes exp into a Date", () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { claims, expiresAt } = decodeJwt(makeJwt({ sub: "42", exp }));
  assert.equal(claims["sub"], "42");
  assert.ok(expiresAt instanceof Date);
  assert.equal(expiresAt!.getTime(), exp * 1000);
});

test("returns empty on garbage input rather than throwing", () => {
  const { claims, expiresAt } = decodeJwt("not.a.jwt");
  assert.deepEqual(claims, {});
  assert.equal(expiresAt, undefined);
});

test("returns empty on totally malformed input", () => {
  const { claims, expiresAt } = decodeJwt("garbage");
  assert.deepEqual(claims, {});
  assert.equal(expiresAt, undefined);
});

test("handles base64url with no padding", () => {
  const payload = { foo: "bar" };
  const b64url = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const token = `hdr.${b64url}.sig`;
  const { claims } = decodeJwt(token);
  assert.equal(claims["foo"], "bar");
});
