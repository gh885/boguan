DROP INDEX `posts_visible_published_idx`;--> statement-breakpoint
CREATE INDEX `posts_visible_published_idx` ON `posts` (`is_visible`,`duplicate_of_id`,`published_at`,`id`);