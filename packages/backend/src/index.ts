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
import { readFile } from "fs/promises";

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
// in production, serve the frontend from the backend
if (isProd) {
  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = new URL(`../../frontend/dist${path}`, import.meta.url);
    try {
      const file = await readFile(filePath, { encoding: "utf-8" });
      let contentType = "application/octet-stream";
      switch (true) {
        case path.endsWith(".html"):
          contentType = "text/html";
          break;
        case path.endsWith(".js"):
          contentType = "text/javascript";
          break;
        case path.endsWith(".css"):
          contentType = "text/css";
          break;
        case path.endsWith(".json"):
          contentType = "application/json";
          break;
        case path.endsWith(".png"):
          contentType = "image/png";
          break;
        case path.endsWith(".jpg") || path.endsWith(".jpeg"):
          contentType = "image/jpeg";
          break;
        case path.endsWith(".svg"):
          contentType = "image/svg+xml";
          break;
      }
      return c.body(file, 200, {
        "Content-Type": contentType,
      });
    } catch (err) {
      console.error("[frontend] failed to serve", filePath, err);
      return c.json({ error: "not_found" }, 404);
    }
  });
}

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
