CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `generations` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `title` text;--> statement-breakpoint
CREATE INDEX `generations_project_idx` ON `generations` (`project_id`,`created_at`,`id`);