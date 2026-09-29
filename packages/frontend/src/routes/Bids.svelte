<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ShippingQuote, type SniperJob } from "../lib/api.js";
  import { handleUnauthorized } from "../lib/session.svelte.js";

  type Mode = "immediate" | "scheduled";
  type QuoteState =
    | { status: "loading" }
    | { status: "ok"; quote: ShippingQuote }
    | { status: "error"; message: string };

  let rows = $state<SniperJob[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let quotes = $state<Record<string, QuoteState>>({});

  let showCreate = $state(false);
  let submitting = $state(false);
  let formError = $state<string | null>(null);
  let form = $state({
    itemId: "",
    amount: "",
    snipingBufferSeconds: "30",
    mode: "scheduled" as Mode,
  });
  let formQuote = $state<QuoteState | null>(null);

  let editing = $state<SniperJob | null>(null);
  let editMax = $state("");
  let editBuffer = $state("30");
  let editQuote = $state<QuoteState | null>(null);

  async function fetchQuote(itemId: string): Promise<QuoteState> {
    try {
      const q = await api.get<ShippingQuote>(`/api/items/${itemId}/shipping-quote`);
      return { status: "ok", quote: q };
    } catch (err) {
      if (handleUnauthorized(err)) return { status: "error", message: "unauthorized" };
      return { status: "error", message: (err as Error).message };
    }
  }

  async function loadQuoteForRow(id: string) {
    if (quotes[id]) return;
    quotes[id] = { status: "loading" };
    quotes[id] = await fetchQuote(id);
  }

  async function load() {
    loading = true;
    try {
      rows = await api.get<SniperJob[]>("/api/snipers");
      for (const row of rows) void loadQuoteForRow(row.id);
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  });

  async function loadFormQuote() {
    const id = form.itemId.trim();
    if (!id) {
      formQuote = null;
      return;
    }
    formQuote = { status: "loading" };
    formQuote = await fetchQuote(id);
  }

  async function createJob(e: Event) {
    e.preventDefault();
    submitting = true;
    formError = null;
    try {
      const payload: Record<string, unknown> = {
        itemId: form.itemId,
        mode: form.mode,
      };
      if (form.mode === "scheduled") {
        payload.maxBid = Number(form.amount);
        payload.snipingBufferSeconds = Number(form.snipingBufferSeconds);
      } else {
        payload.amount = Number(form.amount);
      }
      await api.post("/api/snipers", payload);
      showCreate = false;
      form = {
        itemId: "",
        amount: "",
        snipingBufferSeconds: "30",
        mode: "scheduled",
      };
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) formError = (err as Error).message;
    } finally {
      submitting = false;
    }
  }

  function openEdit(row: SniperJob) {
    editing = row;
    editMax = row.maxBid.toString();
    editBuffer = row.snipingBufferSeconds.toString();
    editQuote = quotes[row.id] ?? null;
    if (!editQuote) {
      editQuote = { status: "loading" };
      void fetchQuote(row.id).then((q) => (editQuote = q));
    }
  }

  async function saveEdit(e: Event) {
    e.preventDefault();
    if (!editing) return;
    try {
      await api.put(`/api/snipers/${editing.id}`, {
        maxBid: Number(editMax),
        snipingBufferSeconds: Number(editBuffer),
      });
      editing = null;
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) alert((err as Error).message);
    }
  }

  async function remove(row: SniperJob) {
    if (!confirm(`Remove bid entry for "${row.title}"?`)) return;
    try {
      await api.delete(`/api/snipers/${row.id}`);
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    }
  }

  function fmtQuote(q: QuoteState | null | undefined): string {
    if (!q) return "S&H: —";
    if (q.status === "loading") return "S&H: …";
    if (q.status === "error") return `S&H: err`;
    const { quote } = q;
    if (quote.source === "no-address") return "S&H: set address in Config";
    if (quote.source === "flat") {
      return `S&H: $${quote.total.toFixed(2)} (flat)`;
    }
    return `S&H: $${quote.total.toFixed(2)} = ship $${quote.shipping.toFixed(2)} + handling $${quote.handling.toFixed(2)}`;
  }

  function totalWithBid(bid: number, q: QuoteState | null | undefined): string {
    if (!q || q.status !== "ok") return `$${bid.toFixed(2)}`;
    return `$${(bid + q.quote.total).toFixed(2)}`;
  }

  function statusTone(s: SniperJob["jobStatus"]): string {
    switch (s) {
      case "scheduled":
        return "bg-emerald-950/60 text-emerald-200 border-emerald-800";
      case "executed":
        return "bg-sky-950/60 text-sky-200 border-sky-800";
      case "outbid":
        return "bg-amber-950/60 text-amber-200 border-amber-800";
      case "failed":
        return "bg-rose-950/60 text-rose-200 border-rose-800";
      default:
        return "bg-slate-800 text-slate-300 border-slate-700";
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold tracking-tight">Bids</h2>
    <button
      class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400"
      onclick={() => (showCreate = true)}
    >
      + Add by item ID
    </button>
  </div>

  {#if error}
    <div class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-slate-400 text-sm">Loading…</div>
  {:else if rows.length === 0}
    <div class="rounded border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm">
      No bids yet. Bid immediately or schedule a snipe from the inbox or by item ID.
    </div>
  {:else}
    <ul class="divide-y divide-slate-800 rounded border border-slate-800 bg-slate-900/40">
      {#each rows as row (row.id)}
        <li class="px-4 py-3 flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <a
                href={`https://shopgoodwill.com/item/${row.id}`}
                target="_blank"
                rel="noopener"
                class="font-medium text-slate-100 hover:text-emerald-300 truncate"
              >
                {row.title}
              </a>
              <span class="text-[10px] uppercase tracking-wide rounded border px-1.5 py-0.5 {statusTone(row.jobStatus)}">
                {row.jobStatus}
              </span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">
              max ${row.maxBid.toFixed(2)} · buffer {row.snipingBufferSeconds}s · ends {row.endTime}
              {#if row.lastCheckedPrice != null} · last ${row.lastCheckedPrice.toFixed(2)}{/if}
            </div>
            <div class="text-xs text-slate-500 mt-0.5">
              {fmtQuote(quotes[row.id])}
              {#if quotes[row.id]?.status === "ok"}
                · if won: {totalWithBid(row.maxBid, quotes[row.id])}
              {/if}
            </div>
            {#if row.lastResultMessage}
              <div class="text-xs text-slate-500 mt-0.5 truncate">{row.lastResultMessage}</div>
            {/if}
          </div>
          {#if row.jobStatus === "scheduled" || row.jobStatus === "outbid"}
            <button class="text-xs text-slate-300 hover:text-slate-100" onclick={() => openEdit(row)}>Edit</button>
          {/if}
          <button class="text-xs text-rose-300 hover:text-rose-200" onclick={() => remove(row)}>Remove</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if showCreate}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
    <form onsubmit={createJob} class="w-full max-w-md space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h3 class="text-sm font-semibold">Add bid by item ID</h3>
      <div class="flex gap-1 text-xs rounded bg-slate-950 border border-slate-800 p-1">
        {#each [{ id: "scheduled", label: "Schedule snipe" }, { id: "immediate", label: "Bid immediately" }] as opt}
          <button
            type="button"
            class="flex-1 px-2 py-1 rounded {form.mode === opt.id
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-100'}"
            onclick={() => (form.mode = opt.id as Mode)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">ShopGoodwill item ID</span>
        <input
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          bind:value={form.itemId}
          onblur={loadFormQuote}
          required
        />
      </label>
      {#if formQuote}
        <div class="rounded bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
          {fmtQuote(formQuote)}
          {#if formQuote.status === "ok" && Number(form.amount) > 0}
            <div class="text-slate-500 mt-0.5">
              If won at max: {totalWithBid(Number(form.amount), formQuote)}
            </div>
          {/if}
        </div>
      {/if}
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">
          {form.mode === "immediate" ? "Bid amount ($)" : "Max bid ($)"}
        </span>
        <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="number" step="0.01" bind:value={form.amount} required />
      </label>
      {#if form.mode === "scheduled"}
        <label class="block text-sm">
          <span class="text-xs font-medium text-slate-300">Buffer before end (seconds)</span>
          <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="number" min="5" max="600" bind:value={form.snipingBufferSeconds} required />
        </label>
      {/if}
      {#if formError}
        <div class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200">
          {formError}
        </div>
      {/if}
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100" onclick={() => (showCreate = false)}>Cancel</button>
        <button type="submit" disabled={submitting} class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
          {submitting
            ? "Placing…"
            : form.mode === "immediate"
              ? "Bid now"
              : "Schedule"}
        </button>
      </div>
    </form>
  </div>
{/if}

{#if editing}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
    <form onsubmit={saveEdit} class="w-full max-w-md space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h3 class="text-sm font-semibold">Edit snipe</h3>
      <p class="text-xs text-slate-400 truncate">{editing.title}</p>
      {#if editQuote}
        <div class="rounded bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
          {fmtQuote(editQuote)}
          {#if editQuote.status === "ok" && Number(editMax) > 0}
            <div class="text-slate-500 mt-0.5">
              If won at max: {totalWithBid(Number(editMax), editQuote)}
            </div>
          {/if}
        </div>
      {/if}
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">Max bid ($)</span>
        <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="number" step="0.01" bind:value={editMax} required />
      </label>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">Buffer before end (seconds)</span>
        <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="number" min="5" max="600" bind:value={editBuffer} required />
      </label>
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100" onclick={() => (editing = null)}>Cancel</button>
        <button type="submit" class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400">Save</button>
      </div>
    </form>
  </div>
{/if}
