import { createBidsApi, type BidsApi } from "./bids.js";
import { createCipher, type CredentialCipher } from "./cipher.js";
import { AuthenticationError, ShopGoodwillError } from "./errors.js";
import { DEFAULT_BASE_URL, DEFAULT_USER_AGENT, Transport } from "./http.js";
import { createItemsApi, type ItemsApi } from "./items.js";
import { createSearchApi, type SearchApi } from "./search.js";
import { createShippingApi, type ShippingApi } from "./shipping.js";
import { decodeJwt } from "./jwt.js";
import type {
  AuthConfig,
  AuthState,
  ClientOptions,
  Logger,
  RequestOptions,
  RetryOptions,
  ThrottleOptions,
  TokenInfo,
  WhenAuthed,
} from "./types.js";
import { createWatchlistApi, type WatchlistApi } from "./watchlist.js";

/**
 * @default a known-good front-end build hash. Overridable via
 * `ClientOptions.appVersion` when it rotates.
 */
export const DEFAULT_APP_VERSION = "00099a1be3bb023ff17d";

interface Internal {
  cipher: CredentialCipher;
  transport: Transport;
  token: TokenInfo | undefined;
  auth: AuthConfig | undefined;
  appVersion: string;
  clientIpAddress: string;
  userAgent: string;
  logger: Logger | undefined;
  now: () => number;
  loginInFlight: Promise<TokenInfo> | undefined;
}

export interface ShopGoodwillClient<S extends AuthState = "anonymous"> {
  readonly search: SearchApi;
  readonly items: ItemsApi;
  readonly shipping: ShippingApi;

  readonly bids: WhenAuthed<S, BidsApi>;
  readonly watchlist: WhenAuthed<S, WatchlistApi>;

  login(credentials: {
    username: string;
    password: string;
    remember?: boolean;
  }): Promise<ShopGoodwillClient<"authenticated">>;

  withToken(token: string): ShopGoodwillClient<"authenticated">;
  getToken(): TokenInfo | undefined;
  logout(): void;

  request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    init?: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      auth?: boolean;
    } & RequestOptions,
  ): Promise<T>;
}

const DEFAULT_THROTTLE: Required<ThrottleOptions> = {
  minIntervalMs: 250,
  concurrency: 2,
};

const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 500,
  retryOn: [429, 500, 502, 503, 504],
};

export function shopGoodwill(
  options?: ClientOptions<undefined>,
): ShopGoodwillClient<"anonymous">;
export function shopGoodwill(
  options: ClientOptions<AuthConfig>,
): ShopGoodwillClient<"authenticated">;
export function shopGoodwill(
  options: ClientOptions<AuthConfig | undefined> = {},
): ShopGoodwillClient<AuthState> {
  const state: Internal = {
    cipher: options.cipher ?? createCipher(),
    transport: undefined as unknown as Transport,
    token: undefined,
    auth: options.auth,
    appVersion: options.appVersion ?? DEFAULT_APP_VERSION,
    clientIpAddress: options.clientIpAddress ?? "0.0.0.4",
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    logger: options.logger,
    now: options.now ?? Date.now,
    loginInFlight: undefined,
  };

  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    throw new Error(
      "No fetch implementation available. Pass one via ClientOptions.fetch (Node 18+ has global fetch).",
    );
  }

  state.transport = new Transport({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    userAgent: state.userAgent,
    fetch: fetchImpl,
    throttle: { ...DEFAULT_THROTTLE, ...options.throttle },
    retry: { ...DEFAULT_RETRY, ...options.retry },
    timeoutMs: options.timeoutMs ?? 30_000,
    logger: state.logger,
    getToken: () => state.token?.token,
  });

  const client = buildClient(state);
  primeAuth(state, options.auth).catch((err) => {
    state.logger?.warn("Failed to prime auth", { error: String(err) });
  });
  return client;
}

async function primeAuth(
  state: Internal,
  auth: AuthConfig | undefined,
): Promise<void> {
  if (!auth) return;
  if (auth.type === "token") {
    setToken(state, auth.token);
    await auth.onToken?.(state.token!);
    return;
  }
  if (auth.initialToken) {
    setToken(state, auth.initialToken);
    await auth.onToken?.(state.token!);
    return;
  }
  await ensureLogin(state);
}

function setToken(state: Internal, token: string): void {
  const decoded = decodeJwt(token);
  state.token = {
    token,
    expiresAt: decoded.expiresAt,
    claims: decoded.claims,
  };
}

