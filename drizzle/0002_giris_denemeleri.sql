CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_key_idx` ON `auth_attempts` (`key`,`created_at`);