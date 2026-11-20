CREATE TABLE `letter_templates` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`subtitle` varchar(200),
	`addressed` boolean NOT NULL DEFAULT true,
	`date_at_top` boolean NOT NULL DEFAULT false,
	`body` json NOT NULL,
	`company_id` varchar(36),
	`is_active` boolean NOT NULL DEFAULT true,
	`based_on` varchar(40),
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `letter_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `organizations` ADD `hidden_letters` json;--> statement-breakpoint
ALTER TABLE `letter_templates` ADD CONSTRAINT `letter_templates_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `letter_templates` ADD CONSTRAINT `letter_templates_company_id_bidding_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `bidding_companies`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `letter_templates` ADD CONSTRAINT `letter_templates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `letter_templates_org_title_idx` ON `letter_templates` (`organization_id`,`title`);