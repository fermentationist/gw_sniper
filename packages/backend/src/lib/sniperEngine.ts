import cron, { type ScheduledTask } from "node-cron";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { sniperJobs, type SniperJobRow } from "../db/schema.js";
import { getGoodwillClient } from "./goodwill.js";
import { sendMail } from "./mailer.js";

// How far in advance we register a precise in-memory timer for a job.
const MICRO_SCHEDULE_HORIZON_MS = 10 * 60 * 1000;

// How early before the actual bid moment we run the pre-flight price check.
const PREFLIGHT_LEAD_MS = 5_000;

// Interval between outbid poller passes.
const OUTBID_POLL_CRON = "*/30 * * * * *"; // every 30 seconds

// Interval between micro-scheduler sweeps.
const MICRO_SWEEP_CRON = "*/15 * * * * *"; // every 15 seconds

type Timer = ReturnType<typeof setTimeout>;

interface ActiveTimer {
  fireAt: number;
  handle: Timer;
}

const timers = new Map<string, ActiveTimer>();
let outbidPoller: ScheduledTask | null = null;
let microSweep: ScheduledTask | null = null;

function endTimeMs(row: SniperJobRow): number {
  const raw = row.endTime;
  const withZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  return new Date(withZone).getTime();
}

function nowMs(): number {
  return Date.now();
}

function cancelTimer(jobId: string): void {
  const existing = timers.get(jobId);
  if (existing) {
    clearTimeout(existing.handle);
    timers.delete(jobId);
  }
}

async function updateJob(
  id: string,
  changes: Partial<SniperJobRow>,
): Promise<SniperJobRow | undefined> {
  const rows = await db
    .update(sniperJobs)
    .set({ ...changes, updatedAt: new Date().toISOString() })
    .where(eq(sniperJobs.id, id))
    .returning();
  return rows[0];
}

