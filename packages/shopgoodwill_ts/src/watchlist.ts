import type { Transport } from "./http.js";
import type { NoteCodec } from "./notes.js";
import type { RequestOptions, WatchlistEntry } from "./types.js";

export interface WatchlistApi {
  list<TNote = string>(
    options?: { notes?: NoteCodec<TNote> } & RequestOptions,
  ): Promise<WatchlistEntry<TNote>[]>;

  add<TNote = string>(
    params: { itemId: number; note?: TNote },
    options?: { notes?: NoteCodec<TNote> } & RequestOptions,
  ): Promise<WatchlistEntry<TNote>>;

  setNote<TNote = string>(
    params: { watchlistId: number; note: TNote },
    options?: { notes?: NoteCodec<TNote> } & RequestOptions,
  ): Promise<void>;

  remove(params: { watchlistId: number }, req?: RequestOptions): Promise<void>;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
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

function normalize<TNote>(
  raw: Record<string, unknown>,
  codec: NoteCodec<TNote> | undefined,
): WatchlistEntry<TNote> {
  const noteRaw = pickString(raw, "notes", "note", "description") ?? "";
  const note = codec
    ? codec.parse(noteRaw)
    : (noteRaw as unknown as TNote | undefined);
  const endsAtRaw = pickString(raw, "endTime", "endsAt", "endDate") ?? "";
  const endsAt = endsAtRaw
    ? new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(endsAtRaw) ? endsAtRaw : `${endsAtRaw}Z`)
    : new Date(NaN);
  return {
    watchlistId: pickNumber(raw, "watchlistItemId", "watchlistId", "id") ?? -1,
    itemId: pickNumber(raw, "itemId", "itemid") ?? -1,
    title: pickString(raw, "title", "itemTitle") ?? "",
    currentPrice: pickNumber(raw, "currentPrice", "current_price") ?? 0,
    endsAt,
    note,
    noteRaw,
    raw,
  };
}

export function createWatchlistApi(transport: Transport): WatchlistApi {
  return {
    async list<TNote = string>(
      options: ({ notes?: NoteCodec<TNote> } & RequestOptions) | undefined = undefined,
    ): Promise<WatchlistEntry<TNote>[]> {
      const raw = await transport.request<unknown>({
        method: "GET",
        path: "/Favorite/GetAllFavorites",
        auth: true,
        options,
      });
      const rows: unknown[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as Record<string, unknown>)["data"])
          ? ((raw as Record<string, unknown>)["data"] as unknown[])
          : [];
      return rows
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => normalize<TNote>(r, options?.notes));
    },

    async add<TNote = string>(
      params: { itemId: number; note?: TNote },
      options: ({ notes?: NoteCodec<TNote> } & RequestOptions) | undefined = undefined,
    ): Promise<WatchlistEntry<TNote>> {
      const noteRaw =
        params.note === undefined
          ? ""
          : options?.notes
            ? options.notes.serialize(params.note)
            : String(params.note);
      const raw = await transport.request<Record<string, unknown>>({
        method: "POST",
        path: "/Favorite/AddToFavorites",
        body: { itemId: params.itemId, notes: noteRaw },
        auth: true,
        options,
      });
      return normalize<TNote>(raw, options?.notes);
    },

    async setNote<TNote = string>(
      params: { watchlistId: number; note: TNote },
      options: ({ notes?: NoteCodec<TNote> } & RequestOptions) | undefined = undefined,
    ): Promise<void> {
      const noteRaw = options?.notes
        ? options.notes.serialize(params.note)
        : String(params.note);
      await transport.request<unknown>({
        method: "POST",
        path: "/Favorite/UpdateFavoriteNotes",
        body: { watchlistItemId: params.watchlistId, notes: noteRaw },
        auth: true,
        options,
      });
    },

    async remove(params, req) {
      await transport.request<unknown>({
        method: "POST",
        path: "/Favorite/RemoveFromFavorites",
        body: { watchlistItemId: params.watchlistId },
        auth: true,
        options: req,
      });
    },
  };
}
