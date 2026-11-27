ALTER TABLE `service_tickets` MODIFY COLUMN `created_by` varchar(36);--> statement-breakpoint
ALTER TABLE `ticket_updates` MODIFY COLUMN `user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `service_tickets` ADD `source` enum('staff','support_page') DEFAULT 'staff' NOT NULL;