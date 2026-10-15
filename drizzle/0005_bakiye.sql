CREATE TABLE `payment_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`pay_amount` text NOT NULL,
	`pay_currency` text NOT NULL,
	`status` text NOT NULL,
	`provider_ref` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_intents_user_idx` ON `payment_intents` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_intents_ref_idx` ON `payment_intents` (`method`,`provider_ref`);--> statement-breakpoint
CREATE TABLE `wallet_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_entries_user_idx` ON `wallet_entries` (`user_id`);