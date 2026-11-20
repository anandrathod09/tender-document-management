CREATE TABLE `import_profiles` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`columns` json NOT NULL,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `import_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `import_profiles_org_name_uq` UNIQUE(`organization_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `import_profiles` ADD CONSTRAINT `import_profiles_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_profiles` ADD CONSTRAINT `import_profiles_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;