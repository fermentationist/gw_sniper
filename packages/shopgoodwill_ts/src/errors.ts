export interface ShopGoodwillErrorInit {
  path: string;
  status?: number | undefined;
  responseBody?: unknown;
  cause?: unknown;
}

export class ShopGoodwillError extends Error {
  readonly path: string;
  readonly status: number | undefined;
  readonly responseBody: unknown;

  constructor(message: string, init: ShopGoodwillErrorInit) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.path = init.path;
    this.status = init.status;
    this.responseBody = init.responseBody;
  }
}

export class AuthenticationError extends ShopGoodwillError {}

export class ForbiddenError extends ShopGoodwillError {
  constructor(init: ShopGoodwillErrorInit & { message?: string | undefined }) {
    super(
      init.message ??
        "403 Forbidden. On buyerapi.shopgoodwill.com this is almost always the " +
          "cookie bug — make sure no Set-Cookie headers from this domain are being retained.",
      init,
    );
  }
}

export class RateLimitError extends ShopGoodwillError {
  readonly retryAfterMs: number | undefined;

  constructor(init: ShopGoodwillErrorInit & { retryAfterMs?: number | undefined }) {
    super(`Rate limited by ${init.path}`, init);
    this.retryAfterMs = init.retryAfterMs;
  }
}

export class ResponseShapeError extends ShopGoodwillError {
  readonly issues: string[];

  constructor(init: ShopGoodwillErrorInit & { issues: string[] }) {
    super(
      `Response from ${init.path} did not match expected shape: ${init.issues.join(", ")}`,
      init,
    );
    this.issues = init.issues;
  }
}

export function isShopGoodwillError(e: unknown): e is ShopGoodwillError {
  return e instanceof ShopGoodwillError;
}
