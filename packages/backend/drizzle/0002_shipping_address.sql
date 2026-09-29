-- Store the destination address used for CalculateShipping quotes. Only
-- country + zip are strictly required by the site; the rest are kept so the
-- UI can show the user which address is configured.
ALTER TABLE `app_config` ADD COLUMN `shipping_name` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `shipping_street` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `shipping_city` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `shipping_state` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `shipping_zip` text;--> statement-breakpoint
ALTER TABLE `app_config` ADD COLUMN `shipping_country` text;
