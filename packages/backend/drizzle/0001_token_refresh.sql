-- Migrate app_config from password-based auth to refresh-token auth.
-- Old columns dropped: encrypted_goodwill_password, cached_token, token_expires_at.
-- New columns store an encrypted access+refresh token pair. Password is
-- exchanged for tokens once and then discarded — never persisted.
ALTER TABLE `app_config` DROP COLUMN `encrypted_goodwill_password`;--> statement-breakpoint
ALTER TABLE `app_config` DROP COLUMN `cached_token`;--> statement-breakpoint
ALTER TABLE `app_config` DROP COLUMN `token_expires_at`;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `encrypted_access_token` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `access_token_expires_at` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `encrypted_refresh_token` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `refresh_token_expires_at` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `refresh_token_created_by_ip` text;
