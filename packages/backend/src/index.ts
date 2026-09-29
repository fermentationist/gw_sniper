import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env, isProd } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { configRoutes } from "./routes/config.js";
import { inboxRoutes } from "./routes/inbox.js";
import { itemRoutes } from "./routes/items.js";
import { searchRoutes } from "./routes/searches.js";
import { sniperRoutes } from "./routes/snipers.js";
import { startCronManager } from "./lib/cronManager.js";
import { startSniperEngine } from "./lib/sniperEngine.js";

const app = new Hono();

app.use("*", logger());
if (!isProd) {
  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      credentials: true,
    }),
  );
}

app.get("/api/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

app.route("/api/auth", authRoutes);
app.route("/api/config", configRoutes);
app.route("/api/searches", searchRoutes);
app.route("/api/inbox", inboxRoutes);
app.route("/api/items", itemRoutes);
app.route("/api/snipers", sniperRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: "internal_error", message: err.message }, 500);
});

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`gw_sniper backend listening on http://localhost:${port}`);
});

startCronManager().catch((err) => {
  console.error("[cron] startup failed", err);
});
startSniperEngine().catch((err) => {
  console.error("[sniper] startup failed", err);
});
