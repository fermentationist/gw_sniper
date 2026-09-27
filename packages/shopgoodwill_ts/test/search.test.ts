import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SEARCH_BODY, buildSearchBody } from "../src/search.js";

test("buildSearchBody returns defaults when called empty", () => {
  const body = buildSearchBody();
  assert.deepEqual(body, DEFAULT_SEARCH_BODY);
  // Returns a fresh copy — not the module-level constant.
  assert.notEqual(body, DEFAULT_SEARCH_BODY);
});

test("buildSearchBody maps friendly options onto wire fields", () => {
  const body = buildSearchBody({
    query: '"vintage pyrex"',
    categoryId: 42,
    oneCentShippingOnly: true,
    page: 3,
    pageSize: 60,
    minPrice: 5,
    maxPrice: 100,
    sellerId: 999,
    closedAuctions: true,
    sort: "price-desc",
  });
  assert.equal(body.searchText, '"vintage pyrex"');
  assert.equal(body.categoryId, 42);
  assert.equal(body.selectedCategoryIds, "42");
  assert.equal(body.catIds, "42");
  assert.equal(body.searchOneCentShippingOnly, true);
  assert.equal(body.page, "3");
  assert.equal(body.pageSize, "60");
  assert.equal(body.lowPrice, "5");
  assert.equal(body.highPrice, "100");
  assert.equal(body.selectedSellerIds, "999");
  assert.equal(body.searchClosedAuctions, "true");
  assert.equal(body.sortColumn, "3");
  assert.equal(body.sortDescending, "true");
});

test("buildSearchBody applies raw override last", () => {
  const body = buildSearchBody({
    query: "shoes",
    raw: { searchText: "hijacked", customField: "yes" },
  });
  assert.equal(body.searchText, "hijacked");
  assert.equal(body.customField, "yes");
});

test("sort=ending-soonest is ascending, sort=newly-listed is descending", () => {
  const a = buildSearchBody({ sort: "ending-soonest" });
  assert.equal(a.sortColumn, "1");
  assert.equal(a.sortDescending, "false");
  const b = buildSearchBody({ sort: "newly-listed" });
  assert.equal(b.sortColumn, "2");
  assert.equal(b.sortDescending, "true");
});
