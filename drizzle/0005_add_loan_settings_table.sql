CREATE TABLE `loan_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_interest_percent` real DEFAULT 2 NOT NULL,
	`default_tenor_months` integer DEFAULT 3 NOT NULL,
	`min_tenor_months` integer DEFAULT 1 NOT NULL,
	`max_tenor_months` integer DEFAULT 36 NOT NULL,
	`tenor_options` text DEFAULT '[1,3,6,12]' NOT NULL,
	`min_principal` integer DEFAULT 50000 NOT NULL,
	`max_principal` integer DEFAULT 100000000 NOT NULL,
	`nominal_options` text DEFAULT '[500000,1000000,1500000,2000000,2500000,3000000,4000000,5000000]' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
