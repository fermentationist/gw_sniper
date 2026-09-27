import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { itemInbox } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { getPublicGoodwillClient } from "../lib/goodwill.js";

const SORT_COLUMNS = {
  endTime: itemInbox.endTime,
  currentPrice: itemInbox.currentPrice,
  discoveredAt: itemInbox.discoveredAt,
  title: itemInbox.title,
} as const;

const listQuerySchema = z.object({
  status: z.enum(["unread", "read", "deleted", "active"]).default("active"),
  sort: z
    .enum(["endTime", "currentPrice", "discoveredAt", "title"])
    .default("discoveredAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["read", "unread", "delete", "restore"]),
});

const liveQuerySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export interface InboxLiveEntry {
  currentPrice?: number;
  bidCount?: number;
  endTime?: string;
  error?: string;
}

export const inboxRoutes = new Hono();
inboxRoutes.use("*", requireAuth);

inboxRoutes.get("/", zValidator("query", listQuerySchema), async (c) => {
  const { status, sort, dir, limit, offset } = c.req.valid("query");
  const column = SORT_COLUMNS[sort];
  const rows = await db
    .select()
    .from(itemInbox)
    .where(
      status === "active"
        ? ne(itemInbox.status, "deleted")
        : eq(itemInbox.status, status),
    )
    .orderBy(dir === "asc" ? asc(column) : desc(column))
    .limit(limit)
    .offset(offset);
  return c.json(rows);
});

inboxRoutes.post("/live", zValidator("json", liveQuerySchema), async (c) => {
  const { ids } = c.req.valid("json");
  const client = getPublicGoodwillClient();
  const results = await Promise.all(
    ids.map(async (id): Promise<[string, InboxLiveEntry]> => {
      const numericId = Number(id);
      if (!Number.isFinite(numericId)) {
        return [id, { error: "invalid_id" }];
      }
      try {
        const detail = await client.items.get(numericId);
        return [
          id,
          {
            currentPrice: detail.currentPrice,
            bidCount: detail.bidCount,
            endTime: detail.endsAtRaw,
          },
        ];
      } catch (err) {
        return [id, { error: err instanceof Error ? err.message : String(err) }];
      }
    }),
  );
  return c.json(Object.fromEntries(results) as Record<string, InboxLiveEntry>);
});

inboxRoutes.post("/bulk", zValidator("json", bulkActionSchema), async (c) => {
  const { ids, action } = c.req.valid("json");
  const nextStatus: (typeof itemInbox.status.enumValues)[number] =
    action === "delete"
      ? "deleted"
      : action === "restore"
        ? "unread"
        : action === "read"
          ? "read"
          : "unread";
  const result = await db
    .update(itemInbox)
    .set({ status: nextStatus })
    .where(inArray(itemInbox.id, ids))
    .returning({ id: itemInbox.id });
  return c.json({ updated: result.length });
});

inboxRoutes.patch("/:id/read", async (c) => {
  const id = c.req.param("id");
  const result = await db
    .update(itemInbox)
    .set({ status: "read" })
    .where(and(eq(itemInbox.id, id), ne(itemInbox.status, "deleted")))
    .returning();
  if (result.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json(result[0]);
});

inboxRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db
    .update(itemInbox)
    .set({ status: "deleted" })
    .where(eq(itemInbox.id, id))
    .returning();
  if (result.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