async function sendOutbidEmail(row: SniperJobRow, price: number): Promise<void> {
  const url = `https://shopgoodwill.com/item/${row.id}`;
  await sendMail({
    subject: `[GW-Sniper] Outbid on "${row.title}"`,
    text:
      `Your snipe on "${row.title}" has been cancelled.\n` +
      `Current price ($${price.toFixed(2)}) now exceeds your max bid ($${row.maxBid.toFixed(2)}).\n\n${url}`,
    html:
      `<p>Your snipe on <strong>${escapeHtml(row.title)}</strong> has been cancelled.</p>` +
      `<p>Current price <strong>$${price.toFixed(2)}</strong> exceeds your max bid $${row.maxBid.toFixed(2)}.</p>` +
      `<p><a href="${url}">${url}</a></p>`,
    requiresGlobalFlag: true,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Fires the actual bid for a job. Called from a setTimeout registered at
 * `endTime - buffer - PREFLIGHT_LEAD_MS`. Re-reads the job before acting so
 * stale timer callbacks from now-mutated jobs are safe.
 */
async function fireSnipe(jobId: string): Promise<void> {
  timers.delete(jobId);
  const [row] = await db
    .select()
    .from(sniperJobs)
    .where(eq(sniperJobs.id, jobId));
  if (!row || row.jobStatus !== "scheduled") return;

  try {
    const client = await getGoodwillClient();
    const bidMoment = endTimeMs(row) - row.snipingBufferSeconds * 1000;

    // Pre-flight price check.
    const detail = await client.items.get(Number(row.id));
    const currentPrice = detail.currentPrice ?? row.lastCheckedPrice ?? 0;
    if (currentPrice > row.maxBid) {
      await updateJob(row.id, {
        jobStatus: "outbid",
        lastCheckedPrice: currentPrice,
        lastResultMessage: `Pre-flight aborted: price $${currentPrice.toFixed(2)} > max $${row.maxBid.toFixed(2)}`,
      });
      await sendOutbidEmail(row, currentPrice);
      return;
    }

    // Sleep the remaining lead time so the bid lands as close to bidMoment as possible.
    const remaining = bidMoment - nowMs();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    const result = await client.bids.place({
      itemId: Number(row.id),
      amount: row.maxBid,
    });

    if (result.ok) {
      await updateJob(row.id, {
        jobStatus: "executed",
        lastCheckedPrice: result.currentPrice ?? currentPrice,
        lastResultMessage: result.highBidder
          ? `Bid placed. Current high bidder at $${(result.currentPrice ?? row.maxBid).toFixed(2)}`
          : `Bid placed but not high bidder (proxy exceeded)`,
      });
    } else {
      const nextStatus = result.reason === "outbid" ? "outbid" : "failed";
      await updateJob(row.id, {
        jobStatus: nextStatus,
        lastResultMessage: `${result.reason}: ${result.message}`,
      });
      if (result.reason === "outbid") {
        await sendOutbidEmail(row, currentPrice);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob(jobId, {
      jobStatus: "failed",
      lastResultMessage: `Fire error: ${message}`,
    });
    console.error(`[sniper:${jobId}] fire error`, err);
  }
}

/**
 * Register a precise in-memory timer for a single job, if it qualifies.
 * Cancels any existing timer for that job first — safe to call repeatedly.
 */
function armTimer(row: SniperJobRow): void {
  cancelTimer(row.id);
  if (row.jobStatus !== "scheduled") return;
  const end = endTimeMs(row);
  if (!Number.isFinite(end)) return;
  const fireAt = end - row.snipingBufferSeconds * 1000 - PREFLIGHT_LEAD_MS;
  const delay = Math.max(0, fireAt - nowMs());
  if (delay > MICRO_SCHEDULE_HORIZON_MS) return;
  const handle = setTimeout(() => {
    void fireSnipe(row.id);
  }, delay);
  timers.set(row.id, { fireAt, handle });
}

/**
 * Called from routes after DB mutations — re-arms or cancels the in-memory
 * timer to match the current DB state.
 */
export async function refreshSniperJob(jobId: string): Promise<void> {
  cancelTimer(jobId);
  const [row] = await db
    .select()
    .from(sniperJobs)
    .where(eq(sniperJobs.id, jobId));
  if (!row) return;
  armTimer(row);
}

export function cancelSniperTimer(jobId: string): void {
  cancelTimer(jobId);
}

/** Sweep: pick up scheduled jobs near expiry and arm their timers. */
async function microSweepPass(): Promise<void> {
  const rows = await db
    .select()
    .from(sniperJobs)
    .where(eq(sniperJobs.jobStatus, "scheduled"));
  for (const row of rows) armTimer(row);
}

/** Poller: check current price of every live job for outbid state. */
async function outbidPollPass(): Promise<void> {
  const rows = await db
    .select()
    .from(sniperJobs)
    .where(inArray(sniperJobs.jobStatus, ["scheduled", "outbid"]));
  if (rows.length === 0) return;

  let client: Awaited<ReturnType<typeof getGoodwillClient>>;
  try {
    client = await getGoodwillClient();
  } catch (err) {
    console.warn("[sniper] outbid poll skipped:", (err as Error).message);
    return;
  }

  for (const row of rows) {
    try {
      const detail = await client.items.get(Number(row.id));
      const price = detail.currentPrice;
      const wasScheduled = row.jobStatus === "scheduled";
      const nowOutbid = price > row.maxBid;

      if (wasScheduled && nowOutbid) {
        await updateJob(row.id, {
          jobStatus: "outbid",
          lastCheckedPrice: price,
          lastResultMessage: `Outbid detected: $${price.toFixed(2)} > max $${row.maxBid.toFixed(2)}`,
        });
        cancelTimer(row.id);
        await sendOutbidEmail(row, price);
      } else if (row.jobStatus === "outbid" && !nowOutbid) {
        // Price dropped back below max (rare on live auctions but possible).
        await updateJob(row.id, {
          jobStatus: "scheduled",
          lastCheckedPrice: price,
          lastResultMessage: `Price returned to $${price.toFixed(2)} (<= max $${row.maxBid.toFixed(2)})`,
        });
        const [refreshed] = await db
          .select()
          .from(sniperJobs)
          .where(eq(sniperJobs.id, row.id));
        if (refreshed) armTimer(refreshed);
      } else {
        await updateJob(row.id, { lastCheckedPrice: price });
      }
    } catch (err) {
      console.warn(`[sniper:${row.id}] poll error`, err);
    }
  }
}

export async function startSniperEngine(): Promise<void> {
  outbidPoller = cron.schedule(OUTBID_POLL_CRON, () => {
    void outbidPollPass();
  });
  microSweep = cron.schedule(MICRO_SWEEP_CRON, () => {
    void microSweepPass();
  });
  // Initial arm on boot so restarts don't miss jobs that already qualify.
  await microSweepPass();
  console.log("[sniper] engine started");
}

export function stopSniperEngine(): void {
  outbidPoller?.stop();
  microSweep?.stop();
  outbidPoller = null;
  microSweep = null;
  for (const { handle } of timers.values()) clearTimeout(handle);
  timers.clear();
}

export function activeSniperTimers(): Array<{ id: string; fireAt: number }> {
  return Array.from(timers.entries()).map(([id, t]) => ({ id, fireAt: t.fireAt }));
}
