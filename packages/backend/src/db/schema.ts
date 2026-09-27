import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey().$default(() => 1),
  goodwillUsername: text("goodwill_username"),
  encryptedGoodwillPassword: text("encrypted_goodwill_password"),
  cachedToken: text("cached_token"),
  tokenExpiresAt: text("token_expires_at"),
  notificationEmail: text("notification_email"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  globalEmailAlertsEnabled: integer("global_email_alerts_enabled", {
    mode: "boolean",
  }).default(false),
});

export const savedSearches = sqliteTable("saved_searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  queryString: text("query_string"),
  categoryId: text("category_id"),
  minPrice: real("min_price"),
  maxPrice: real("max_price"),
  excludePickupOnly: integer("exclude_pickup_only", { mode: "boolean" }).default(
    false,
  ),
  cronSchedule: text("cron_schedule").notNull(),
  emailAlertsEnabled: integer("email_alerts_enabled", { mode: "boolean" })
    .default(true),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const itemInbox = sqliteTable("item_inbox", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  currentPrice: real("current_price").notNull(),
  endTime: text("end_time").notNull(),
  imageUrl: text("image_url"),
  status: text("status", { enum: ["unread", "read", "deleted"] })
    .default("unread")
    .notNull(),
  discoveredAt: text("discovered_at").default(sql`CURRENT_TIMESTAMP`),
  discoveredBySearchId: text("discovered_by_search_id"),
});

export const sniperJobs = sqliteTable("sniper_jobs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  maxBid: real("max_bid").notNull(),
  snipingBufferSeconds: integer("sniping_buffer_seconds").default(30).notNull(),
  endTime: text("end_time").notNull(),
  jobStatus: text("job_status", {
    enum: ["scheduled", "executed", "cancelled", "outbid", "failed"],
  })
    .default("scheduled")
    .notNull(),
  lastCheckedPrice: real("last_checked_price"),
  lastResultMessage: text("last_result_message"),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export type AppConfigRow = typeof appConfig.$inferSelect;
export type SavedSearchRow = typeof savedSearches.$inferSelect;
export type InboxItemRow = typeof itemInbox.$inferSelect;
export type SniperJobRow = typeof sniperJobs.$inferSelect;
