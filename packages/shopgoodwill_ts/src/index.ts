export { shopGoodwill, DEFAULT_APP_VERSION } from "./client.js";
export type { ShopGoodwillClient } from "./client.js";

export { createCipher } from "./cipher.js";
export type { CredentialCipher } from "./cipher.js";

export { decodeJwt } from "./jwt.js";
export type { DecodedJwt } from "./jwt.js";

export { jsonNoteCodec, stringNoteCodec } from "./notes.js";
export type { NoteCodec } from "./notes.js";

export { DEFAULT_SEARCH_BODY, buildSearchBody } from "./search.js";
export type { SearchApi } from "./search.js";

export type { ItemsApi } from "./items.js";
export type { ShippingApi } from "./shipping.js";
export type { BidsApi } from "./bids.js";
export type { WatchlistApi } from "./watchlist.js";

export {
  ShopGoodwillError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  ResponseShapeError,
  isShopGoodwillError,
} from "./errors.js";

export type {
  AuthConfig,
  AuthState,
  BidFailureReason,
  BidHistoryEntry,
  BidResult,
  ClientOptions,
  ItemDetail,
  Listing,
  Logger,
  RequestOptions,
  RetryOptions,
  SearchOptions,
  SearchPage,
  SearchRequestBody,
  SearchSort,
  ShippingQuote,
  ThrottleOptions,
  TokenInfo,
  WatchlistEntry,
} from "./types.js";
