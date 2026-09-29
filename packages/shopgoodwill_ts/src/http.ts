import {
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  ShopGoodwillError,
} from "./errors.js";
import type {
  Logger,
  RequestOptions,
  RetryOptions,
  ThrottleOptions,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://buyerapi.shopgoodwill.com/api";
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0";

export interface TransportOptions {
  baseUrl: string;
  userAgent: string;
  fetch: typeof globalThis.fetch;
  throttle: Required<ThrottleOptions>;
  retry: Required<RetryOptions>;
  timeoutMs: number;
  logger: Logger | undefined;
  getToken: () => string | undefined;
}

export interface TransportRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined> | undefined;
  auth?: boolean | undefined;
  /** @default "json" — endpoints that return HTML (e.g. CalculateShipping) opt into "text". */
  responseType?: "json" | "text" | undefined;
  options?: RequestOptions | undefined;
}

interface QueuedTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  priority: "normal" | "high";
}

export class Transport {
  private readonly opts: TransportOptions;
  private queue: Array<QueuedTask<unknown>> = [];
  private inFlight = 0;
  private lastStartedAt = 0;

  constructor(opts: TransportOptions) {
    this.opts = opts;
  }

  async request<T>(req: TransportRequest): Promise<T> {
    return this.schedule<T>(req.options?.priority ?? "normal", () =>
      this.execute<T>(req),
    );
  }

  private schedule<T>(
    priority: "normal" | "high",
    run: () => Promise<T>,
  ): Promise<T> {
    if (priority === "high") {
      return run();
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: run as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        priority,
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.inFlight < this.opts.throttle.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (!task) return;
      const now = Date.now();
      const gap = this.opts.throttle.minIntervalMs;
      const wait = Math.max(0, this.lastStartedAt + gap - now);
      this.inFlight++;
      this.lastStartedAt = now + wait;
      const start = wait
        ? new Promise((r) => setTimeout(r, wait))
        : Promise.resolve();
      start
        .then(() => task.run())
        .then(
          (value) => task.resolve(value),
          (err) => task.reject(err),
        )
        .finally(() => {
          this.inFlight--;
          this.drain();
        });
    }
  }

  private async execute<T>(req: TransportRequest): Promise<T> {
    const url = this.buildUrl(req.path, req.query);
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": this.opts.userAgent,
    });
    if (req.auth) {
      const token = this.opts.getToken();
      if (!token) {
        throw new AuthenticationError(
          `${req.path} requires authentication but no token is available`,
          { path: req.path },
        );
      }
      headers.set("Authorization", `Bearer ${token}`);
    }

    const init: RequestInit = { method: req.method, headers };
    if (req.body !== undefined && req.method !== "GET") {
      init.body = JSON.stringify(req.body);
    }

    const attempts = Math.max(1, this.opts.retry.attempts);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const external = req.options?.signal;
      const onAbort = (): void => controller.abort(external?.reason);
      if (external) {
        if (external.aborted) controller.abort(external.reason);
        else external.addEventListener("abort", onAbort, { once: true });
      }
      const timeoutMs = req.options?.timeoutMs ?? this.opts.timeoutMs;
      const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

      try {
        const response = await this.opts.fetch(url, {
          ...init,
          signal: controller.signal,
        });
        // Deliberately ignore Set-Cookie headers per API quirk.
        const status = response.status;

        if (status >= 200 && status < 300) {
          const raw = await response.text();
          if (!raw) return undefined as T;
          if (req.responseType === "text") {
            return raw as unknown as T;
          }
          try {
            return JSON.parse(raw) as T;
          } catch (cause) {
            throw new ShopGoodwillError(
              `${req.path} returned non-JSON body (${status})`,
              { path: req.path, status, responseBody: raw, cause },
            );
          }
        }

        const body = await this.readBody(response);
        if (status === 401) {
          throw new AuthenticationError(
            `${req.path} returned 401 Unauthorized`,
            { path: req.path, status, responseBody: body },
          );
        }
        if (status === 403) {
          throw new ForbiddenError({
            path: req.path,
            status,
            responseBody: body,
          });
        }
        if (status === 429) {
          const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
          if (attempt < attempts) {
            lastError = new RateLimitError({
              path: req.path,
              status,
              responseBody: body,
              retryAfterMs: retryAfter,
            });
            await sleep(retryAfter ?? backoff(attempt, this.opts.retry.baseDelayMs));
            continue;
          }
          throw new RateLimitError({
            path: req.path,
            status,
            responseBody: body,
            retryAfterMs: retryAfter,
          });
        }
        if (this.opts.retry.retryOn.includes(status) && attempt < attempts) {
          lastError = new ShopGoodwillError(
            `${req.path} returned ${status}`,
            { path: req.path, status, responseBody: body },
          );
          this.opts.logger?.warn(
            `Retrying ${req.path} after ${status} (attempt ${attempt}/${attempts})`,
          );
          await sleep(backoff(attempt, this.opts.retry.baseDelayMs));
          continue;
        }
        throw new ShopGoodwillError(`${req.path} returned ${status}`, {
          path: req.path,
          status,
          responseBody: body,
        });
      } catch (err) {
        if (err instanceof ShopGoodwillError) {
          if (!(err instanceof RateLimitError) || attempt >= attempts) throw err;
          lastError = err;
        } else {
          // network / abort / json.stringify errors
          if (attempt < attempts) {
            lastError = err;
            this.opts.logger?.warn(
              `Transport error on ${req.path}, retrying (${attempt}/${attempts})`,
              { error: String(err) },
            );
            await sleep(backoff(attempt, this.opts.retry.baseDelayMs));
            continue;
          }
          throw new ShopGoodwillError(
            `${req.path} failed: ${(err as Error).message ?? String(err)}`,
            { path: req.path, cause: err },
          );
        }
      } finally {
        clearTimeout(timer);
        if (external) external.removeEventListener("abort", onAbort);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ShopGoodwillError(`${req.path} exhausted retries`, {
          path: req.path,
        });
  }

  private buildUrl(
    path: string,
    query: Record<string, string | number | undefined> | undefined,
  ): string {
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(base + suffix);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function backoff(attempt: number, baseMs: number): number {
  const jitter = Math.random() * baseMs;
  return baseMs * 2 ** (attempt - 1) + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}
