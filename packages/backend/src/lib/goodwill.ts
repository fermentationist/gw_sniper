import { eq } from "drizzle-orm";
import {
  shopGoodwill,
  type ShopGoodwillClient,
  type TokenInfo,
} from "shopgoodwill-client";
import { db } from "../db/index.js";
import { appConfig } from "../db/schema.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

let cached: ShopGoodwillClient<"authenticated"> | null = null;
let cachedTokenSignature: string | null = null;
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
  constructor(message = "Goodwill authentication is not set up") {
    super(message);
    this.name = "GoodwillNotConfiguredError";
  }
}

export function invalidateGoodwillClient(): void {
  cached = null;
  cachedTokenSignature = null;
}

async function persistToken(info: TokenInfo): Promise<void> {
  const patch: Partial<typeof appConfig.$inferInsert> = {
    encryptedAccessToken: encryptSecret(info.token),
    accessTokenExpiresAt: info.expiresAt?.toISOString() ?? null,
  };
  if (info.refresh) {
    patch.encryptedRefreshToken = encryptSecret(info.refresh.token);
    patch.refreshTokenExpiresAt = info.refresh.expiresAt.toISOString();
    patch.refreshTokenCreatedByIp = info.refresh.createdByIp;
  }
  await db.update(appConfig).set(patch).where(eq(appConfig.id, 1));
}

/**
 * Build (or reuse) an authenticated ShopGoodwill client from tokens stored in
 * `app_config`. The client refreshes automatically when the access token
 * expires and persists the new pair via the `onToken` hook.
 *
 * Throws {@link GoodwillNotConfiguredError} when no usable tokens exist —
 * the user needs to (re-)authenticate via /api/auth/goodwill/login.
 */
export async function getGoodwillClient(): Promise<
  ShopGoodwillClient<"authenticated">
> {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1));
  if (!row?.encryptedAccessToken || !row.encryptedRefreshToken) {
    throw new GoodwillNotConfiguredError(
      "Not authenticated with ShopGoodwill — log in via the Config screen.",
    );
  }
  if (
    !row.refreshTokenExpiresAt ||
    !row.refreshTokenCreatedByIp ||
    new Date(row.refreshTokenExpiresAt).getTime() - Date.now() < 5_000
  ) {
    throw new GoodwillNotConfiguredError(
      "Refresh token expired — log in again via the Config screen.",
    );
  }

  const signature = `${row.encryptedAccessToken}|${row.encryptedRefreshToken}`;
  if (cached && cachedTokenSignature === signature) {
    return cached;
  }

  const token = decryptSecret(row.encryptedAccessToken);
  const refreshToken = decryptSecret(row.encryptedRefreshToken);

  const client = shopGoodwill({
    auth: {
      type: "token",
      token,
      refresh: {
        token: refreshToken,
        expiresAt: new Date(row.refreshTokenExpiresAt),
        createdByIp: row.refreshTokenCreatedByIp,
      },
      onToken: (info) => {
        cachedTokenSignature = null; // force rebuild on next call
        void persistToken(info);
      },
    },
  });

  cached = client;
  cachedTokenSignature = signature;
  return client;
}

/**
 * Exchange a username+password for a token pair, persist them, and discard
 * the password. Used by the one-time /api/auth/goodwill/login endpoint.
 */
export async function loginAndStoreTokens(
  username: string,
  password: string,
): Promise<TokenInfo> {
  const client = shopGoodwill({
    auth: {
      type: "password",
      username,
      password,
      onToken: (info) => {
        void persistToken(info);
      },
    },
  });
  // primeAuth runs the login in the background; wait for it to settle by
  // pulling a token deliberately. `login` on the client returns after
  // performLogin resolves.
  const authedClient = await client.login({ username, password });
  const info = authedClient.getToken();
  if (!info) {
    throw new Error("Login succeeded but no token was returned");
  }
  // Persist explicitly (the imperative .login path doesn't route through the
  // AuthConfig callback we set above).
  await persistToken(info);
  await db
    .update(appConfig)
    .set({ goodwillUsername: username })
    .where(eq(appConfig.id, 1));
  invalidateGoodwillClient();
  return info;
}
