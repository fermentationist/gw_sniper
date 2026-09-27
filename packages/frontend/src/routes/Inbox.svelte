<script lang="ts">
  import { onMount } from "svelte";
  import { api, type InboxItem } from "../lib/api.js";
  import { handleUnauthorized } from "../lib/session.svelte.js";

  type Tab = "unread" | "read" | "deleted";
  let tab = $state<Tab>("unread");
  let items = $state<InboxItem[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());

  let snipeFor = $state<InboxItem | null>(null);
  let snipeMax = $state("");
  let snipeBuffer = $state("30");
  let snipeSubmitting = $state(false);
  let snipeError = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      items = await api.get<InboxItem[]>(`/api/inbox?status=${tab}`);
      selected = new Set();
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(load);
  $effect(() => {
    void tab;
    void load();
  });

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

  function openSnipe(item: InboxItem) {
    snipeFor = item;
    snipeMax = String(item.currentPrice + 1);
    snipeBuffer = "30";
    snipeError = null;
  }

  async function submitSnipe(e: Event) {
    e.preventDefault();
    if (!snipeFor) return;
    snipeSubmitting = true;
    snipeError = null;
    try {
      await api.post("/api/snipers", {
        itemId: snipeFor.id,
        title: snipeFor.title,
        endTime: snipeFor.endTime,
        maxBid: Number(snipeMax),
        snipingBufferSeconds: Number(snipeBuffer),
      });
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
  {:else if items.length === 0}
    <div
      class="rounded border border-dashed border-slate-800 p-8 text-center text-slate-500 text-sm"
    >
      Nothing here yet.
    </div>
  {:else}
    <ul class="divide-y divide-slate-800 rounded border border-slate-800 bg-slate-900/40">
      {#each items as item (item.id)}
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
            <div class="text-xs text-slate-400 mt-0.5">
              ${item.currentPrice.toFixed(2)} · ends {item.endTime}
            </div>
          </div>
          <button
            class="text-xs rounded bg-emerald-500/90 hover:bg-emerald-400 px-2 py-1 text-slate-950 font-medium"
            onclick={() => openSnipe(item)}
          >
            Snipe
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
      <h3 class="text-sm font-semibold">Schedule snipe</h3>
      <p class="text-xs text-slate-400 truncate">{snipeFor.title}</p>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">Max bid ($)</span>
        <input
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          type="number"
          step="0.01"
          bind:value={snipeMax}
          required
        />
      </label>
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
          {snipeSubmitting ? "Saving…" : "Schedule"}
        </button>
      </div>
    </form>
  </div>
{/if}
