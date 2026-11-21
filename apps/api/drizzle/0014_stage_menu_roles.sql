ALTER TABLE `workflow_stages` ADD `menu_roles` json;
--> statement-breakpoint
-- Sidebar menus of the original TMS: agents see their bidding stages, engineers their delivery stages. Own stages: everyone.
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'viewer') WHERE `key` = 'new';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'viewer') WHERE `key` = 'watchlist';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'assigned';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'in-progress';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'price-review';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'criteria-review';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'ready-to-bid';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'submitted';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'under-query';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'won';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'lost';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'engineer', 'viewer') WHERE `key` = 'assigned-to-engineer';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'engineer', 'viewer') WHERE `key` = 'completed';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'not-fit';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'agent', 'viewer') WHERE `key` = 'not-bidded';--> statement-breakpoint
UPDATE `workflow_stages` SET `menu_roles` = JSON_ARRAY('admin', 'viewer') WHERE `key` = 'rejected';
