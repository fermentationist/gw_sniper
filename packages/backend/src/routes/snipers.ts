import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import { sniperJobs } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import {
  activeSniperTimers,
  cancelSniperTimer,
  refreshSniperJob,
} from "../lib/sniperEngine.js";
import { getGoodwillClient } from "../lib/goodwill.js";

const createSchema = z
  .object({
    itemId: z.string().min(1),
    title: z.string().min(1).optional(),
    mode: z.enum(["immediate", "scheduled"]).default("scheduled"),
    // For scheduled snipes.
    maxBid: z.number().positive().optional(),
    snipingBufferSeconds: z.number().int().min(5).max(600).optional(),
    endTime: z.string().min(1).optional(),
    // For immediate bids.
    amount: z.number().positive().optional(),
  })
  .refine(
    (v) =>
      v.mode === "immediate" ? v.amount !== undefined : v.maxBid !== undefined,
    { message: "amount is required for immediate; maxBid for scheduled" },
  );

const updateSchema = z.object({
  maxBid: z.number().positive().optional(),
  snipingBufferSeconds: z.number().int().min(5).max(600).optional(),
});

export const sniperRoutes = new Hono();
sniperRoutes.use("*", requireAuth);

sniperRoutes.get("/", async (c) => {
  const rows = await db
    .select()
    .from(sniperJobs)
    .orderBy(desc(sniperJobs.updatedAt));
  return c.json(rows);
});

sniperRoutes.get("/timers", (c) => c.json(activeSniperTimers()));

sniperRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const input = c.req.valid("json");

  // If caller didn't supply title/endTime, fetch them from the site. For
  // immediate bids we also want the current price for the audit trail.
  let title = input.title;
  let endTime = input.endTime;
  let lastCheckedPrice: number | null = null;
  if (!title || !endTime || input.mode === "immediate") {
    try {
      const client = await getGoodwillClient();
      const detail = await client.items.get(Number(input.itemId));
      title = title ?? detail.title;
      endTime = endTime ?? detail.endsAtRaw;
      lastCheckedPrice = detail.currentPrice;
    } catch (err) {
      return c.json(
        {
          error: "item_fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  }

  if (!title || !endTime) {
    return c.json({ error: "missing_item_metadata" }, 400);
  }

  if (input.mode === "immediate") {
    const amount = input.amount!;
    let jobStatus: "executed" | "outbid" | "failed" = "failed";
    let lastResultMessage: string = "";
    let finalPrice = lastCheckedPrice;
    try {
      const client = await getGoodwillClient();
      const result = await client.bids.place({
        itemId: Number(input.itemId),
        amount,
      });
      if (result.ok) {
        jobStatus = "executed";
        finalPrice = result.currentPrice ?? finalPrice;
        lastResultMessage = result.highBidder
          ? `Bid placed. High bidder at $${(result.currentPrice ?? amount).toFixed(2)}`
          : `Bid placed but not high bidder (proxy exceeded)`;
      } else {
        jobStatus = result.reason === "outbid" ? "outbid" : "failed";
        lastResultMessage = `${result.reason}: ${result.message}`;
      }
    } catch (err) {
      lastResultMessage = `Fire error: ${err instanceof Error ? err.message : String(err)}`;
    }

    await db
      .insert(sniperJobs)
      .values({
        id: input.itemId,
        title,
        maxBid: amount,
        snipingBufferSeconds: 0,
        endTime,
        jobStatus,
        lastCheckedPrice: finalPrice,
        lastResultMessage,
      })
      .onConflictDoUpdate({
        target: sniperJobs.id,
        set: {
          title,
          maxBid: amount,
          snipingBufferSeconds: 0,
          endTime,
          jobStatus,
          lastCheckedPrice: finalPrice,
          lastResultMessage,
          updatedAt: new Date().toISOString(),
        },
      });
    const [row] = await db
      .select()
      .from(sniperJobs)
      .where(eq(sniperJobs.id, input.itemId));
    return c.json(row, jobStatus === "executed" ? 201 : 200);
  }

  // mode: "scheduled"
  await db
    .insert(sniperJobs)
    .values({
      id: input.itemId,
      title,
      maxBid: input.maxBid!,
      snipingBufferSeconds: input.snipingBufferSeconds ?? 30,
      endTime,
      jobStatus: "scheduled",
      lastCheckedPrice,
    })
    .onConflictDoUpdate({
      target: sniperJobs.id,
      set: {
        title,
        maxBid: input.maxBid!,
        snipingBufferSeconds: input.snipingBufferSeconds ?? 30,
        endTime,
        jobStatus: "scheduled",
        updatedAt: new Date().toISOString(),
      },
    });
  await refreshSniperJob(input.itemId);
  const [row] = await db
    .select()
    .from(sniperJobs)
    .where(eq(sniperJobs.id, input.itemId));
  return c.json(row, 201);
});

sniperRoutes.put("/:id", zValidator("json", updateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const [existing] = await db
    .select()
    .from(sniperJobs)
    .where(eq(sniperJobs.id, id));
  if (!existing) return c.json({ error: "not_found" }, 404);

  const updates: Partial<typeof sniperJobs.$inferInsert> = {};
  if (input.maxBid !== undefined) updates.maxBid = input.maxBid;
  if (input.snipingBufferSeconds !== undefined) {
    updates.snipingBufferSeconds = input.snipingBufferSeconds;
  }

  // Update override: if maxBid rose above current live price and we were
  // outbid, roll back to scheduled so the engine re-arms the timer.
  if (
    existing.jobStatus === "outbid" &&
    input.maxBid !== undefined &&
    existing.lastCheckedPrice !== null &&
    input.maxBid > existing.lastCheckedPrice
  ) {
    updates.jobStatus = "scheduled";
    updates.lastResultMessage = `Reactivated: new max $${input.maxBid.toFixed(2)} > last price $${existing.lastCheckedPrice.toFixed(2)}`;
  }

  updates.updatedAt = new Date().toISOString();
  const [row] = await db
    .update(sniperJobs)
    .set(updates)
    .where(eq(sniperJobs.id, id))
    .returning();
  await refreshSniperJob(id);
  return c.json(row);
});

sniperRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await db
    .delete(sniperJobs)
    .where(eq(sniperJobs.id, id))
    .returning();
  if (result.length === 0) return c.json({ error: "not_found" }, 404);
  cancelSniperTimer(id);
  return c.json({ ok: true });
});
