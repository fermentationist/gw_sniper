import type { Transport } from "./http.js";
import type {
  Listing,
  RequestOptions,
  SearchOptions,
  SearchPage,
  SearchRequestBody,
  SearchSort,
} from "./types.js";

/** Empty-but-server-accepted defaults. Verified against the site's Advanced Search UI. */
export const DEFAULT_SEARCH_BODY: SearchRequestBody = {
  isSize: false,
  isWeddingCatagory: "false",
  isMultipleCategoryIds: false,
  isFromHomePage: false,
  searchText: "",
  selectedGroup: "",
  selectedCategoryIds: "",
  selectedSellerIds: "",
  lowPrice: "0",
  highPrice: "999999",
  searchBuyNowOnly: "",
  searchPickupOnly: "false",
  searchNoPickupOnly: "false",
  searchOneCentShippingOnly: false,
  searchDescriptions: "false",
  searchClosedAuctions: "false",
  closedAuctionEndingDate: "1/1/1",
  closedAuctionDaysBack: "7",
  savedSearchId: 0,
  sortColumn: "1",
  page: "1",
  pageSize: "40",
  sortDescending: "false",
  savedSearchName: "",
  useBuyerPrefs: "true",
  searchUSOnlyType: "1",
  categoryLevelNo: "1",
  categoryLevel: 1,
  categoryId: 0,
  partNumber: "",
  catIds: "",
};

const SORT_COLUMN: Record<SearchSort, { column: string; descending: boolean }> = {
  "ending-soonest": { column: "1", descending: false },
  "newly-listed": { column: "2", descending: true },
  "price-asc": { column: "3", descending: false },
  "price-desc": { column: "3", descending: true },
  "most-bids": { column: "4", descending: true },
};

export function buildSearchBody(options: SearchOptions = {}): SearchRequestBody {
  const body: SearchRequestBody = { ...DEFAULT_SEARCH_BODY };
  if (options.query !== undefined) body.searchText = options.query;
  if (options.categoryId !== undefined) {
    body.categoryId = options.categoryId;
    body.selectedCategoryIds = String(options.categoryId);
    body.catIds = String(options.categoryId);
  }
  if (options.oneCentShippingOnly !== undefined) {
    body.searchOneCentShippingOnly = options.oneCentShippingOnly;
  }
  if (options.page !== undefined) body.page = String(options.page);
  if (options.pageSize !== undefined) body.pageSize = String(options.pageSize);
  if (options.sort !== undefined) {
    const mapping = SORT_COLUMN[options.sort];
    body.sortColumn = mapping.column;
    body.sortDescending = String(mapping.descending);
  }
  if (options.sortDescending !== undefined) {
    body.sortDescending = String(options.sortDescending);
  }
  if (options.minPrice !== undefined) body.lowPrice = String(options.minPrice);
  if (options.maxPrice !== undefined) body.highPrice = String(options.maxPrice);
  if (options.sellerId !== undefined) {
    body.selectedSellerIds = String(options.sellerId);
  }
  if (options.closedAuctions !== undefined) {
    body.searchClosedAuctions = String(options.closedAuctions);
  }
  if (options.raw) Object.assign(body, options.raw);
  return body;
}

function parseEndsAt(raw: string): Date {
  // Site emits ISO-like strings without a Z suffix. Interpret as UTC.
  const trimmed = raw.trim();
  if (!trimmed) return new Date(NaN);
  const withZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? trimmed
    : `${trimmed}Z`;
  return new Date(withZone);
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length) return v;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function normalizeListing(raw: Record<string, unknown>): Listing {
  const itemId = pickNumber(raw, "itemId", "itemid", "id") ?? -1;
  const title = pickString(raw, "title", "itemTitle", "name") ?? "";
  const currentPrice =
    pickNumber(raw, "currentPrice", "current_price", "minimumBid", "startPrice") ?? 0;
  const endsAtRaw = pickString(raw, "endTime", "endsAt", "endDate") ?? "";
  return {
    itemId,
    title,
    currentPrice,
    endsAt: parseEndsAt(endsAtRaw),
    endsAtRaw,
    bidCount: pickNumber(raw, "bidCount", "numBids", "bids"),
    imageUrl: pickString(raw, "imageUrl", "imageURL", "image", "imageServer"),
    sellerName: pickString(raw, "sellerName", "seller"),
    raw,
  };
}

export interface SearchApi {
  items(options?: SearchOptions, req?: RequestOptions): Promise<SearchPage>;
  iterate(
    options?: SearchOptions,
    req?: RequestOptions & { maxPages?: number; maxItems?: number },
  ): AsyncIterableIterator<Listing>;
  pages(
    options?: SearchOptions,
    req?: RequestOptions & { maxPages?: number },
  ): AsyncIterableIterator<SearchPage>;
}

export function createSearchApi(transport: Transport): SearchApi {
  async function fetchPage(
    options: SearchOptions,
    req: RequestOptions | undefined,
  ): Promise<SearchPage> {
    const body = buildSearchBody(options);
    const raw = await transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/Search/ItemListing",
      body,
      options: req,
    });
    const itemsRaw = Array.isArray(raw["searchResults"])
      ? (raw["searchResults"] as unknown[])
      : Array.isArray(raw["items"])
        ? (raw["items"] as unknown[])
        : [];
    const items = itemsRaw
      .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
      .map(normalizeListing);
    const resultCount =
      pickNumber(raw, "resultCount", "result_count", "totalItems", "hitCount") ??
      items.length;
    const page = Number(body.page);
    const pageSize = Number(body.pageSize);
    const hasNextPage = page * pageSize < resultCount;
    return { items, resultCount, page, pageSize, hasNextPage };
  }

  async function* pages(
    options: SearchOptions = {},
    req: (RequestOptions & { maxPages?: number }) | undefined = undefined,
  ): AsyncIterableIterator<SearchPage> {
    const maxPages = req?.maxPages ?? Infinity;
    let page = options.page ?? 1;
    let emitted = 0;
    while (emitted < maxPages) {
      const p = await fetchPage({ ...options, page }, req);
      yield p;
      emitted++;
      if (!p.hasNextPage || p.items.length === 0) return;
      page++;
    }
  }

  async function* iterate(
    options: SearchOptions = {},
    req:
      | (RequestOptions & { maxPages?: number; maxItems?: number })
      | undefined = undefined,
  ): AsyncIterableIterator<Listing> {
    const maxItems = req?.maxItems ?? Infinity;
    let yielded = 0;
    for await (const p of pages(options, req)) {
      for (const item of p.items) {
        if (yielded >= maxItems) return;
        yield item;
        yielded++;
      }
    }
  }

  return {
    items: (options = {}, req) => fetchPage(options, req),
    iterate,
    pages,
  };
}
