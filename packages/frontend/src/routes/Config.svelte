<script lang="ts">
  import { onMount } from "svelte";
  import { api, type AppConfig } from "../lib/api.js";
  import { handleUnauthorized } from "../lib/session.svelte.js";

  let cfg = $state<AppConfig | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let message = $state<{ tone: "ok" | "err"; text: string } | null>(null);

  let gwLoginUsername = $state("");
  let gwLoginPassword = $state("");
  let gwLoggingIn = $state(false);
  let gwLoginError = $state<string | null>(null);

  let notificationEmail = $state("");
  let smtpHost = $state("");
  let smtpPort = $state<number | "">("");
  let smtpUser = $state("");
  let smtpPass = $state("");
  let globalEmailAlertsEnabled = $state(false);

  async function load() {
    loading = true;
    try {
      cfg = await api.get<AppConfig>("/api/config");
      gwLoginUsername = cfg.goodwillUsername ?? "";
      notificationEmail = cfg.notificationEmail ?? "";
      smtpHost = cfg.smtpHost ?? "";
      smtpPort = cfg.smtpPort ?? "";
      smtpUser = cfg.smtpUser ?? "";
      globalEmailAlertsEnabled = cfg.globalEmailAlertsEnabled;
    } catch (err) {
      if (!handleUnauthorized(err)) {
        message = { tone: "err", text: (err as Error).message };
      }
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function gwLogin(e: Event) {
    e.preventDefault();
    gwLoggingIn = true;
    gwLoginError = null;
    try {
      await api.post("/api/config/goodwill/login", {
        username: gwLoginUsername,
        password: gwLoginPassword,
      });
      gwLoginPassword = "";
      message = { tone: "ok", text: "Logged in to ShopGoodwill." };
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) {
        gwLoginError = (err as Error).message;
      }
    } finally {
      gwLoggingIn = false;
    }
  }

  async function gwLogout() {
    if (!confirm("Clear the stored ShopGoodwill tokens?")) return;
    try {
      await api.post("/api/config/goodwill/logout");
      message = { tone: "ok", text: "ShopGoodwill tokens cleared." };
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) {
        message = { tone: "err", text: (err as Error).message };
      }
    }
  }

  function fmtExpiry(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const days = (d.getTime() - Date.now()) / 86400000;
    return `${d.toLocaleString()} (${days >= 0 ? `${days.toFixed(1)}d left` : "expired"})`;
  }

  async function save(e: Event) {
    e.preventDefault();
    saving = true;
    message = null;
    const payload: Record<string, unknown> = {
      notificationEmail: notificationEmail || null,
      smtpHost: smtpHost || null,
      smtpPort: smtpPort === "" ? null : Number(smtpPort),
      smtpUser: smtpUser || null,
      globalEmailAlertsEnabled,
    };
    if (smtpPass) payload.smtpPass = smtpPass;

    try {
      await api.put("/api/config", payload);
      smtpPass = "";
      message = { tone: "ok", text: "Saved." };
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) {
        message = { tone: "err", text: (err as Error).message };
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-6">
  <h2 class="text-xl font-semibold tracking-tight">Configuration</h2>

  {#if loading}
    <div class="text-slate-400 text-sm">Loading…</div>
  {:else}
    <section
      class="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-4 max-w-2xl"
    >
      <div>
        <h3 class="text-sm font-semibold text-slate-100">ShopGoodwill account</h3>
        <p class="text-xs text-slate-400 mt-0.5">
          Log in once — we exchange your password for a token pair and discard
          the password. Tokens auto-refresh; log in again if the refresh token
          expires (~30 days of inactivity).
        </p>
      </div>

      {#if cfg?.goodwillAuthenticated}
        <div class="rounded bg-slate-950 border border-slate-800 p-3 text-xs space-y-1">
          <div>
            <span class="text-slate-500">Username:</span>
            <span class="text-slate-200">{cfg.goodwillUsername}</span>
          </div>
          <div>
            <span class="text-slate-500">Access token:</span>
            <span class="text-slate-200">
              {fmtExpiry(cfg.goodwillAccessTokenExpiresAt)}
            </span>
          </div>
          <div>
            <span class="text-slate-500">Refresh token:</span>
            <span class="text-slate-200">
              {fmtExpiry(cfg.goodwillRefreshTokenExpiresAt)}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="rounded bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-200"
          onclick={gwLogout}
        >
          Clear tokens
        </button>
      {/if}

      <form onsubmit={gwLogin} class="space-y-3">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="text-xs font-medium text-slate-300">Username</span>
            <input
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              type="text"
              bind:value={gwLoginUsername}
              autocomplete="username"
              required
            />
          </label>
          <label class="block text-sm">
            <span class="text-xs font-medium text-slate-300">Password</span>
            <input
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              type="password"
              bind:value={gwLoginPassword}
              autocomplete="current-password"
              required
            />
          </label>
        </div>
        {#if gwLoginError}
          <div
            class="rounded bg-rose-950/60 border border-rose-800 px-3 py-2 text-xs text-rose-200"
          >
            {gwLoginError}
          </div>
        {/if}
        <button
          type="submit"
          disabled={gwLoggingIn}
          class="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {gwLoggingIn
            ? "Logging in…"
            : cfg?.goodwillAuthenticated
              ? "Re-authenticate"
              : "Log in"}
        </button>
      </form>
    </section>

    <form onsubmit={save} class="space-y-8 max-w-2xl">
      <section
        class="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-4"
      >
        <div>
          <h3 class="text-sm font-semibold text-slate-100">
            Email notifications
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            SMTP credentials for search digests and outbid alerts.
          </p>
        </div>
        <label class="block text-sm">
          <span class="text-xs font-medium text-slate-300">Destination email</span>
          <input
            class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            type="email"
            bind:value={notificationEmail}
          />
        </label>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="block text-sm sm:col-span-2">
            <span class="text-xs font-medium text-slate-300">SMTP host</span>
            <input
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              type="text"
              placeholder="smtp.gmail.com"
              bind:value={smtpHost}
            />
          </label>
          <label class="block text-sm">
            <span class="text-xs font-medium text-slate-300">Port</span>
            <input
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              type="number"
              placeholder="587"
              bind:value={smtpPort}
            />
          </label>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="text-xs font-medium text-slate-300">SMTP user</span>
            <input
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              type="text"
              bind:value={smtpUser}
            />
          </label>
          <label class="block text-sm">
            <span class="text-xs font-medium text-slate-300">
              SMTP password {cfg?.smtpPassSet ? "(set — leave blank to keep)" : ""}
            </span>
            <input
              class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              type="password"
              bind:value={smtpPass}
              autocomplete="new-password"
            />
          </label>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            bind:checked={globalEmailAlertsEnabled}
            class="rounded border-slate-700 bg-slate-950"
          />
          Global email alerts enabled
        </label>
      </section>

      {#if message}
        <div
          class="rounded px-3 py-2 text-xs border {message.tone === 'ok'
            ? 'border-emerald-800 bg-emerald-950/60 text-emerald-200'
            : 'border-rose-800 bg-rose-950/60 text-rose-200'}"
        >
          {message.text}
        </div>
      {/if}

      <button
        type="submit"
        disabled={saving}
        class="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  {/if}
</div>
