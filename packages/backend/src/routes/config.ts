import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { appConfig } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { encryptSecret } from "../lib/crypto.js";
import { invalidateGoodwillClient } from "../lib/goodwill.js";
import { invalidateMailer } from "../lib/mailer.js";

const configUpdateSchema = z.object({
  goodwillUsername: z.string().min(1).optional(),
  goodwillPassword: z.string().min(1).optional(),
  notificationEmail: z.string().email().nullable().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().positive().nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpPass: z.string().nullable().optional(),
  globalEmailAlertsEnabled: z.boolean().optional(),
});

export const configRoutes = new Hono();
configRoutes.use("*", requireAuth);

configRoutes.get("/", async (c) => {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1));
  if (!row) return c.json({ error: "config_missing" }, 500);
  // Never leak secrets back to the client.
  return c.json({
    goodwillUsername: row.goodwillUsername,
    goodwillPasswordSet: Boolean(row.encryptedGoodwillPassword),
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

  if (input.goodwillUsername !== undefined) {
    updates.goodwillUsername = input.goodwillUsername;
  }
  if (input.goodwillPassword !== undefined) {
    updates.encryptedGoodwillPassword = encryptSecret(input.goodwillPassword);
    // Force a fresh login next time the client is used.
    updates.cachedToken = null;
    updates.tokenExpiresAt = null;
  }
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
  invalidateGoodwillClient();
  invalidateMailer();
  return c.json({ ok: true });
});
