CREATE TABLE `invoice_counters` (
	`financial_year` varchar(9) NOT NULL,
	`last_number` int NOT NULL DEFAULT 0,
	CONSTRAINT `invoice_counters_financial_year` PRIMARY KEY(`financial_year`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`cycle` enum('monthly','yearly') NOT NULL,
	`method` enum('razorpay','manual') NOT NULL,
	`status` enum('created','paid','failed') NOT NULL DEFAULT 'created',
	`base_amount` int NOT NULL,
	`cgst` int NOT NULL DEFAULT 0,
	`sgst` int NOT NULL DEFAULT 0,
	`igst` int NOT NULL DEFAULT 0,
	`total_amount` int NOT NULL,
	`period_start` datetime(3),
	`period_end` datetime(3),
	`razorpay_order_id` varchar(64),
	`razorpay_payment_id` varchar(64),
	`reference` varchar(100),
	`notes` varchar(500),
	`invoice_number` varchar(40),
	`bill_to` json,
	`paid_at` datetime(3),
	`created_by_user_id` varchar(36),
	`created_by_platform_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_razorpay_order_uq` UNIQUE(`razorpay_order_id`),
	CONSTRAINT `payments_invoice_uq` UNIQUE(`invoice_number`)
);
--> statement-breakpoint
ALTER TABLE `organizations` ADD `paid_until` datetime(3);--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_cycle` enum('monthly','yearly');--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_name` varchar(200);--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_address` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_gstin` varchar(15);--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_state_code` varchar(2);--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_email` varchar(254);--> statement-breakpoint
ALTER TABLE `organizations` ADD `billing_reminder_for` datetime(3);--> statement-breakpoint
ALTER TABLE `plans` ADD `price_yearly_inr` int;--> statement-breakpoint
ALTER TABLE `plans` ADD `description` varchar(255);--> statement-breakpoint
ALTER TABLE `plans` ADD `is_public` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `is_active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `sort_order` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_plan_id_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `payments_org_created_idx` ON `payments` (`organization_id`,`created_at`);