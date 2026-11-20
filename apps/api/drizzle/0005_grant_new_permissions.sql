-- Clients created before phase 4 get the new permissions on their default
-- Admin and Engineer roles, matching what new clients receive.
UPDATE `roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'installation.manage')
WHERE `key` IN ('admin', 'engineer')
  AND `is_system` = true
  AND NOT JSON_CONTAINS(`permissions`, '"installation.manage"');
--> statement-breakpoint
UPDATE `roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'ticket.manage')
WHERE `key` IN ('admin', 'engineer')
  AND `is_system` = true
  AND NOT JSON_CONTAINS(`permissions`, '"ticket.manage"');
