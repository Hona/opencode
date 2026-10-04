-- Copy enable state only. Existing new-id rows win, and older rows and archive data stay intact.
INSERT INTO `extension` (`id`, `enabled`)
SELECT 'details', `enabled` FROM `extension` WHERE `id` = 'summary'
ON CONFLICT (`id`) DO NOTHING;
--> statement-breakpoint
INSERT INTO `extension` (`id`, `enabled`)
SELECT 'context', `enabled` FROM `extension` WHERE `id` = 'usage'
ON CONFLICT (`id`) DO NOTHING;
