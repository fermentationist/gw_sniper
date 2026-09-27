import { eq } from "drizzle-orm";
import {
  shopGoodwill,
  type ShopGoodwillClient,
  type TokenInfo,
} from "shopgoodwill-client";
import { db } from "../db/index.js";
import { appConfig } from "../db/schema.js";
import { decryptSecret } from "./crypto.js";

let cached: ShopGoodwillClient<"authenticated"> | null = null;
let cachedForUsername: string | null = null;
let cachedPublic: ShopGoodwillClient | null = null;

/** Anonymous client for read-only endpoints (item detail, search, shipping). */
export function getPublicGoodwillClient(): ShopGoodwillClient {
  if (!cachedPublic) {
    cachedPublic = shopGoodwill({
      throttle: { concurrency: 4, minIntervalMs: 100 },
    });
  }
  return cachedPublic;
}

export class GoodwillNotConfiguredError extends Error {
  constructor() {
    super("Goodwill credentials are not configured");
    this.name = "GoodwillNotConfiguredError";
  }
}

export function invalidateGoodwillClient(): void {
  cached = null;
  cachedForUsername = null;
}

async function persistToken(info: TokenInfo): Promise<void> {
  await db
    .update(appConfig)
    .set({
      cachedToken: info.token,
      tokenExpiresAt: info.expiresAt ? info.expiresAt.toISOString() : null,
    })
    .where(eq(appConfig.id, 1));
}

/**
 * Build (or reuse) an authenticated ShopGoodwill client using the credentials
 * stored in `app_config`. The client persists refreshed tokens back to the
 * database via its `onToken` hook — a single source of truth.
 */
export async function getGoodwillClient(): Promise<
  ShopGoodwillClient<"authenticated">
> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1));
  if (!row?.goodwillUsername || !row.encryptedGoodwillPassword) {
    throw new GoodwillNotConfiguredError();
  }

  if (cached && cachedForUsername === row.goodwillUsername) {
    return cached;
  }

  const password = decryptSecret(row.encryptedGoodwillPassword);
  const initialToken =
    row.cachedToken && row.tokenExpiresAt &&
    new Date(row.tokenExpiresAt).getTime() - Date.now() > 10_000
      ? row.cachedToken
      : undefined;

  const client = shopGoodwill({
    auth: {
      type: "password",
      username: row.goodwillUsername,
      password,
      initialToken,
      onToken: (info) => {
        void persistToken(info);
      },
    },
  });

  cached = client;
  cachedForUsername = row.goodwillUsername;
  return client;
}
