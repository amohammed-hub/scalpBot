ALTER TABLE `bot_sessions` ADD `currentSl` float;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `lastTickAt` bigint DEFAULT 0;