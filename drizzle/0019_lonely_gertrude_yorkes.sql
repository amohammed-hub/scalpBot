ALTER TABLE `bot_sessions` ADD `averagingEnabled` boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `averagingLossThreshold` float DEFAULT 0.2;