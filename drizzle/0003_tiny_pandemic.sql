ALTER TABLE `trade_log` MODIFY COLUMN `exitReason` varchar(64);--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `instrumentLabel` varchar(128) DEFAULT 'Reliance Industries';--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `stopLossMultiplier` float DEFAULT 1.5;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `targetMultiplier` float DEFAULT 3;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `trailingSlEnabled` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `trailingSlPct` float DEFAULT 0.5;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `minConfidence` float DEFAULT 60;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `scanIntervalSec` int DEFAULT 60;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `lastPrice` float DEFAULT 0;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `bidPrice` float DEFAULT 0;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `askPrice` float DEFAULT 0;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `nextScanAt` bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE `trade_log` ADD `symbolLabel` varchar(128);