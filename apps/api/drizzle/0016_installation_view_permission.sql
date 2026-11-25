-- Reading installation reports becomes a permission, so an admin can hide them from agents.
-- Admins, agents and viewers keep seeing them (engineers see their own part as before).
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'installation.view') WHERE `key` IN ('admin', 'agent', 'viewer') AND NOT JSON_CONTAINS(`permissions`, '"installation.view"');
