ALTER TABLE `bot_sessions` ADD `sessionToken` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_log` ADD `sessionToken` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `upstox_credentials` ADD `sessionToken` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_sessions` DROP COLUMN `userId`;--> statement-breakpoint
ALTER TABLE `trade_log` DROP COLUMN `userId`;--> statement-breakpoint
ALTER TABLE `upstox_credentials` DROP COLUMN `userId`;