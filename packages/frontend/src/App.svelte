<script lang="ts">
  import { onMount } from "svelte";
  import { parseRoute, navigate, type Route } from "./lib/router.js";
  import {
    session,
    checkSession,
    logout,
  } from "./lib/session.svelte.js";
  import Login from "./routes/Login.svelte";
  import Inbox from "./routes/Inbox.svelte";
  import Bids from "./routes/Bids.svelte";
  import Searches from "./routes/Searches.svelte";
  import Config from "./routes/Config.svelte";

  let route = $state<Route>(parseRoute(window.location.hash));

  onMount(() => {
    void checkSession();
    const onHash = () => {
      route = parseRoute(window.location.hash);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  });

  const tabs: { id: Route; label: string }[] = [
    { id: "inbox", label: "Inbox" },
    { id: "bids", label: "Bids" },
    { id: "searches", label: "Searches" },
    { id: "config", label: "Config" },
  ];
</script>

{#if session.loading}
  <div class="flex min-h-screen items-center justify-center text-slate-400">
    Loading…
  </div>
{:else if !session.authenticated}
  <Login />
{:else}
  <div class="min-h-screen flex flex-col">
    <header
      class="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-3 flex items-center gap-6"
    >
      <div class="font-semibold tracking-tight text-slate-100">
        <span class="text-emerald-400">GW</span>-Sniper
      </div>
      <nav class="flex gap-1">
        {#each tabs as tab}
          <button
            type="button"
            class="px-3 py-1.5 rounded text-sm font-medium transition
              {route === tab.id
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'}"
            onclick={() => navigate(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </nav>
      <div class="ml-auto">
        <button
          type="button"
          class="text-sm text-slate-400 hover:text-slate-200"
          onclick={() => logout()}
        >
          Log out
        </button>
      </div>
    </header>
    <main class="flex-1 p-6 max-w-6xl w-full mx-auto">
      {#if route === "inbox"}
        <Inbox />
      {:else if route === "bids"}
        <Bids />
      {:else if route === "searches"}
        <Searches />
      {:else if route === "config"}
        <Config />
      {/if}
    </main>
  </div>
{/if}
