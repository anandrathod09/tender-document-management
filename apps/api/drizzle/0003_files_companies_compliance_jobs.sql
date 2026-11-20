CREATE TABLE `bidding_companies` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`address` text NOT NULL,
	`gstin` varchar(20),
	`pan` varchar(15),
	`email` varchar(254),
	`phone` varchar(30),
	`signatory_name` varchar(120) NOT NULL,
	`designation` varchar(120) NOT NULL,
	`authorized_person` varchar(120),
	`authorized_person_position` varchar(120),
	`local_content_percent` varchar(10),
	`local_value_location` varchar(200),
	`logo_file_id` varchar(36),
	`signature_file_id` varchar(36),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `bidding_companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `bidding_companies_org_name_uq` UNIQUE(`organization_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `compliance_packs` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`tender_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`status` enum('queued','ready','failed') NOT NULL DEFAULT 'queued',
	`request` json NOT NULL,
	`file_id` varchar(36),
	`page_count` int,
	`warnings` json,
	`error` varchar(500),
	`requested_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	CONSTRAINT `compliance_packs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`kind` enum('tender_document','library','company_logo','company_signature','compliance_pdf') NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`title` varchar(200) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` int NOT NULL,
	`tender_id` varchar(36),
	`company_id` varchar(36),
	`uploaded_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `files_id` PRIMARY KEY(`id`),
	CONSTRAINT `files_storage_key_unique` UNIQUE(`storage_key`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`type` varchar(50) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`run_at` datetime(3) NOT NULL,
	`locked_at` datetime(3),
	`last_error` varchar(1000),
	`dedupe_key` varchar(191),
	`created_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_dedupe_key_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` varchar(50) NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` varchar(500),
	`link` varchar(255),
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` varchar(36) NOT NULL,
	`realm` enum('tenant','platform') NOT NULL,
	`subject_id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `password_resets_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_resets_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `tenders` ADD `bidding_company_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bidding_companies` ADD CONSTRAINT `bidding_companies_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `compliance_packs` ADD CONSTRAINT `compliance_packs_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `compliance_packs` ADD CONSTRAINT `compliance_packs_tender_id_tenders_id_fk` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `compliance_packs` ADD CONSTRAINT `compliance_packs_company_id_bidding_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `bidding_companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `compliance_packs` ADD CONSTRAINT `compliance_packs_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `compliance_packs` ADD CONSTRAINT `compliance_packs_requested_by_users_id_fk` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_tender_id_tenders_id_fk` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_resets` ADD CONSTRAINT `password_resets_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `compliance_packs_tender_idx` ON `compliance_packs` (`organization_id`,`tender_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_org_kind_idx` ON `files` (`organization_id`,`kind`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `files_org_tender_idx` ON `files` (`organization_id`,`tender_id`);--> statement-breakpoint
CREATE INDEX `files_deleted_idx` ON `files` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `jobs_pick_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`organization_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `password_resets_subject_idx` ON `password_resets` (`realm`,`subject_id`);--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_bidding_company_id_bidding_companies_id_fk` FOREIGN KEY (`bidding_company_id`) REFERENCES `bidding_companies`(`id`) ON DELETE no action ON UPDATE no action;