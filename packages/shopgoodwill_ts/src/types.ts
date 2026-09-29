import type { CredentialCipher } from "./cipher.js";

export type AuthState = "anonymous" | "authenticated";

export type WhenAuthed<S extends AuthState, T> = S extends "authenticated"
  ? T
  : never;

/**
 * Refresh-token metadata returned alongside the access token by /SignIn/Login
 * (and echoed by /SignIn/RefreshToken). The `createdByIp` value must be sent
 * back verbatim on refresh — the server binds refresh tokens to it.
 */
export interface RefreshTokenInfo {
  token: string;
  expiresAt: Date;
  createdByIp: string;
}

export interface TokenInfo {
  token: string;
  /** Parsed from the JWT `exp` claim. Not verified — decode only. */
  expiresAt: Date | undefined;
  claims: Record<string, unknown>;
  /** Present when auth came from a login or a prior refresh. */
  refresh?: RefreshTokenInfo;
}

export type AuthConfig =
  | {
      type: "token";
      token: string;
      /**
       * If provided, an expired access token will be renewed via
       * /SignIn/RefreshToken instead of throwing.
       */
      refresh?: RefreshTokenInfo;
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

export interface ClientOptions<
  TAuth extends AuthConfig | undefined = undefined,
> {
  auth?: TAuth;
  /** @default 'https://buyerapi.shopgoodwill.com/api' */
  baseUrl?: string;
  /**
   * Front-end build hash sent on login. Rotates without notice — override
   * when login starts failing.
   */
  appVersion?: string;
  userAgent?: string;
  /** Spoofed; the API does not appear to validate it. */
  clientIpAddress?: string;
  /**
   * Injected for tests. NOTE: must not carry a cookie jar — cookies from this
   * domain cause spurious 403s on consecutive authenticated calls.
   */
  fetch?: typeof globalThis.fetch;
  cipher?: CredentialCipher;
  throttle?: ThrottleOptions;
  retry?: RetryOptions;
  /** @default 30_000 */
  timeoutMs?: number;
  logger?: Logger;
  /** Injectable for deterministic tests. @default Date.now */
  now?: () => number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Bypass the shared throttle for time-critical calls (i.e. a bid). */
  priority?: "normal" | "high";
}

// ─── search ─────────────────────────────────────────────────────────────────

export type SearchSort =
  | "ending-soonest"
  | "newly-listed"
  | "price-asc"
  | "price-desc"
  | "most-bids";

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
  sortDescending?: boolean;

  /** Unverified — confirm against live traffic before relying on these. */
  minPrice?: number;
  maxPrice?: number;
  sellerId?: number;
  closedAuctions?: boolean;

  /** Shallow-merged over the built body last; use for unmodelled fields. */
  raw?: Partial<SearchRequestBody>;
}

export interface SearchRequestBody {
  isSize: boolean;
  isWeddingCatagory: string;
  isMultipleCategoryIds: boolean;
  isFromHomePage: boolean;
  searchText: string;
  selectedGroup: string;
  selectedCategoryIds: string;
  selectedSellerIds: string;
  lowPrice: string;
  highPrice: string;
  searchBuyNowOnly: string;
  searchPickupOnly: string;
  searchNoPickupOnly: string;
  searchOneCentShippingOnly: boolean;
  searchDescriptions: string;
  searchClosedAuctions: string;
  closedAuctionEndingDate: string;
  closedAuctionDaysBack: string;
  savedSearchId: number;
  sortColumn: string;
  page: string;
  pageSize: string;
  sortDescending: string;
  savedSearchName: string;
  useBuyerPrefs: string;
  searchUSOnlyType: string;
  categoryLevelNo: string;
  categoryLevel: number;
  categoryId: number;
  partNumber: string;
  catIds: string;
  [key: string]: unknown;
}

export interface Listing {
  itemId: number;
  title: string;
  currentPrice: number;
  /** Parsed. Site returns times without a Z suffix; treated as UTC. */
  endsAt: Date;
  endsAtRaw: string;
  bidCount: number | undefined;
  imageUrl: string | undefined;
  sellerName: string | undefined;
  readonly raw: Record<string, unknown>;
}

export interface SearchPage {
  items: Listing[];
  resultCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

// ─── items ──────────────────────────────────────────────────────────────────

export interface ShippingAddress {
  shippingAddressId: number | undefined;
  name: string | undefined;
  street: string | undefined;
  city: string | undefined;
  state: string | undefined;
  country: string | undefined;
  countryCode: string | undefined;
  zip: string | undefined;
  readonly raw: Record<string, unknown>;
}

export interface ItemDetail extends Listing {
  description: string | undefined;
  /** Flat handling fee always applied. */
  handlingPrice: number | undefined;
  /** Flat shipping. 0 when {@link allowShippingCalculation} is true — call the shipping API for a real quote. */
  shippingPrice: number | undefined;
  /** True when shipping must be calculated against a destination address. */
  allowShippingCalculation: boolean;
  weightLbs: number | undefined;
  minimumBid: number | undefined;
  /** The current user's ShopGoodwill address book (only populated when authenticated). */
  buyerShippingAddresses: ShippingAddress[];
}

export interface BidHistoryEntry {
  bidder: string;
  amount: number;
  placedAt: Date;
  readonly raw: Record<string, unknown>;
}

// ─── shipping ───────────────────────────────────────────────────────────────

export interface ShippingQuote {
  shipping: number;
  handling: number;
  total: number;
  /** e.g. "FedEx" — best-effort parse from the HTML response. */
  carrier: string | undefined;
  /** e.g. "GROUND_HOME_DELIVERY" — best-effort parse. */
  method: string | undefined;
  /** Raw HTML the site returned (kept for debugging / future re-parsing). */
  readonly rawHtml: string;
}

// ─── bidding ────────────────────────────────────────────────────────────────

export type BidFailureReason =
  | "outbid"
  | "below-minimum"
  | "auction-ended"
  | "account-restricted"
  | "unknown";

export type BidResult =
  | {
      ok: true;
      itemId: number;
      amount: number;
      currentPrice: number | undefined;
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

// ─── watchlist ──────────────────────────────────────────────────────────────

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
