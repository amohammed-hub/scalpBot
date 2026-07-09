ALTER TABLE `bot_sessions` ADD `isIndexOptions` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `underlyingToken` varchar(128);--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `optionType` varchar(8);