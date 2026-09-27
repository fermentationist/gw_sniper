import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import cron from "node-cron";
import { z } from "zod";
import { db } from "../db/index.js";
import { savedSearches } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import {
  refreshSearchSchedule,
  unregisterSearch,
} from "../lib/cronManager.js";
import { runSavedSearch } from "../lib/searchRunner.js";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  queryString: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  minPrice: z.number().nonnegative().nullable().optional(),
  maxPrice: z.number().nonnegative().nullable().optional(),
  excludePickupOnly: z.boolean().optional(),
  cronSchedule: z
    .string()
    .refine((v) => cron.validate(v), { message: "invalid cron expression" }),
  emailAlertsEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export const searchRoutes = new Hono();
searchRoutes.use("*", requireAuth);

searchRoutes.get("/", async (c) => {
  const rows = await db
    .select()
    .from(savedSearches)
    .orderBy(desc(savedSearches.createdAt));
  return c.json(rows);
});

searchRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const input = c.req.valid("json");
  const id = randomUUID();
  await db.insert(savedSearches).values({
    id,
    name: input.name,
    queryString: input.queryString ?? null,
    categoryId: input.categoryId ?? null,
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    excludePickupOnly: input.excludePickupOnly ?? false,
    cronSchedule: input.cronSchedule,
    emailAlertsEnabled: input.emailAlertsEnabled ?? true,
    isActive: input.isActive ?? true,
  });
  await refreshSearchSchedule(id);
  const [row] = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.id, id));
  return c.json(row, 201);
});

searchRoutes.put("/:id", zValidator("json", updateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const updates: Partial<typeof savedSearches.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.queryString !== undefined) updates.queryString = input.queryString;
  if (input.categoryId !== undefined) updates.categoryId = input.categoryId;
  if (input.minPrice !== undefined) updates.minPrice = input.minPrice;
  if (input.maxPrice !== undefined) updates.maxPrice = input.maxPrice;
  if (input.excludePickupOnly !== undefined) {
    updates.excludePickupOnly = input.excludePickupOnly;
  }
  if (input.cronSchedule !== undefined) updates.cronSchedule = input.cronSchedule;
  if (input.emailAlertsEnabled !== undefined) {
    updates.emailAlertsEnabled = input.emailAlertsEnabled;
  }
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const result = await db
    .update(savedSearches)
    .set(updates)
    .where(eq(savedSearches.id, id))
    .returning();
  if (result.length === 0) return c.json({ error: "not_found" }, 404);

  await refreshSearchSchedule(id);
  return c.json(result[0]);
});

searchRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db
    .delete(savedSearches)
    .where(eq(savedSearches.id, id))
    .returning();
  if (result.length === 0) return c.json({ error: "not_found" }, 404);
  unregisterSearch(id);
  return c.json({ ok: true });
});

/** Manually trigger a saved search — useful for UI "Run now" buttons. */
searchRoutes.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(savedSearches)
    .where(and(eq(savedSearches.id, id)));
  if (!row) return c.json({ error: "not_found" }, 404);
  const summary = await runSavedSearch(row);
  return c.json(summary);
});
