CREATE TABLE `installation_consignees` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`report_id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`designation` varchar(120),
	`phone` varchar(30),
	`email` varchar(254),
	`fax` varchar(30),
	`engineer_id` varchar(36),
	`status` enum('assigned','site_visit','design','execution','completed') NOT NULL DEFAULT 'assigned',
	`call_aligned_date` date,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `installation_consignees_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `installation_reports` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`tender_id` varchar(36) NOT NULL,
	`bidding_company_id` varchar(36),
	`po_number` varchar(100),
	`po_date` date,
	`report_date` date,
	`customer_name` varchar(200),
	`customer_address` text,
	`state_office` varchar(200),
	`contact_person_name` varchar(120),
	`contact_person_designation` varchar(120),
	`contact_person_phone` varchar(30),
	`department` varchar(200),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `installation_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `installation_reports_tender_uq` UNIQUE(`organization_id`,`tender_id`)
);
--> statement-breakpoint
CREATE TABLE `installed_assets` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`consignee_id` varchar(36) NOT NULL,
	`tender_id` varchar(36) NOT NULL,
	`item_name` varchar(500) NOT NULL,
	`make_model` varchar(200),
	`serial_number` varchar(100),
	`monitor_serial` varchar(100),
	`cpu_serial` varchar(100),
	`install_status` enum('installed','not_installed','pending') NOT NULL DEFAULT 'pending',
	`installed_on` date,
	`warranty_months` int NOT NULL DEFAULT 0,
	`remarks` varchar(500),
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `installed_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_tickets` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`number` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`type` enum('complaint','query','suggestion','appreciation') NOT NULL DEFAULT 'complaint',
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`status` enum('new','assigned_to_oem','in_progress','resolved','closed','reopened') NOT NULL DEFAULT 'new',
	`tender_id` varchar(36),
	`asset_id` varchar(36),
	`customer_name` varchar(200),
	`contact_name` varchar(120),
	`contact_phone` varchar(30),
	`contact_email` varchar(254),
	`assigned_to` varchar(36),
	`oem_reference` varchar(100),
	`resolution_notes` text,
	`resolved_at` datetime(3),
	`satisfaction` int,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `service_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `service_tickets_org_number_uq` UNIQUE(`organization_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `ticket_updates` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`ticket_id` varchar(36) NOT NULL,
	`status` enum('new','assigned_to_oem','in_progress','resolved','closed','reopened'),
	`note` text,
	`user_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ticket_updates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `installation_consignees` ADD CONSTRAINT `installation_consignees_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_consignees` ADD CONSTRAINT `installation_consignees_report_id_installation_reports_id_fk` FOREIGN KEY (`report_id`) REFERENCES `installation_reports`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_consignees` ADD CONSTRAINT `installation_consignees_engineer_id_users_id_fk` FOREIGN KEY (`engineer_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_reports` ADD CONSTRAINT `installation_reports_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_reports` ADD CONSTRAINT `installation_reports_tender_id_tenders_id_fk` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_reports` ADD CONSTRAINT `installation_reports_bidding_company_id_bidding_companies_id_fk` FOREIGN KEY (`bidding_company_id`) REFERENCES `bidding_companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_reports` ADD CONSTRAINT `installation_reports_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installed_assets` ADD CONSTRAINT `installed_assets_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installed_assets` ADD CONSTRAINT `installed_assets_consignee_id_installation_consignees_id_fk` FOREIGN KEY (`consignee_id`) REFERENCES `installation_consignees`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installed_assets` ADD CONSTRAINT `installed_assets_tender_id_tenders_id_fk` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_tickets` ADD CONSTRAINT `service_tickets_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_tickets` ADD CONSTRAINT `service_tickets_tender_id_tenders_id_fk` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_tickets` ADD CONSTRAINT `service_tickets_asset_id_installed_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `installed_assets`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_tickets` ADD CONSTRAINT `service_tickets_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `service_tickets` ADD CONSTRAINT `service_tickets_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_updates` ADD CONSTRAINT `ticket_updates_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_updates` ADD CONSTRAINT `ticket_updates_ticket_id_service_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `service_tickets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_updates` ADD CONSTRAINT `ticket_updates_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `installation_consignees_report_idx` ON `installation_consignees` (`organization_id`,`report_id`);--> statement-breakpoint
CREATE INDEX `installation_consignees_engineer_idx` ON `installation_consignees` (`organization_id`,`engineer_id`);--> statement-breakpoint
CREATE INDEX `installed_assets_tender_idx` ON `installed_assets` (`organization_id`,`tender_id`);--> statement-breakpoint
CREATE INDEX `installed_assets_consignee_idx` ON `installed_assets` (`organization_id`,`consignee_id`);--> statement-breakpoint
CREATE INDEX `installed_assets_serial_idx` ON `installed_assets` (`organization_id`,`serial_number`);--> statement-breakpoint
CREATE INDEX `service_tickets_org_status_idx` ON `service_tickets` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `service_tickets_org_asset_idx` ON `service_tickets` (`organization_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `ticket_updates_ticket_idx` ON `ticket_updates` (`organization_id`,`ticket_id`,`created_at`);