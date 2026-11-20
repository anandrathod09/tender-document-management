CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`actor_type` enum('user','platform','system') NOT NULL,
	`actor_id` varchar(36),
	`action` varchar(100) NOT NULL,
	`entity` varchar(50) NOT NULL,
	`entity_id` varchar(36),
	`details` json,
	`ip` varchar(45),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(63) NOT NULL,
	`name` varchar(200) NOT NULL,
	`status` enum('trial','active','suspended','closed') NOT NULL DEFAULT 'trial',
	`plan_id` varchar(36) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`settings` json,
	`trial_ends_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` varchar(36) NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(100) NOT NULL,
	`max_users` int NOT NULL,
	`max_storage_gb` int NOT NULL,
	`max_tenders_per_month` int NOT NULL,
	`price_monthly_inr` int,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `platform_users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`name` varchar(120) NOT NULL,
	`password_hash` varchar(100) NOT NULL,
	`role` enum('owner','support') NOT NULL DEFAULT 'owner',
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`token_version` int NOT NULL DEFAULT 0,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `platform_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` varchar(36) NOT NULL,
	`realm` enum('tenant','platform') NOT NULL,
	`subject_id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`user_agent` varchar(255),
	`ip` varchar(45),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`key` varchar(50) NOT NULL,
	`name` varchar(100) NOT NULL,
	`permissions` json NOT NULL,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_org_key_uq` UNIQUE(`organization_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`name` varchar(120) NOT NULL,
	`password_hash` varchar(100),
	`role_id` varchar(36) NOT NULL,
	`status` enum('invited','active','suspended') NOT NULL DEFAULT 'invited',
	`token_version` int NOT NULL DEFAULT 0,
	`invite_token_hash` varchar(64),
	`invite_expires_at` datetime(3),
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_org_email_uq` UNIQUE(`organization_id`,`email`),
	CONSTRAINT `users_invite_token_uq` UNIQUE(`invite_token_hash`)
);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organizations` ADD CONSTRAINT `organizations_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_org_created_idx` ON `audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_subject_idx` ON `refresh_tokens` (`realm`,`subject_id`);--> statement-breakpoint
CREATE INDEX `users_org_status_idx` ON `users` (`organization_id`,`status`);