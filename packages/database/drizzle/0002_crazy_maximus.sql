ALTER TABLE `posts` ADD `reading_minutes` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `has_code` integer;--> statement-breakpoint
CREATE INDEX `posts_code_idx` ON `posts` (`has_code`);