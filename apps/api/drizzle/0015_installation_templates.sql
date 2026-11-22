-- Report templates inside each consignee (as in the old TMS), consignee documents,
-- and engineers limited to their own consignees.
CREATE TABLE `installation_items` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`consignee_id` varchar(36) NOT NULL,
	`item_name` varchar(500) NOT NULL,
	`serial_type` enum('common','split') NOT NULL DEFAULT 'common',
	`warranty_months` int NOT NULL DEFAULT 0,
	`quantity` int NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `installation_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `files` MODIFY COLUMN `kind` enum('tender_document','library','company_logo','company_signature','compliance_pdf','consignee_document') NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `consignee_id` varchar(36);--> statement-breakpoint
ALTER TABLE `installed_assets` ADD `item_id` varchar(36);--> statement-breakpoint
-- Existing units: one template per consignee, item and warranty; Monitor/CPU when any unit used them.
INSERT INTO `installation_items` (`id`, `organization_id`, `consignee_id`, `item_name`, `serial_type`, `warranty_months`, `quantity`, `sort_order`)
SELECT UUID(), `organization_id`, `consignee_id`, `item_name`,
	IF(SUM(`monitor_serial` IS NOT NULL OR `cpu_serial` IS NOT NULL) > 0, 'split', 'common'),
	`warranty_months`, COUNT(*), MIN(`sort_order`)
FROM `installed_assets`
GROUP BY `organization_id`, `consignee_id`, `item_name`, `warranty_months`;--> statement-breakpoint
UPDATE `installed_assets` `a` JOIN `installation_items` `i`
	ON `i`.`consignee_id` = `a`.`consignee_id` AND `i`.`item_name` = `a`.`item_name` AND `i`.`warranty_months` = `a`.`warranty_months`
SET `a`.`item_id` = `i`.`id`;--> statement-breakpoint
ALTER TABLE `installed_assets` MODIFY COLUMN `item_id` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `installation_items` ADD CONSTRAINT `installation_items_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installation_items` ADD CONSTRAINT `installation_items_consignee_id_installation_consignees_id_fk` FOREIGN KEY (`consignee_id`) REFERENCES `installation_consignees`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `installation_items_consignee_idx` ON `installation_items` (`organization_id`,`consignee_id`);--> statement-breakpoint
ALTER TABLE `installed_assets` ADD CONSTRAINT `installed_assets_item_id_installation_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `installation_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `files_org_consignee_idx` ON `files` (`organization_id`,`consignee_id`);--> statement-breakpoint
-- Engineers now work on their own consignees only; admins can do both.
UPDATE `roles` SET `permissions` = JSON_REMOVE(`permissions`, JSON_UNQUOTE(JSON_SEARCH(`permissions`, 'one', 'installation.manage'))) WHERE `key` = 'engineer' AND JSON_CONTAINS(`permissions`, '"installation.manage"');--> statement-breakpoint
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'installation.own') WHERE `key` IN ('admin', 'engineer') AND NOT JSON_CONTAINS(`permissions`, '"installation.own"');
