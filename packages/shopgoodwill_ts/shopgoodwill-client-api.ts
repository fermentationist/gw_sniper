/**
 * shopgoodwill-client — public API surface (design sketch)
 *
 * Types and signatures only. Targets Node 18+ / Bun / Deno (browser is a
 * non-goal: CORS will block buyerapi.shopgoodwill.com). Zero runtime deps;
 * AES via WebCrypto (`globalThis.crypto.subtle`), not `node:crypto`.
 */

// ───────────────────────────────────────────────────────── construction

export type AuthConfig =
  | {
      type: "token";
      token: string;
      /** Called whenever the token is replaced (refresh, re-auth). */
      onToken?: (token: TokenInfo) => void | Promise<void>;
    }
  | {
      type: "password";
      username: string;
      password: string;
      /** Skip the initial login if you already have a live token. */
      initialToken?: string;
      onToken?: (token: TokenInfo) => void | Promise<void>;
    };

export interface TokenInfo {
  token: string;
  /** Parsed from the JWT `exp` claim. Not verified — decode only. */
  expiresAt?: Date;
  /** Whatever else the payload carried. */
  claims: Record<string, unknown>;
}

export interface ClientOptions<
  TAuth extends AuthConfig | undefined = undefined,
> {
  auth?: TAuth;

  /** @default 'https://buyerapi.shopgoodwill.com/api' */
  baseUrl?: string;

  /**
   * Front-end build hash sent on login. Rotates without notice — override
   * when login starts failing rather than waiting for a release.
   * @default a known-good value, see CHANGELOG
   */
  appVersion?: string;

  /** @default a current desktop Firefox UA string */
  userAgent?: string;

  /** @default '0.0.0.4' — spoofed; the API does not appear to validate it. */
  clientIpAddress?: string;

  /**
   * Injected for tests. NOTE: must not carry a cookie jar — cookies from this
   * domain cause spurious 403s on consecutive authenticated calls.
   */
  fetch?: typeof globalThis.fetch;

  /** Swap out if the site rotates its static AES key/IV. */
  cipher?: CredentialCipher;

  throttle?: ThrottleOptions;
  retry?: RetryOptions;
  /** @default 30_000 */
  timeoutMs?: number;
  /** Response-shape checking. @default 'warn' */
  validate?: "strict" | "warn" | "off";
  logger?: Logger;
  /** Injectable for deterministic tests. @default Date.now */
  now?: () => number;
}

export interface ThrottleOptions {
  /** Minimum gap between requests. @default 250 */
  minIntervalMs?: number;
  /** Max in flight. @default 2 */
  concurrency?: number;
}

export interface RetryOptions {
  /** @default 3 */
  attempts?: number;
  /** @default 500 */
  baseDelayMs?: number;
  /** @default [429, 500, 502, 503, 504] */
  retryOn?: number[];
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/** Overloads exist so auth state is inferred from the options object. */
export declare function shopGoodwill(
  options?: ClientOptions<undefined>,
): ShopGoodwillClient<"anonymous">;
export declare function shopGoodwill(
  options: ClientOptions<AuthConfig>,
): ShopGoodwillClient<"authenticated">;

// ───────────────────────────────────────────────────────── the client

export type AuthState = "anonymous" | "authenticated";

/** Present only when S is 'authenticated'; otherwise the property is absent. */
type WhenAuthed<S extends AuthState, T> = S extends "authenticated" ? T : never;

export declare class ShopGoodwillClient<S extends AuthState = "anonymous"> {
  readonly search: SearchApi;
  readonly items: ItemsApi;
  readonly shipping: ShippingApi;

  readonly bids: WhenAuthed<S, BidsApi>;
  readonly watchlist: WhenAuthed<S, WatchlistApi>;

  /** Encrypts credentials internally. Returns a new, narrower handle over the
   *  same transport — the original stays usable and stays anonymous. */
  login(credentials: {
    username: string;
    password: string;
    remember?: boolean;
  }): Promise<ShopGoodwillClient<"authenticated">>;

  /** Adopt a token you persisted elsewhere. */
  withToken(token: string): ShopGoodwillClient<"authenticated">;

  getToken(): TokenInfo | undefined;
  logout(): void;

  /**
   * Difference between the server's `Date` header and local time, updated on
   * every response. Snipers need this; nothing else should.
   */
  readonly serverTimeOffsetMs: number;

  /** Escape hatch for endpoints this library hasn't modelled yet. */
  request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    init?: {
      body?: unknown;
      query?: Record<string, string | number>;
    } & RequestOptions,
  ): Promise<T>;

