ALTER TABLE `tenders` ADD `deadline_missed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `workflow_stages` ADD `agent_next` json;--> statement-breakpoint
ALTER TABLE `workflow_stages` ADD `manager_next` json;
--> statement-breakpoint
-- Move rules of the original TMS for the default stages; own stages: agents none, admins any.
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY('watchlist', 'rejected') WHERE `key` = 'new';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY('new', 'rejected') WHERE `key` = 'watchlist';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY('in-progress'), `manager_next` = JSON_ARRAY() WHERE `key` = 'assigned';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY('price-review', 'criteria-review'), `manager_next` = JSON_ARRAY() WHERE `key` = 'in-progress';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY('ready-to-bid', 'not-fit') WHERE `key` = 'price-review';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY('ready-to-bid', 'not-fit') WHERE `key` = 'criteria-review';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY('submitted'), `manager_next` = JSON_ARRAY() WHERE `key` = 'ready-to-bid';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY('under-query', 'won', 'lost'), `manager_next` = JSON_ARRAY() WHERE `key` = 'submitted';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY('won', 'lost'), `manager_next` = JSON_ARRAY() WHERE `key` = 'under-query';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY('assigned-to-engineer') WHERE `key` = 'won';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY() WHERE `key` = 'lost';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY('completed') WHERE `key` = 'assigned-to-engineer';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY() WHERE `key` = 'completed';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY() WHERE `key` = 'not-fit';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = NULL WHERE `key` = 'not-bidded';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY(), `manager_next` = JSON_ARRAY() WHERE `key` = 'rejected';--> statement-breakpoint
UPDATE `workflow_stages` SET `agent_next` = JSON_ARRAY() WHERE `agent_next` IS NULL AND `key` LIKE 'custom-%';--> statement-breakpoint
-- Tenders now in the missed-deadline stage missed it then.
UPDATE `tenders` t JOIN `workflow_stages` s ON s.`id` = t.`stage_id` SET t.`deadline_missed_at` = t.`stage_changed_at` WHERE s.`system_role` = 'missed_deadline';--> statement-breakpoint
-- Admins, engineers and viewers see Installed assets; agents only if the admin turns it on.
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'asset.view') WHERE `key` IN ('admin', 'engineer', 'viewer') AND NOT JSON_CONTAINS(`permissions`, '"asset.view"');
