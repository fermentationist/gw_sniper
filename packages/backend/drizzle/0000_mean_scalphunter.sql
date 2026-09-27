CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`goodwill_username` text,
	`encrypted_goodwill_password` text,
	`cached_token` text,
	`token_expires_at` text,
	`notification_email` text,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_pass` text,
	`global_email_alerts_enabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `item_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`current_price` real NOT NULL,
	`end_time` text NOT NULL,
	`image_url` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`discovered_at` text DEFAULT CURRENT_TIMESTAMP,
	`discovered_by_search_id` text
);
--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query_string` text,
	`category_id` text,
	`min_price` real,
	`max_price` real,
	`exclude_pickup_only` integer DEFAULT false,
	`cron_schedule` text NOT NULL,
	`email_alerts_enabled` integer DEFAULT true,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `sniper_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`max_bid` real NOT NULL,
	`sniping_buffer_seconds` integer DEFAULT 30 NOT NULL,
	`end_time` text NOT NULL,
	`job_status` text DEFAULT 'scheduled' NOT NULL,
	`last_checked_price` real,
	`last_result_message` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
