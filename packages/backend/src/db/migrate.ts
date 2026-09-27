import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "./index.js";

migrate(db, { migrationsFolder: "./drizzle" });

// Ensure the singleton app_config row exists.
sqlite
  .prepare("INSERT OR IGNORE INTO app_config (id) VALUES (1)")
  .run();

console.log("Migrations applied.");
sqlite.close();
