-- Adding documents to tenders and making compliance letters becomes a permission.
-- Admins, agents and engineers keep doing it; viewers become read only.
UPDATE `roles` SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'tender.documents') WHERE `key` IN ('admin', 'agent', 'engineer') AND NOT JSON_CONTAINS(`permissions`, '"tender.documents"');