async function ensureLogin(state: Internal): Promise<TokenInfo> {
  if (state.token) {
    const exp = state.token.expiresAt?.getTime();
    if (!exp || exp - state.now() > 5_000) return state.token;
  }
  if (state.auth?.type !== "password") {
    throw new AuthenticationError(
      "No valid token available and no password credentials to log in with",
      { path: "/SignIn/Login" },
    );
  }
  if (state.loginInFlight) return state.loginInFlight;

  const auth = state.auth;
  state.loginInFlight = performLogin(state, auth.username, auth.password)
    .then(async (info) => {
      state.token = info;
      await auth.onToken?.(info);
      return info;
    })
    .finally(() => {
      state.loginInFlight = undefined;
    });
  return state.loginInFlight;
}

async function performLogin(
  state: Internal,
  username: string,
  password: string,
  remember = false,
): Promise<TokenInfo> {
  const [encUser, encPass] = await Promise.all([
    state.cipher.encrypt(username),
    state.cipher.encrypt(password),
  ]);
  const body = {
    browser: "firefox",
    remember,
    clientIpAddress: state.clientIpAddress,
    appVersion: state.appVersion,
    userName: encUser,
    password: encPass,
  };
  const response = await state.transport.request<Record<string, unknown>>({
    method: "POST",
    path: "/SignIn/Login",
    body,
    options: { priority: "high" },
  });
  const token =
    (typeof response["accessToken"] === "string" && response["accessToken"]) ||
    (typeof response["token"] === "string" && response["token"]) ||
    (typeof (response["data"] as Record<string, unknown> | undefined)?.["accessToken"] ===
      "string" &&
      ((response["data"] as Record<string, unknown>)["accessToken"] as string)) ||
    undefined;
  if (!token) {
    throw new AuthenticationError("Login response did not contain a token", {
      path: "/SignIn/Login",
      responseBody: response,
    });
  }
  const decoded = decodeJwt(token);
  return { token, expiresAt: decoded.expiresAt, claims: decoded.claims };
}

function buildClient(state: Internal): ShopGoodwillClient<AuthState> {
  const requireToken = async (): Promise<void> => {
    await ensureLogin(state);
  };

  const bids = createBidsApi(
    wrapTransport(state.transport, requireToken),
  );
  const watchlist = createWatchlistApi(
    wrapTransport(state.transport, requireToken),
  );

  const api: ShopGoodwillClient<AuthState> = {
    search: createSearchApi(state.transport),
    items: createItemsApi(state.transport),
    shipping: createShippingApi(state.transport),
    bids: bids as WhenAuthed<AuthState, BidsApi>,
    watchlist: watchlist as WhenAuthed<AuthState, WatchlistApi>,

    async login(credentials) {
      const info = await performLogin(
        state,
        credentials.username,
        credentials.password,
        credentials.remember,
      );
      state.token = info;
      state.auth = {
        type: "password",
        username: credentials.username,
        password: credentials.password,
      };
      return api as ShopGoodwillClient<"authenticated">;
    },

    withToken(token: string) {
      setToken(state, token);
      return api as ShopGoodwillClient<"authenticated">;
    },

    getToken() {
      return state.token;
    },

    logout() {
      state.token = undefined;
      state.auth = undefined;
    },

    request<T = unknown>(
      method: "GET" | "POST" | "PUT" | "DELETE",
      path: string,
      init?: {
        body?: unknown;
        query?: Record<string, string | number | undefined>;
        auth?: boolean;
      } & RequestOptions,
    ): Promise<T> {
      const auth = init?.auth === true;
      const runner = async (): Promise<T> => {
        if (auth) await requireToken();
        const opts: RequestOptions = {};
        if (init?.signal !== undefined) opts.signal = init.signal;
        if (init?.timeoutMs !== undefined) opts.timeoutMs = init.timeoutMs;
        if (init?.priority !== undefined) opts.priority = init.priority;
        return state.transport.request<T>({
          method,
          path,
          body: init?.body,
          query: init?.query,
          auth,
          options: opts,
        });
      };
      return runner();
    },
  };
  return api;
}

/**
 * Wraps a Transport so that authenticated calls trigger `beforeAuth` (used to
 * refresh a lazy password login) before dispatch.
 */
function wrapTransport(
  transport: Transport,
  beforeAuth: () => Promise<void>,
): Transport {
  return new Proxy(transport, {
    get(target, prop, receiver) {
      if (prop !== "request") {
        return Reflect.get(target, prop, receiver);
      }
      return async function request<T>(
        req: Parameters<Transport["request"]>[0],
      ): Promise<T> {
        if (req.auth) {
          try {
            await beforeAuth();
          } catch (err) {
            if (err instanceof ShopGoodwillError) throw err;
            throw new AuthenticationError(String(err), { path: req.path, cause: err });
          }
        }
        return target.request<T>(req);
      };
    },
  });
}
