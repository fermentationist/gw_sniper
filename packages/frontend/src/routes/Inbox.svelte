<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    type InboxItem,
    type InboxLiveEntry,
    type ShippingQuote,
  } from "../lib/api.js";
  import { handleUnauthorized } from "../lib/session.svelte.js";

  type QuoteState =
    | { status: "loading" }
    | { status: "ok"; quote: ShippingQuote }
    | { status: "error"; message: string };

  type Tab = "unread" | "read" | "deleted";
  type SortKey = "endTime" | "currentPrice" | "discoveredAt" | "title";
  type SortDir = "asc" | "desc";
  const SORT_OPTIONS: { value: SortKey; label: string; defaultDir: SortDir }[] = [
    { value: "endTime", label: "Time remaining", defaultDir: "asc" },
    { value: "currentPrice", label: "Current price", defaultDir: "asc" },
    { value: "discoveredAt", label: "Discovered", defaultDir: "desc" },
    { value: "title", label: "Title", defaultDir: "asc" },
  ];
  let tab = $state<Tab>("unread");
  let sortKey = $state<SortKey>("discoveredAt");
  let sortDir = $state<SortDir>("desc");
  let showEnded = $state(false);
  let items = $state<InboxItem[]>([]);
  let live = $state<Record<string, InboxLiveEntry>>({});
  let liveLoading = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());
  let quotes = $state<Record<string, QuoteState>>({});
  let nowTick = $state(Date.now());

  const displayItems = $derived.by(() => {
    const endedThreshold = nowTick;
    const filtered = showEnded
      ? items
      : items.filter((i) => {
          const raw = live[i.id]?.endTime ?? i.endTime;
          const t = new Date(raw).getTime();
          // Keep items whose end time is unparseable or still in the future.
          return !Number.isFinite(t) || t > endedThreshold;
        });
    if (sortKey !== "currentPrice") return filtered;
    const priceOf = (i: InboxItem) =>
      live[i.id]?.currentPrice ?? i.currentPrice;
    return [...filtered].sort((a, b) =>
      sortDir === "asc" ? priceOf(a) - priceOf(b) : priceOf(b) - priceOf(a),
    );
  });

  function fmtEndsIn(iso: string): string {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return iso;
    const diff = t - Date.now();
    if (diff <= 0) return "ended";
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }

  type BidMode = "immediate" | "scheduled";
  let snipeFor = $state<InboxItem | null>(null);
  let snipeMode = $state<BidMode>("scheduled");
  let snipeAmount = $state("");
  let snipeBuffer = $state("30");
  let snipeSubmitting = $state(false);
  let snipeError = $state<string | null>(null);
  let snipeQuote = $state<QuoteState | null>(null);

  async function fetchQuote(id: string): Promise<QuoteState> {
    try {
      const q = await api.get<ShippingQuote>(`/api/items/${id}/shipping-quote`);
      return { status: "ok", quote: q };
    } catch (err) {
      if (handleUnauthorized(err)) return { status: "error", message: "unauthorized" };
      return { status: "error", message: (err as Error).message };
    }
  }

  function fmtQuote(q: QuoteState | null | undefined): string {
    if (!q) return "S&H: —";
    if (q.status === "loading") return "S&H: …";
    if (q.status === "error") return "S&H: err";
    const { quote } = q;
    if (quote.source === "no-address") return "S&H: set address in Config";
    if (quote.source === "flat") return `S&H: $${quote.total.toFixed(2)} (flat)`;
    return `S&H: $${quote.total.toFixed(2)} = ship $${quote.shipping.toFixed(2)} + handling $${quote.handling.toFixed(2)}`;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const qs = new URLSearchParams({
        status: tab,
        sort: sortKey,
        dir: sortDir,
      });
      items = await api.get<InboxItem[]>(`/api/inbox?${qs}`);
      selected = new Set();
      live = {};
      void refreshLive();
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function refreshLive() {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return;
    liveLoading = true;
    try {
      const data = await api.post<Record<string, InboxLiveEntry>>(
        "/api/inbox/live",
        { ids },
      );
      live = data;
    } catch (err) {
      if (!handleUnauthorized(err)) {
        console.warn("live refresh failed", err);
      }
    } finally {
      liveLoading = false;
    }
  }

  onMount(() => {
    void load();
    const t = setInterval(() => (nowTick = Date.now()), 30_000);
    return () => clearInterval(t);
  });
  $effect(() => {
    void tab;
    void sortKey;
    void sortDir;
    void load();
  });

  function pickSort(key: SortKey) {
    if (key === sortKey) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir =
        SORT_OPTIONS.find((o) => o.value === key)?.defaultDir ?? "desc";
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  async function bulk(action: "read" | "unread" | "delete" | "restore") {
    if (selected.size === 0) return;
    try {
      await api.post("/api/inbox/bulk", {
        ids: Array.from(selected),
        action,
      });
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    }
  }

  async function loadQuote(id: string) {
    if (quotes[id] && quotes[id].status !== "error") return;
    quotes[id] = { status: "loading" };
    quotes[id] = await fetchQuote(id);
  }

  function openSnipe(item: InboxItem) {
    snipeFor = item;
    const livePrice = live[item.id]?.currentPrice ?? item.currentPrice;
    snipeAmount = String(livePrice + 1);
    snipeBuffer = "30";
    snipeMode = "scheduled";
    snipeError = null;
    snipeQuote = quotes[item.id] ?? { status: "loading" };
    if (!quotes[item.id] || quotes[item.id]?.status === "error") {
      void fetchQuote(item.id).then((q) => {
        snipeQuote = q;
        quotes[item.id] = q;
      });
    }
  }

  async function submitSnipe(e: Event) {
    e.preventDefault();
    if (!snipeFor) return;
    snipeSubmitting = true;
    snipeError = null;
    try {
      const payload: Record<string, unknown> = {
        itemId: snipeFor.id,
        title: snipeFor.title,
        endTime: snipeFor.endTime,
        mode: snipeMode,
      };
      if (snipeMode === "scheduled") {
        payload.maxBid = Number(snipeAmount);
        payload.snipingBufferSeconds = Number(snipeBuffer);
      } else {
        payload.amount = Number(snipeAmount);
      }
      await api.post("/api/snipers", payload);
      snipeFor = null;
    } catch (err) {
      if (!handleUnauthorized(err)) snipeError = (err as Error).message;
    } finally {
      snipeSubmitting = false;
    }
  }

  function itemUrl(id: string) {
    return `https://shopgoodwill.com/item/${id}`;
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold tracking-tight">Inbox</h2>
    <div class="flex gap-1 text-sm">
      {#each ["unread", "read", "deleted"] as t}
        <button
          type="button"
          class="px-3 py-1 rounded {tab === t
            ? 'bg-slate-800 text-slate-100'
            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'}"
          onclick={() => (tab = t as Tab)}
        >
          {t}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-1 text-xs">
    <span class="text-slate-500 mr-1">Sort:</span>
    {#each SORT_OPTIONS as opt}
      <button
        type="button"
        class="px-2 py-1 rounded {sortKey === opt.value
          ? 'bg-slate-800 text-slate-100'
          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'}"
        onclick={() => pickSort(opt.value)}
      >
        {opt.label}
        {#if sortKey === opt.value}
          <span class="text-slate-400">{sortDir === "asc" ? "↑" : "↓"}</span>
        {/if}
      </button>
    {/each}
    <span class="ml-auto flex items-center gap-2 text-slate-500">
      <label class="flex items-center gap-1 cursor-pointer text-slate-400 hover:text-slate-100">
        <input
          type="checkbox"
          bind:checked={showEnded}
          class="rounded border-slate-700 bg-slate-950"
        />
        Show ended
      </label>
      {#if liveLoading}
        <span>refreshing…</span>
      {/if}
      <button
        type="button"
        class="rounded px-2 py-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 disabled:opacity-40"
        disabled={liveLoading || items.length === 0}
        onclick={() => refreshLive()}
      >
        Refresh
      </button>
    </span>
  </div>

  {#if selected.size > 0}
    <div
      class="flex items-center gap-2 text-xs rounded bg-slate-900 border border-slate-800 px-3 py-2"
    >
      <span class="text-slate-300">{selected.size} selected</span>
      {#if tab !== "read"}
        <button
          class="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1"
          onclick={() => bulk("read")}>Mark read</button
        >
      {/if}
      {#if tab !== "unread"}
        <button
          class="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1"
          onclick={() => bulk("unread")}>Mark unread</button
        >
      {/if}
      {#if tab !== "deleted"}
        <button
          class="rounded bg-rose-900/60 hover:bg-rose-900 px-2 py-1 text-rose-100"
          onclick={() => bulk("delete")}>Delete</button
        >
      {:else}
        <button
          class="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1"
          onclick={() => bulk("restore")}>Restore</button
        >
      {/if}
    </div>
  {/if}

  {#if error}
    <div
      class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200"
    >
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-slate-400 text-sm">Loading…</div>
  {:else if displayItems.length === 0}
    <div
      class="rounded border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm"
    >
      Nothing here yet.
    </div>
  {:else}
    <ul class="divide-y divide-slate-800 rounded border border-slate-800 bg-slate-900/40">
      {#each displayItems as item (item.id)}
        {@const l = live[item.id]}
        {@const price = l?.currentPrice ?? item.currentPrice}
        {@const endsAt = l?.endTime ?? item.endTime}
        <li class="flex items-center gap-4 px-3 py-3">
          <input
            type="checkbox"
            checked={selected.has(item.id)}
            onchange={() => toggle(item.id)}
            class="rounded border-slate-700 bg-slate-950"
          />
          {#if item.imageUrl}
            <img
              src={item.imageUrl.startsWith("http")
                ? item.imageUrl
                : `https://shopgoodwill.com/images/products/${item.imageUrl}`}
              alt=""
              class="h-14 w-14 rounded object-cover bg-slate-800"
              loading="lazy"
            />
          {:else}
            <div class="h-14 w-14 rounded bg-slate-800"></div>
          {/if}
          <div class="flex-1 min-w-0">
            <a
              href={itemUrl(item.id)}
              target="_blank"
              rel="noopener"
              class="block truncate text-sm text-slate-100 hover:text-emerald-300"
              >{item.title}</a
            >
            <div class="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
              <span class={l?.currentPrice !== undefined ? "text-slate-200" : ""}
                >${price.toFixed(2)}</span
              >
              {#if l?.bidCount !== undefined}
                <span>· {l.bidCount} bid{l.bidCount === 1 ? "" : "s"}</span>
              {/if}
              <span>· ends in {fmtEndsIn(endsAt)}</span>
              {#if l?.error}
                <span class="text-rose-400" title={l.error}>· live: err</span>
              {/if}
              <span>·
                {#if quotes[item.id]}
                  <span class="text-slate-300">{fmtQuote(quotes[item.id])}</span>
                {:else}
                  <button
                    type="button"
                    class="text-slate-400 hover:text-emerald-300 underline decoration-dotted"
                    onclick={() => loadQuote(item.id)}
                  >
                    S&amp;H →
                  </button>
                {/if}
              </span>
            </div>
          </div>
          <button
            class="text-xs rounded bg-emerald-500/90 hover:bg-emerald-400 px-2 py-1 text-slate-950 font-medium"
            onclick={() => openSnipe(item)}
          >
            Bid
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if snipeFor}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
  >
    <form
      onsubmit={submitSnipe}
      class="w-full max-w-md space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5"
    >
      <h3 class="text-sm font-semibold">Place bid</h3>
      <p class="text-xs text-slate-400 truncate">{snipeFor.title}</p>
      {#if snipeQuote}
        <div class="rounded bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
          {fmtQuote(snipeQuote)}
          {#if snipeQuote.status === "ok" && Number(snipeAmount) > 0}
            <div class="text-slate-500 mt-0.5">
              If won at ${Number(snipeAmount).toFixed(2)}: ${(Number(snipeAmount) + snipeQuote.quote.total).toFixed(2)} total
            </div>
          {/if}
        </div>
      {/if}
      <div class="flex gap-1 text-xs rounded bg-slate-950 border border-slate-800 p-1">
        {#each [{ id: "scheduled", label: "Schedule snipe" }, { id: "immediate", label: "Bid immediately" }] as opt}
          <button
            type="button"
            class="flex-1 px-2 py-1 rounded {snipeMode === opt.id
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-100'}"
            onclick={() => (snipeMode = opt.id as BidMode)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">
          {snipeMode === "immediate" ? "Bid amount ($)" : "Max bid ($)"}
        </span>
        <input
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          type="number"
          step="0.01"
          bind:value={snipeAmount}
          required
        />
      </label>
      {#if snipeMode === "scheduled"}
        <label class="block text-sm">
          <span class="text-xs font-medium text-slate-300">
            Buffer before end (seconds)
          </span>
          <input
            class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            type="number"
            min="5"
            max="600"
            bind:value={snipeBuffer}
            required
          />
        </label>
      {/if}
      {#if snipeError}
        <div
          class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200"
        >
          {snipeError}
        </div>
      {/if}
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100"
          onclick={() => (snipeFor = null)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={snipeSubmitting}
          class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {snipeSubmitting
            ? "Placing…"
            : snipeMode === "immediate"
              ? "Bid now"
              : "Schedule"}
        </button>
      </div>
    </form>
  </div>
{/if}
