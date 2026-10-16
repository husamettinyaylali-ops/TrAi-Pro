ALTER TABLE `generations` ADD `status` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `job` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `charges` text;--> statement-breakpoint
CREATE INDEX `generations_status_idx` ON `generations` (`status`);