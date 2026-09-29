import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import { shopGoodwill } from "../src/client.js";
import { AuthenticationError, ForbiddenError } from "../src/errors.js";

const subtle = (webcrypto as unknown as { subtle: SubtleCrypto }).subtle;

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(handler: (call: RecordedCall) => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    }
    let body: unknown = undefined;
    if (typeof init?.body === "string" && init.body.length) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenWithExp(secondsFromNow: number, extra: Record<string, unknown> = {}): string {
  const payload = {
    ...extra,
    exp: Math.floor(Date.now() / 1000) + secondsFromNow,
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

test("search hits /Search/ItemListing and normalises fields", async () => {
  const { fetch, calls } = makeFetch(() =>
    jsonResponse(200, {
      searchResults: [
        {
          itemId: 111,
          title: "Item A",
          currentPrice: 5,
          endTime: "2026-09-27T00:00:00",
        },
      ],
      hitCount: 1,
    }),
  );
  const client = shopGoodwill({
    fetch,
    throttle: { minIntervalMs: 0, concurrency: 4 },
  });
  const page = await client.search.items({ query: "tools" });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.match(call.url, /\/Search\/ItemListing$/);
  assert.equal(call.method, "POST");
  assert.equal((call.body as { searchText: string }).searchText, "tools");
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]!.itemId, 111);
  assert.equal(page.items[0]!.title, "Item A");
  assert.equal(page.items[0]!.currentPrice, 5);
  assert.ok(page.items[0]!.endsAt.getTime() > 0);
});

test("iterate paginates until hasNextPage is false", async () => {
  let page = 0;
  const { fetch } = makeFetch(() => {
    page++;
    if (page === 1) {
      return jsonResponse(200, {
        searchResults: [{ itemId: 1, title: "a", currentPrice: 1, endTime: "2030-01-01T00:00:00" }],
        hitCount: 2,
      });
    }
    return jsonResponse(200, {
      searchResults: [{ itemId: 2, title: "b", currentPrice: 2, endTime: "2030-01-01T00:00:00" }],
      hitCount: 2,
    });
  });
  const client = shopGoodwill({ fetch, throttle: { minIntervalMs: 0, concurrency: 4 } });
  const collected: number[] = [];
  for await (const item of client.search.iterate({ pageSize: 1 })) {
    collected.push(item.itemId);
  }
  assert.deepEqual(collected, [1, 2]);
});

test("authenticated call sends Bearer header and never a Cookie header", async () => {
  const token = tokenWithExp(3600, { sub: "user" });
  const { fetch, calls } = makeFetch((call) => {
    assert.ok(!Object.keys(call.headers).some((h) => h.toLowerCase() === "cookie"));
    return jsonResponse(200, { success: true, currentPrice: 45, isHighBidder: true });
  });
  const client = shopGoodwill({
    fetch,
    auth: { type: "token", token },
    throttle: { minIntervalMs: 0, concurrency: 4 },
  });
  const result = await client.bids.place({ itemId: 123, amount: 45 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.currentPrice, 45);
    assert.equal(result.highBidder, true);
  }
  const bidCall = calls.find((c) => c.url.endsWith("/ItemBid/PlaceBid"))!;
  assert.equal(bidCall.headers["authorization"], `Bearer ${token}`);
});

test("bids.place returns a discriminated failure on 200 with success=false", async () => {
  const token = tokenWithExp(3600);
  const { fetch } = makeFetch(() =>
    jsonResponse(200, {
      success: false,
      message: "You have been outbid by another user",
    }),
  );
  const client = shopGoodwill({
    fetch,
    auth: { type: "token", token },
    throttle: { minIntervalMs: 0, concurrency: 4 },
  });
  const result = await client.bids.place({ itemId: 5, amount: 10 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "outbid");
    assert.match(result.message, /outbid/i);
  }
});

