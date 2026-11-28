CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_en` text,
	`homepage` text,
	`logo_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_unique` ON `companies` (`slug`);--> statement-breakpoint
CREATE TABLE `crawl_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`stage` text NOT NULL,
	`url` text NOT NULL,
	`status` integer,
	`message` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `crawl_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_failures_run_idx` ON `crawl_failures` (`run_id`);--> statement-breakpoint
CREATE TABLE `crawl_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mode` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`sources` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`mode` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`not_modified` integer DEFAULT 0 NOT NULL,
	`listed` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`unchanged` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `crawl_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_runs_source_idx` ON `crawl_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `http_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`etag` text,
	`last_modified` text,
	`checked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post_tags` (
	`post_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`origin` text DEFAULT 'rule' NOT NULL,
	PRIMARY KEY(`post_id`, `tag_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_tags_tag_idx` ON `post_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`lang` text DEFAULT 'zh-CN' NOT NULL,
	`author` text,
	`published_at` text,
	`published_at_raw` text,
	`published_year` integer,
	`cover_url` text,
	`content_hash` text NOT NULL,
	`duplicate_of_id` integer,
	`is_visible` integer DEFAULT true NOT NULL,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`duplicate_of_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "posts_summary_length" CHECK(length("posts"."summary") <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_canonical_url_unique` ON `posts` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `posts_published_idx` ON `posts` (`published_at`);--> statement-breakpoint
CREATE INDEX `posts_year_idx` ON `posts` (`published_year`);--> statement-breakpoint
CREATE INDEX `posts_company_published_idx` ON `posts` (`company_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_source_idx` ON `posts` (`source_id`);--> statement-breakpoint
CREATE INDEX `posts_company_title_norm_idx` ON `posts` (`company_id`,`title_norm`);--> statement-breakpoint
CREATE INDEX `posts_visible_published_idx` ON `posts` (`is_visible`,`duplicate_of_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`list_url` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`lang` text DEFAULT 'zh-CN' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`watermark_at` text,
	`blocked_at` text,
	`blocked_reason` text,
	`last_run_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_slug_unique` ON `sources` (`slug`);--> statement-breakpoint
CREATE INDEX `sources_company_idx` ON `sources` (`company_id`);--> statement-breakpoint
CREATE INDEX `sources_enabled_idx` ON `sources` (`enabled`);--> statement-breakpoint
CREATE TABLE `tag_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raw` text NOT NULL,
	`tag_id` integer NOT NULL,
	`source` text DEFAULT 'auto' NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_aliases_raw_unique` ON `tag_aliases` (`raw`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);