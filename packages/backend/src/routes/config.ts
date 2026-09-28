import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { appConfig } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { encryptSecret } from "../lib/crypto.js";
import { loginAndStoreTokens } from "../lib/goodwill.js";
import { invalidateMailer } from "../lib/mailer.js";

const configUpdateSchema = z.object({
  notificationEmail: z.string().email().nullable().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().positive().nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpPass: z.string().nullable().optional(),
  globalEmailAlertsEnabled: z.boolean().optional(),
});

const goodwillLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const configRoutes = new Hono();
configRoutes.use("*", requireAuth);

configRoutes.get("/", async (c) => {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1));
  if (!row) return c.json({ error: "config_missing" }, 500);
  // Never leak secrets back to the client.
  return c.json({
    goodwillUsername: row.goodwillUsername,
    goodwillAuthenticated: Boolean(
      row.encryptedAccessToken && row.encryptedRefreshToken,
    ),
    goodwillAccessTokenExpiresAt: row.accessTokenExpiresAt,
    goodwillRefreshTokenExpiresAt: row.refreshTokenExpiresAt,
    notificationEmail: row.notificationEmail,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpUser: row.smtpUser,
    smtpPassSet: Boolean(row.smtpPass),
    globalEmailAlertsEnabled: row.globalEmailAlertsEnabled ?? false,
  });
});

configRoutes.put("/", zValidator("json", configUpdateSchema), async (c) => {
  const input = c.req.valid("json");
  const updates: Partial<typeof appConfig.$inferInsert> = {};

  if (input.notificationEmail !== undefined) {
    updates.notificationEmail = input.notificationEmail;
  }
  if (input.smtpHost !== undefined) updates.smtpHost = input.smtpHost;
  if (input.smtpPort !== undefined) updates.smtpPort = input.smtpPort;
  if (input.smtpUser !== undefined) updates.smtpUser = input.smtpUser;
  if (input.smtpPass !== undefined) {
    updates.smtpPass = input.smtpPass ? encryptSecret(input.smtpPass) : null;
  }
  if (input.globalEmailAlertsEnabled !== undefined) {
    updates.globalEmailAlertsEnabled = input.globalEmailAlertsEnabled;
  }

  await db.update(appConfig).set(updates).where(eq(appConfig.id, 1));
  invalidateMailer();
  return c.json({ ok: true });
});

// One-time credential exchange: username+password → stored token pair.
// The password is never persisted.
configRoutes.post(
  "/goodwill/login",
  zValidator("json", goodwillLoginSchema),
  async (c) => {
    const { username, password } = c.req.valid("json");
    try {
      const info = await loginAndStoreTokens(username, password);
      return c.json({
        ok: true,
        accessTokenExpiresAt: info.expiresAt?.toISOString() ?? null,
        refreshTokenExpiresAt: info.refresh?.expiresAt.toISOString() ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  },
);

configRoutes.post("/goodwill/logout", async (c) => {
  await db
    .update(appConfig)
    .set({
      encryptedAccessToken: null,
      accessTokenExpiresAt: null,
      encryptedRefreshToken: null,
      refreshTokenExpiresAt: null,
      refreshTokenCreatedByIp: null,
    })
    .where(eq(appConfig.id, 1));
  return c.json({ ok: true });
});
