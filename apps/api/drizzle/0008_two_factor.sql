ALTER TABLE `organizations` ADD `require_two_factor` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_users` ADD `totp_secret` varchar(255);--> statement-breakpoint
ALTER TABLE `platform_users` ADD `totp_enabled_at` datetime(3);--> statement-breakpoint
ALTER TABLE `platform_users` ADD `totp_last_step` int;--> statement-breakpoint
ALTER TABLE `platform_users` ADD `totp_recovery_codes` json;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `totp_last_step` int;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_recovery_codes` json;