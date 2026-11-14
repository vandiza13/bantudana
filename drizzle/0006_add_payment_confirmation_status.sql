ALTER TABLE `payments` ADD COLUMN `status` text DEFAULT 'dikonfirmasi' NOT NULL;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `submitted_by_account_id` integer REFERENCES `accounts`(`id`);
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `decided_at` integer;