  /** Logging, caching, recording fixtures. Applied in registration order. */
  use(middleware: Middleware): this;
}

export type Middleware = (
  req: Request,
  next: (req: Request) => Promise<Response>,
) => Promise<Response>;

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Bypass the shared throttle for time-critical calls (i.e. a bid). */
  priority?: "normal" | "high";
}

// ───────────────────────────────────────────────────────── search

export interface SearchApi {
  /** One page. */
  items(options?: SearchOptions, req?: RequestOptions): Promise<SearchPage>;

  /** Flattened async iteration across pages, throttle-aware. */
  iterate(
    options?: SearchOptions,
    req?: RequestOptions & { maxPages?: number; maxItems?: number },
  ): AsyncIterableIterator<Listing>;

  /** Same, but yields whole pages if you need `resultCount` per step. */
  pages(
    options?: SearchOptions,
    req?: RequestOptions & { maxPages?: number },
  ): AsyncIterableIterator<SearchPage>;
}

/**
 * Friendly subset. Anything not modelled here goes through `raw`, which is
 * shallow-merged over DEFAULT_SEARCH_BODY last.
 */
export interface SearchOptions {
  /** Wrap in double quotes for the site's phrase-match behaviour. */
  query?: string;
  categoryId?: number;
  oneCentShippingOnly?: boolean;
  /** 1-based. @default 1 */
  page?: number;
  /** @default 40 */
  pageSize?: number;
  sort?: SearchSort;

  /** Unverified — confirm against live traffic before relying on these. */
  minPrice?: number;
  maxPrice?: number;
  sellerId?: number;
  closedAuctions?: boolean;

  raw?: Partial<SearchRequestBody>;
}

export type SearchSort =
  | "ending-soonest"
  | "newly-listed"
  | "price-asc"
  | "price-desc"
  | "most-bids";

/** The full wire object. Most fields are required by the server even when empty. */
export interface SearchRequestBody {
  searchText: string;
  searchOneCentShippingOnly: boolean;
  category: number;
  page: number;
  pageSize: number;
  [key: string]: unknown;
}

export declare const DEFAULT_SEARCH_BODY: SearchRequestBody;

/** Pure, exported, and unit-testable. Diff its output against DevTools. */
export declare function buildSearchBody(
  options?: SearchOptions,
): SearchRequestBody;

export interface SearchPage {
  items: Listing[];
  resultCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

// ───────────────────────────────────────────────────────── models

/**
 * Normalised field names (the API is inconsistent: `itemid` here, `itemId`
 * there). Everything unmodelled survives on `raw`.
 */
export interface Listing {
  itemId: number;
  title: string;
  currentPrice: number;
  /** Parsed. Timezone handling is UNVERIFIED — compare against `raw` once. */
  endsAt: Date;
  endsAtRaw: string;
  bidCount?: number;
  imageUrl?: string;
  sellerName?: string;
  readonly raw: Record<string, unknown>;
}

export interface ItemDetail extends Listing {
  description?: string;
  /** Shipping/handling structure for multi-item lots is unconfirmed. */
  handlingFee?: number;
  weightLbs?: number;
  minimumBid?: number;
  readonly raw: Record<string, unknown>;
}

export interface ItemsApi {
  get(itemId: number, req?: RequestOptions): Promise<ItemDetail>;
  /** Unverified endpoint — may return an empty array rather than 404. */
  bidHistory(itemId: number, req?: RequestOptions): Promise<BidHistoryEntry[]>;
}

export interface BidHistoryEntry {
  bidder: string;
  amount: number;
  placedAt: Date;
  readonly raw: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────── shipping

export interface ShippingApi {
  quote(
    params: { itemId: number | string; zipCode: string },
    req?: RequestOptions,
  ): Promise<ShippingQuote>;
}

export interface ShippingQuote {
  shipping: number;
  handling: number;
  total: number;
  readonly raw: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────── bidding

export interface BidsApi {
  /**
   * Resolves with a discriminated result. Being outbid or arriving late are
   * expected outcomes, not exceptions — only transport/auth failures throw.
   * Do not infer success from HTTP 200; the body is authoritative.
   */
  place(
    params: { itemId: number; amount: number },
    req?: RequestOptions,
  ): Promise<BidResult>;
}

export type BidResult =
  | {
      ok: true;
      itemId: number;
      amount: number;
      currentPrice?: number;
      highBidder: boolean;
      raw: Record<string, unknown>;
    }
  | {
      ok: false;
      itemId: number;
      reason: BidFailureReason;
      message: string;
      raw: Record<string, unknown>;
    };

export type BidFailureReason =
  | "outbid"
  | "below-minimum"
  | "auction-ended"
  | "account-restricted"
  | "unknown";

// ───────────────────────────────────────────────────────── watchlist

/**
 * The 500-char note field is the site's only writable per-item storage, so
 * tools stuff JSON in it. Make that first-class instead of leaving callers to
 * JSON.parse a string that might be freeform text.
 */
export interface NoteCodec<T> {
  parse(raw: string): T | undefined;
  serialize(value: T): string;
}

export declare function jsonNoteCodec<T>(): NoteCodec<T>;

export interface WatchlistEntry<TNote = string> {
  watchlistId: number;
  itemId: number;
  title: string;
  currentPrice: number;
  endsAt: Date;
  /** Decoded via the codec if one was supplied, else the raw string. */
  note: TNote | undefined;
  noteRaw: string;
  readonly raw: Record<string, unknown>;
}

export interface WatchlistApi {
  list<TNote = string>(
    options?: { notes?: NoteCodec<TNote> } & RequestOptions,
  ): Promise<WatchlistEntry<TNote>[]>;

