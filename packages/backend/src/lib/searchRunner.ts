import { getGoodwillClient } from "./goodwill.js";
import { db } from "../db/index.js";
import {
  itemInbox,
  type SavedSearchRow,
  type InboxItemRow,
} from "../db/schema.js";
import type { Listing, SearchOptions } from "shopgoodwill-client";
import { sendMail } from "./mailer.js";

const MAX_ITEMS_PER_RUN = 200;

function buildSearchOptions(saved: SavedSearchRow): SearchOptions {
  const opts: SearchOptions = { sort: "newly-listed" };
  if (saved.queryString) opts.query = saved.queryString;
  if (saved.categoryId) {
    const parsed = Number(saved.categoryId);
    if (Number.isFinite(parsed)) opts.categoryId = parsed;
  }
  if (saved.minPrice !== null) opts.minPrice = saved.minPrice;
  if (saved.maxPrice !== null) opts.maxPrice = saved.maxPrice;
  if (saved.excludePickupOnly) {
    opts.raw = { ...(opts.raw ?? {}), searchNoPickupOnly: "true" };
  }
  return opts;
}

function toInboxRow(
  listing: Listing,
  discoveredBySearchId: string,
): InboxItemRow {
  return {
    id: String(listing.itemId),
    title: listing.title,
    currentPrice: listing.currentPrice,
    endTime: listing.endsAtRaw,
    imageUrl: listing.imageUrl ?? null,
    status: "unread",
    discoveredAt: new Date().toISOString(),
    discoveredBySearchId,
  };
}

function digestHtml(newRows: InboxItemRow[], searchName: string): string {
  const items = newRows
    .map((r) => {
      const url = `https://shopgoodwill.com/item/${r.id}`;
      return `<li><a href="${url}">${escapeHtml(r.title)}</a> — $${r.currentPrice.toFixed(
        2,
      )} (ends ${escapeHtml(r.endTime)})</li>`;
    })
    .join("");
  return `<p><strong>${newRows.length}</strong> new item(s) matched saved search <em>${escapeHtml(
    searchName,
  )}</em>:</p><ul>${items}</ul>`;
}

function digestText(newRows: InboxItemRow[], searchName: string): string {
  const lines = newRows.map(
    (r) =>
      `- ${r.title} | $${r.currentPrice.toFixed(2)} | ends ${r.endTime} | https://shopgoodwill.com/item/${r.id}`,
  );
  return `${newRows.length} new item(s) for "${searchName}":\n\n${lines.join("\n")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SearchRunSummary {
  searchId: string;
  scanned: number;
  inserted: number;
  emailSent: boolean;
  error?: string;
}

/**
 * Execute a saved search: page through results, insert new items into the
 * inbox (dedup on itemId — existing rows keep their read/deleted state), and
 * fire an email digest if new rows were added and alerts are enabled.
 */
export async function runSavedSearch(
  saved: SavedSearchRow,
): Promise<SearchRunSummary> {
  const summary: SearchRunSummary = {
    searchId: saved.id,
    scanned: 0,
    inserted: 0,
    emailSent: false,
  };

  try {
    const client = await getGoodwillClient();
    const listings: Listing[] = [];
    console.log(`[search:${saved.id}] running saved search "${saved.name}"...`);
    console.log(
      `[search:${saved.id}] search options:`,
      buildSearchOptions(saved),
    );
    console.log(`[search:${saved.id}] max items per run: ${MAX_ITEMS_PER_RUN}`);
    for await (const listing of client.search.iterate(
      buildSearchOptions(saved),
      { maxItems: MAX_ITEMS_PER_RUN },
    )) {
      listings.push(listing);
    }
    summary.scanned = listings.length;
    if (listings.length === 0) return summary;

    const rows = listings.map((l) => toInboxRow(l, saved.id));
    const inserted = await db
      .insert(itemInbox)
      .values(rows)
      .onConflictDoNothing({ target: itemInbox.id })
      .returning();

    summary.inserted = inserted.length;

    if (inserted.length > 0 && saved.emailAlertsEnabled) {
      const result = await sendMail({
        subject: `[GW-Sniper] ${inserted.length} new item(s) for "${saved.name}"`,
        html: digestHtml(inserted, saved.name),
        text: digestText(inserted, saved.name),
        requiresGlobalFlag: true,
      });
      summary.emailSent = result.sent;
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    console.error(`[search:${saved.id}]`, err);
  }
  return summary;
}
