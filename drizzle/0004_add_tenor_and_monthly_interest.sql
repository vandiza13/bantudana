ALTER TABLE `loans` ADD `tenor_months` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `loans` ADD `interest_percent` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `loans` ADD `monthly_payment` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `loans` ADD `total_interest` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `loans` ADD `start_date` text;
--> statement-breakpoint
UPDATE `loans` SET `interest_percent` = `fee_percent`, `total_interest` = CAST(ROUND(`principal` * `fee_percent` / 100.0) AS INTEGER), `monthly_payment` = `total_due`, `tenor_months` = 1;
