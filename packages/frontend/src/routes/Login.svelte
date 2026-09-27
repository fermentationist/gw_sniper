<script lang="ts">
  import { login } from "../lib/session.svelte.js";

  let password = $state("");
  let error = $state<string | null>(null);
  let submitting = $state(false);

  async function onSubmit(e: Event) {
    e.preventDefault();
    error = null;
    submitting = true;
    try {
      await login(password);
    } catch (err) {
      error = err instanceof Error ? err.message : "Login failed";
    } finally {
      submitting = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center px-4">
  <form
    onsubmit={onSubmit}
    class="w-full max-w-sm space-y-5 rounded-xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg"
  >
    <div>
      <h1 class="text-lg font-semibold tracking-tight text-slate-100">
        <span class="text-emerald-400">GW</span>-Sniper
      </h1>
      <p class="mt-1 text-sm text-slate-400">
        Enter the dashboard password to continue.
      </p>
    </div>
    <div class="space-y-2">
      <label for="pw" class="block text-xs font-medium text-slate-300"
        >Password</label
      >
      <input
        id="pw"
        type="password"
        bind:value={password}
        autocomplete="current-password"
        class="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
        required
      />
    </div>
    {#if error}
      <div
        class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200"
      >
        {error}
      </div>
    {/if}
    <button
      type="submit"
      disabled={submitting}
      class="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
    >
      {submitting ? "Signing in…" : "Sign in"}
    </button>
  </form>
</div>
