<script lang="ts">
  import { onMount } from "svelte";
  import { api, type SavedSearch } from "../lib/api.js";
  import { handleUnauthorized } from "../lib/session.svelte.js";

  let rows = $state<SavedSearch[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let editing = $state<SavedSearch | null>(null);
  let showCreate = $state(false);
  let submitting = $state(false);
  let formError = $state<string | null>(null);

  let form = $state({
    name: "",
    queryString: "",
    categoryId: "",
    minPrice: "",
    maxPrice: "",
    excludePickupOnly: false,
    cronSchedule: "*/15 * * * *",
    emailAlertsEnabled: true,
    isActive: true,
  });

  async function load() {
    loading = true;
    try {
      rows = await api.get<SavedSearch[]>("/api/searches");
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openCreate() {
    editing = null;
    form = {
      name: "",
      queryString: "",
      categoryId: "",
      minPrice: "",
      maxPrice: "",
      excludePickupOnly: false,
      cronSchedule: "*/15 * * * *",
      emailAlertsEnabled: true,
      isActive: true,
    };
    formError = null;
    showCreate = true;
  }

  function openEdit(row: SavedSearch) {
    editing = row;
    form = {
      name: row.name,
      queryString: row.queryString ?? "",
      categoryId: row.categoryId ?? "",
      minPrice: row.minPrice?.toString() ?? "",
      maxPrice: row.maxPrice?.toString() ?? "",
      excludePickupOnly: row.excludePickupOnly,
      cronSchedule: row.cronSchedule,
      emailAlertsEnabled: row.emailAlertsEnabled,
      isActive: row.isActive,
    };
    formError = null;
    showCreate = true;
  }

  async function submit(e: Event) {
    e.preventDefault();
    submitting = true;
    formError = null;
    const payload: Record<string, unknown> = {
      name: form.name,
      queryString: form.queryString || null,
      categoryId: form.categoryId || null,
      minPrice: form.minPrice === "" ? null : Number(form.minPrice),
      maxPrice: form.maxPrice === "" ? null : Number(form.maxPrice),
      excludePickupOnly: form.excludePickupOnly,
      cronSchedule: form.cronSchedule,
      emailAlertsEnabled: form.emailAlertsEnabled,
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await api.put(`/api/searches/${editing.id}`, payload);
      } else {
        await api.post("/api/searches", payload);
      }
      showCreate = false;
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) formError = (err as Error).message;
    } finally {
      submitting = false;
    }
  }

  async function remove(row: SavedSearch) {
    if (!confirm(`Delete saved search "${row.name}"?`)) return;
    try {
      await api.delete(`/api/searches/${row.id}`);
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) error = (err as Error).message;
    }
  }

  async function runNow(row: SavedSearch) {
    try {
      const summary = await api.post<{ scanned: number; inserted: number; error?: string }>(
        `/api/searches/${row.id}/run`,
      );
      if (summary.error) alert(`Error: ${summary.error}`);
      else alert(`Scanned ${summary.scanned}, added ${summary.inserted}`);
    } catch (err) {
      if (!handleUnauthorized(err)) alert((err as Error).message);
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold tracking-tight">Saved searches</h2>
    <button
      class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400"
      onclick={openCreate}
    >
      + New search
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
      No saved searches yet.
    </div>
  {:else}
    <ul class="divide-y divide-slate-800 rounded border border-slate-800 bg-slate-900/40">
      {#each rows as row (row.id)}
        <li class="px-4 py-3 flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-100 truncate">{row.name}</span>
              {#if !row.isActive}
                <span class="text-[10px] uppercase tracking-wide rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  paused
                </span>
              {/if}
            </div>
            <div class="text-xs text-slate-400 mt-0.5 truncate">
              {row.queryString || "(no query)"} · cron {row.cronSchedule}
              {#if row.maxPrice != null} · ≤ ${row.maxPrice}{/if}
              {#if row.excludePickupOnly} · no-pickup-only{/if}
              {#if !row.emailAlertsEnabled} · alerts off{/if}
            </div>
          </div>
          <button class="text-xs text-slate-300 hover:text-emerald-300" onclick={() => runNow(row)}>
            Run now
          </button>
          <button class="text-xs text-slate-300 hover:text-slate-100" onclick={() => openEdit(row)}>
            Edit
          </button>
          <button class="text-xs text-rose-300 hover:text-rose-200" onclick={() => remove(row)}>
            Delete
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if showCreate}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
    <form onsubmit={submit} class="w-full max-w-lg space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h3 class="text-sm font-semibold">
        {editing ? "Edit saved search" : "New saved search"}
      </h3>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">Name</span>
        <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" bind:value={form.name} required />
      </label>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">Query text (optional)</span>
        <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" bind:value={form.queryString} />
      </label>
      <div class="grid gap-4 sm:grid-cols-3">
        <label class="block text-sm">
          <span class="text-xs font-medium text-slate-300">Category ID</span>
          <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" bind:value={form.categoryId} />
        </label>
        <label class="block text-sm">
          <span class="text-xs font-medium text-slate-300">Min $</span>
          <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="number" step="0.01" bind:value={form.minPrice} />
        </label>
        <label class="block text-sm">
          <span class="text-xs font-medium text-slate-300">Max $</span>
          <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" type="number" step="0.01" bind:value={form.maxPrice} />
        </label>
      </div>
      <label class="block text-sm">
        <span class="text-xs font-medium text-slate-300">Cron schedule</span>
        <input class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono" bind:value={form.cronSchedule} required />
        <span class="text-[11px] text-slate-500 mt-1 block">
          Standard 5-field cron, e.g. <code>*/15 * * * *</code> for every 15 minutes.
        </span>
      </label>
      <div class="flex flex-wrap gap-4 text-sm text-slate-200">
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={form.excludePickupOnly} class="rounded border-slate-700 bg-slate-950" />
          Exclude pickup-only
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={form.emailAlertsEnabled} class="rounded border-slate-700 bg-slate-950" />
          Email alerts
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={form.isActive} class="rounded border-slate-700 bg-slate-950" />
          Active
        </label>
      </div>
      {#if formError}
        <div class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200">
          {formError}
        </div>
      {/if}
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-slate-100" onclick={() => (showCreate = false)}>
          Cancel
        </button>
        <button type="submit" disabled={submitting} class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
          {submitting ? "Saving…" : editing ? "Save" : "Create"}
        </button>
      </div>
    </form>
  </div>
{/if}