  add<TNote = string>(
    params: { itemId: number; note?: TNote },
    options?: { notes?: NoteCodec<TNote> } & RequestOptions,
  ): Promise<WatchlistEntry<TNote>>;

  setNote<TNote = string>(
    params: { watchlistId: number; note: TNote },
    options?: { notes?: NoteCodec<TNote> } & RequestOptions,
  ): Promise<void>;

  remove(params: { watchlistId: number }, req?: RequestOptions): Promise<void>;
}

// ───────────────────────────────────────────────────────── errors

export declare class ShopGoodwillError extends Error {
  readonly path: string;
  readonly status?: number;
  readonly responseBody?: unknown;
}

/** 401, or login rejected. Credentials are never included on the error. */
export declare class AuthenticationError extends ShopGoodwillError {}

/** 403. Almost always the cookie bug — message says so explicitly. */
export declare class ForbiddenError extends ShopGoodwillError {}

export declare class RateLimitError extends ShopGoodwillError {
  readonly retryAfterMs?: number;
}

/** Response didn't match the modelled shape and validate === 'strict'. */
export declare class ResponseShapeError extends ShopGoodwillError {
  readonly issues: string[];
}

export declare function isShopGoodwillError(e: unknown): e is ShopGoodwillError;

// ───────────────────────────────────────────────────────── cipher

/**
 * AES-128-CBC with a static key/IV lifted from the site's bundle. This is
 * obfuscation, not security — it protects nothing. Exported so you can patch
 * a key rotation without a release, and so it's testable in isolation.
 */
export interface CredentialCipher {
  encrypt(plaintext: string): Promise<string>;
}

export declare function createCipher(params: {
  /** Hex. @default '6696D2E6F042FEC4D6E3F32AD541143B' */
  key?: string;
  /** Hex. @default all zeroes */
  iv?: string;
}): CredentialCipher;

// ───────────────────────────────────────────────────────── usage

/*
import { shopGoodwill, jsonNoteCodec } from 'shopgoodwill-client';

// anonymous
const sgw = shopGoodwill({ throttle: { minIntervalMs: 400 } });

for await (const item of sgw.search.iterate(
  { query: '"vintage pyrex"', oneCentShippingOnly: true, sort: 'ending-soonest' },
  { maxItems: 200 },
)) {
  console.log(item.itemId, item.title, item.currentPrice, item.endsAt);
}

// sgw.bids  →  ts(2339): Property 'bids' does not exist

// authenticated, with token persistence
const auth = shopGoodwill({
  auth: {
    type: 'password',
    username: process.env.SGW_USER!,
    password: process.env.SGW_PASS!,
    initialToken: await loadToken(),
    onToken: (t) => saveToken(t.token),
  },
});

const watched = await auth.watchlist.list({ notes: jsonNoteCodec<{ maxBid: number }>() });

for (const entry of watched) {
  if (!entry.note) continue;
  if (entry.currentPrice >= entry.note.maxBid) continue;

  const result = await auth.bids.place(
    { itemId: entry.itemId, amount: entry.note.maxBid },
    { priority: 'high' },
  );

  if (!result.ok) console.warn(`${entry.itemId}: ${result.reason} — ${result.message}`);
}
*/
