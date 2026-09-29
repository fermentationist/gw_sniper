/**
 * Integration tests — hit the live shopgoodwill.com buyer API.
 *
 * Opt-in via env: `RUN_INTEGRATION=1 pnpm test:integration`
 * Skipped by default so `pnpm test` stays offline / hermetic.
 *
 * Only exercises unauthenticated endpoints (search, items, shipping).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { shopGoodwill } from "../../src/index.js";

const RUN = process.env["RUN_INTEGRATION"] === "1";
const skipReason = RUN ? undefined : "set RUN_INTEGRATION=1 to run";

// Small delay between test blocks so we're polite to the API.
const client = shopGoodwill({
  throttle: { minIntervalMs: 500, concurrency: 1 },
  logger: {
    debug: (msg, meta) => console.debug("[sgw]", msg, meta ?? ""),
    warn: (msg, meta) => console.warn("[sgw]", msg, meta ?? ""),
  },
});

test("search: broad common query returns results", { skip: skipReason }, async () => {
  const page = await client.search.items({ query: "shirt", pageSize: 10 });
  console.log(
    `[search] query="shirt" -> ${page.items.length}/${page.resultCount} items, hasNextPage=${page.hasNextPage}`,
  );
  if (page.items[0]) {
    console.log("[search] first item:", {
      id: page.items[0].itemId,
      title: page.items[0].title,
      price: page.items[0].currentPrice,
      endsAt: page.items[0].endsAtRaw,
    });
  }
  assert.ok(page.resultCount > 0, "expected > 0 results for 'shirt'");
  assert.ok(page.items.length > 0, "expected at least one listing on the first page");
  const first = page.items[0]!;
  assert.ok(first.itemId > 0, "itemId should be a positive number");
  assert.ok(first.title.length > 0, "title should be non-empty");
  assert.ok(Number.isFinite(first.currentPrice), "currentPrice should parse");
  assert.ok(!Number.isNaN(first.endsAt.getTime()), "endsAt should parse");
});

test("search: empty query returns the default listing", { skip: skipReason }, async () => {
  const page = await client.search.items({ pageSize: 5 });
  console.log(
    `[search] empty query -> ${page.items.length}/${page.resultCount} items`,
  );
  assert.ok(page.resultCount > 0, "empty search should still return items");
});

test("search: pagination yields disjoint item sets", { skip: skipReason }, async () => {
  const p1 = await client.search.items({ query: "vintage", pageSize: 5, page: 1 });
  const p2 = await client.search.items({ query: "vintage", pageSize: 5, page: 2 });
  console.log(
    `[search] page1=${p1.items.length} page2=${p2.items.length} total=${p1.resultCount}`,
  );
  if (p2.items.length === 0) {
    // Small result set — skip disjointness assertion.
    console.log("[search] page 2 empty; skipping disjointness check");
    return;
  }
  const ids1 = new Set(p1.items.map((i) => i.itemId));
  const overlap = p2.items.filter((i) => ids1.has(i.itemId));
  assert.equal(
    overlap.length,
    0,
    `pages should not share items (found ${overlap.length} overlap)`,
  );
});

test("search: sort=newly-listed returns items", { skip: skipReason }, async () => {
  // This is what the searchRunner uses in the backend — check it works.
  const page = await client.search.items({
    query: "book",
    sort: "newly-listed",
    pageSize: 10,
  });
  console.log(
    `[search] sort=newly-listed query="book" -> ${page.items.length}/${page.resultCount}`,
  );
  assert.ok(
    page.items.length > 0,
    "newly-listed sort should return items for 'book'",
  );
});

test(
  "items.get: fetch detail for a live search hit",
  { skip: skipReason },
  async () => {
    const page = await client.search.items({ query: "shirt", pageSize: 5 });
    const seed = page.items[0];
    if (!seed) {
      assert.fail("no seed item available for items.get test");
    }
    const detail = await client.items.get(seed.itemId);
    console.log("[items.get]", {
      id: detail.itemId,
      title: detail.title,
      price: detail.currentPrice,
      endsAt: detail.endsAtRaw,
      minimumBid: detail.minimumBid,
      description: detail.description?.slice(0, 60),
    });
    assert.equal(detail.itemId, seed.itemId, "itemId should round-trip");
    assert.ok(detail.title.length > 0, "detail title should be non-empty");
    assert.ok(Number.isFinite(detail.currentPrice), "detail currentPrice should parse");
  },
);

test(
  "items.bidHistory: returns an array for a live item",
  { skip: skipReason },
  async () => {
    const page = await client.search.items({ query: "shirt", pageSize: 5 });
    const seed = page.items[0];
    if (!seed) {
      assert.fail("no seed item available for bidHistory test");
    }
    const history = await client.items.bidHistory(seed.itemId);
    console.log(
      `[items.bidHistory] item=${seed.itemId} -> ${history.length} bid(s)`,
    );
    assert.ok(Array.isArray(history), "bidHistory should return an array");
    for (const entry of history) {
      assert.ok(typeof entry.bidder === "string", "bidder should be a string");
      assert.ok(Number.isFinite(entry.amount), "amount should be a number");
    }
  },
);

test(
  "shipping.calculate: fetch a quote for a live item",
  { skip: skipReason },
  async () => {
    const page = await client.search.items({ query: "shirt", pageSize: 5 });
    const seed = page.items[0];
    if (!seed) {
      assert.fail("no seed item available for shipping.calculate test");
    }
    const quote = await client.shipping.calculate({
      itemId: seed.itemId,
      zipCode: "10001",
    });
    console.log("[shipping.calculate]", {
      itemId: seed.itemId,
      shipping: quote.shipping,
      handling: quote.handling,
      total: quote.total,
      carrier: quote.carrier,
      method: quote.method,
    });
    assert.ok(Number.isFinite(quote.shipping), "shipping should parse");
    assert.ok(Number.isFinite(quote.handling), "handling should parse");
    assert.ok(Number.isFinite(quote.total), "total should parse");
  },
);