test("403 responses raise ForbiddenError with the cookie-bug hint", async () => {
  const token = tokenWithExp(3600);
  const { fetch } = makeFetch(() => new Response("", { status: 403 }));
  const client = shopGoodwill({
    fetch,
    auth: { type: "token", token },
    throttle: { minIntervalMs: 0, concurrency: 4 },
    retry: { attempts: 1 },
  });
  await assert.rejects(
    () => client.bids.place({ itemId: 1, amount: 1 }),
    (err: unknown) =>
      err instanceof ForbiddenError && /cookie bug/i.test((err as Error).message),
  );
});

test("authenticated call without a token throws AuthenticationError", async () => {
  const { fetch } = makeFetch(() => jsonResponse(200, { success: true }));
  const client = shopGoodwill({ fetch });
  // @ts-expect-error — .bids is typed away on the anonymous variant.
  await assert.rejects(() => client.bids.place({ itemId: 1, amount: 1 }), AuthenticationError);
});

test("login encrypts credentials and stores the returned token", async () => {
  const returnedToken = tokenWithExp(3600, { sub: "abc" });
  const { fetch, calls } = makeFetch((call) => {
    if (call.url.endsWith("/SignIn/Login")) {
      assert.equal(call.method, "POST");
      const body = call.body as Record<string, unknown>;
      assert.ok(typeof body["userName"] === "string" && (body["userName"] as string).length > 0);
      assert.ok(typeof body["password"] === "string" && (body["password"] as string).length > 0);
      // Encrypted values must not equal the plaintext (obfuscation smoke test).
      assert.notEqual(body["userName"], "alice");
      assert.notEqual(body["password"], "hunter2");
      return jsonResponse(200, { accessToken: returnedToken });
    }
    return jsonResponse(200, { success: true });
  });

  const client = shopGoodwill({
    fetch,
    cipher: (await import("../src/cipher.js")).createCipher({ subtle }),
    throttle: { minIntervalMs: 0, concurrency: 4 },
  });
  const authed = await client.login({ username: "alice", password: "hunter2" });
  const token = authed.getToken();
  assert.equal(token?.token, returnedToken);
  assert.equal(token?.claims["sub"], "abc");
  assert.ok(calls.some((c) => c.url.endsWith("/SignIn/Login")));
});

test("shipping.calculate posts item + zip and parses the HTML response", async () => {
  const html =
    "<p>Estimated Shipping and Handling:</p>" +
    "<p>Shipped From: Oregon, OH 43616</p>" +
    "<p>Shipping Carrier: FedEx<p>Address:   20500 US</p>" +
    "<p>Shipping: <span id='shipping-span'>$8.50 (GROUND_HOME_DELIVERY)</span></p>" +
    "<p>Handling: $2.00</p>" +
    "<p><b>Total Shipping and Handling: $10.50</b></p>";
  const { fetch, calls } = makeFetch(
    () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
  );
  const client = shopGoodwill({ fetch, throttle: { minIntervalMs: 0, concurrency: 4 } });
  const q = await client.shipping.calculate({ itemId: 123, zipCode: "20500" });
  assert.equal(q.shipping, 8.5);
  assert.equal(q.handling, 2);
  assert.equal(q.total, 10.5);
  assert.equal(q.carrier, "FedEx");
  assert.equal(q.method, "GROUND_HOME_DELIVERY");
  const call = calls[0]!;
  assert.match(call.url, /CalculateShipping$/);
  const body = call.body as Record<string, unknown>;
  assert.equal(body["itemId"], 123);
  assert.equal(body["zipCode"], "20500");
  assert.equal(body["country"], "US");
});

test("retries retriable 5xx before giving up", async () => {
  let attempts = 0;
  const { fetch } = makeFetch(() => {
    attempts++;
    if (attempts < 3) return new Response("", { status: 503 });
    return jsonResponse(200, { searchResults: [], hitCount: 0 });
  });
  const client = shopGoodwill({
    fetch,
    throttle: { minIntervalMs: 0, concurrency: 4 },
    retry: { attempts: 3, baseDelayMs: 1 },
  });
  const page = await client.search.items();
  assert.equal(attempts, 3);
  assert.equal(page.items.length, 0);
});
