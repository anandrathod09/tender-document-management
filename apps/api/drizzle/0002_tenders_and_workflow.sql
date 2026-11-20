CREATE TABLE `import_runs` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`source` varchar(30) NOT NULL,
	`uploaded_by` varchar(36) NOT NULL,
	`status` enum('completed','failed') NOT NULL,
	`created` int NOT NULL DEFAULT 0,
	`updated` int NOT NULL DEFAULT 0,
	`unchanged` int NOT NULL DEFAULT 0,
	`restored` int NOT NULL DEFAULT 0,
	`skipped` int NOT NULL DEFAULT 0,
	`issues` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `import_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tender_stage_history` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`tender_id` varchar(36) NOT NULL,
	`from_stage_id` varchar(36),
	`to_stage_id` varchar(36) NOT NULL,
	`comment` text,
	`changed_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `tender_stage_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenders` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`source` varchar(30) NOT NULL DEFAULT 'tender247',
	`source_tender_id` varchar(100),
	`reference_no` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`brief_url` text,
	`buyer_organization` varchar(255),
	`location` varchar(255),
	`estimated_cost` decimal(15,2) NOT NULL DEFAULT 0,
	`emd` decimal(15,2) NOT NULL DEFAULT 0,
	`document_fee` decimal(15,2) NOT NULL DEFAULT 0,
	`deadline` date NOT NULL,
	`sheet_type` enum('gem','non_gem') NOT NULL DEFAULT 'non_gem',
	`msme_exemption` varchar(255),
	`startup_exemption` varchar(255),
	`quantity` varchar(255),
	`eligibility_criteria` text,
	`checklist` text,
	`documents_required` text,
	`source_file` varchar(255),
	`stage_id` varchar(36) NOT NULL,
	`previous_stage_id` varchar(36),
	`stage_changed_at` datetime(3) NOT NULL,
	`assigned_agent_id` varchar(36),
	`assigned_at` datetime(3),
	`award_amount` decimal(15,2),
	`award_number` varchar(100),
	`excel_update` json,
	`excel_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenders_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenders_org_reference_uq` UNIQUE(`organization_id`,`reference_no`)
);
--> statement-breakpoint
CREATE TABLE `workflow_stages` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`key` varchar(50) NOT NULL,
	`label` varchar(60) NOT NULL,
	`default_label` varchar(60) NOT NULL,
	`type` enum('open','preparing','review','submitted','won','lost','dropped','execution','closed') NOT NULL,
	`color` enum('gray','blue','indigo','amber','teal','green','red','purple') NOT NULL DEFAULT 'gray',
	`comment_mode` enum('off','optional','required') NOT NULL DEFAULT 'optional',
	`is_visible` boolean NOT NULL DEFAULT true,
	`system_role` enum('intake','missed_deadline'),
	`sort_order` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `workflow_stages_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_stages_org_key_uq` UNIQUE(`organization_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `import_runs` ADD CONSTRAINT `import_runs_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_runs` ADD CONSTRAINT `import_runs_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tender_stage_history` ADD CONSTRAINT `tender_stage_history_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tender_stage_history` ADD CONSTRAINT `tender_stage_history_tender_id_tenders_id_fk` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tender_stage_history` ADD CONSTRAINT `tender_stage_history_from_stage_id_workflow_stages_id_fk` FOREIGN KEY (`from_stage_id`) REFERENCES `workflow_stages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tender_stage_history` ADD CONSTRAINT `tender_stage_history_to_stage_id_workflow_stages_id_fk` FOREIGN KEY (`to_stage_id`) REFERENCES `workflow_stages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tender_stage_history` ADD CONSTRAINT `tender_stage_history_changed_by_users_id_fk` FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_stage_id_workflow_stages_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `workflow_stages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_previous_stage_id_workflow_stages_id_fk` FOREIGN KEY (`previous_stage_id`) REFERENCES `workflow_stages`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenders` ADD CONSTRAINT `tenders_assigned_agent_id_users_id_fk` FOREIGN KEY (`assigned_agent_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workflow_stages` ADD CONSTRAINT `workflow_stages_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `import_runs_org_created_idx` ON `import_runs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tender_stage_history_tender_idx` ON `tender_stage_history` (`organization_id`,`tender_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tenders_org_stage_deadline_idx` ON `tenders` (`organization_id`,`stage_id`,`deadline`);--> statement-breakpoint
CREATE INDEX `tenders_org_agent_idx` ON `tenders` (`organization_id`,`assigned_agent_id`);--> statement-breakpoint
CREATE INDEX `tenders_org_deadline_idx` ON `tenders` (`organization_id`,`deadline`);--> statement-breakpoint
CREATE INDEX `tenders_org_created_idx` ON `tenders` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_stages_org_order_idx` ON `workflow_stages` (`organization_id`,`sort_order`);