import type { Transport } from "./http.js";
import { normalizeListing } from "./search.js";
import type { BidHistoryEntry, ItemDetail, RequestOptions } from "./types.js";

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length) return v;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export interface ItemsApi {
  get(itemId: number, req?: RequestOptions): Promise<ItemDetail>;
  bidHistory(itemId: number, req?: RequestOptions): Promise<BidHistoryEntry[]>;
}

export function createItemsApi(transport: Transport): ItemsApi {
  return {
    async get(itemId, req) {
      const raw = await transport.request<Record<string, unknown>>({
        method: "GET",
        path: `/ItemDetail/GetItemDetailModelByItemId/${itemId}`,
        options: req,
      });
      const base = normalizeListing(raw);
      const detail: ItemDetail = {
        ...base,
        description: pickString(raw, "description", "shortDescription"),
        handlingFee: pickNumber(raw, "handlingFee", "handling"),
        weightLbs: pickNumber(raw, "weight", "weightLbs"),
        minimumBid: pickNumber(raw, "minimumBid", "nextBid"),
      };
      return detail;
    },
    async bidHistory(itemId, req) {
      const raw = await transport.request<Record<string, unknown>>({
        method: "GET",
        path: `/ItemDetail/ItemBidHistory/${itemId}`,
        options: req,
      });
      const rows: unknown[] = Array.isArray(raw["bidHistory"])
        ? (raw["bidHistory"] as unknown[])
        : Array.isArray(raw["data"])
          ? (raw["data"] as unknown[])
          : Array.isArray(raw)
            ? (raw as unknown[])
            : [];
      return rows
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((row) => {
          const bidder = pickString(row, "bidder", "bidderName", "userName") ?? "";
          const amount = pickNumber(row, "amount", "bidAmount", "price") ?? 0;
          const placedRaw =
            pickString(row, "bidDate", "placedAt", "date", "bidTime") ?? "";
          return {
            bidder,
            amount,
            placedAt: placedRaw ? new Date(placedRaw) : new Date(NaN),
            raw: row,
          } satisfies BidHistoryEntry;
        });
    },
  };
}
