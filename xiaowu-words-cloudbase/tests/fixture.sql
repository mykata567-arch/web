CREATE TABLE `access_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wordbooks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`invite_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wordbooks_owner` ON `wordbooks` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wordbooks_invite` ON `wordbooks` (`invite_hash`);