ALTER TABLE `bot_sessions` MODIFY COLUMN `mode` enum('paper','sandbox','live') NOT NULL DEFAULT 'paper';--> statement-breakpoint
ALTER TABLE `trade_log` MODIFY COLUMN `mode` enum('paper','sandbox','live') NOT NULL DEFAULT 'paper';--> statement-breakpoint
ALTER TABLE `upstox_credentials` ADD `sandboxToken` text;