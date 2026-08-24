ALTER TABLE `bot_sessions` ADD `strategyMode` varchar(8) DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `scalperMode` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `instrumentLocked` boolean DEFAULT false;