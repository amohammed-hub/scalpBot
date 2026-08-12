ALTER TABLE `bot_sessions` ADD `sessionSpecialLayersEnabled` boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `sessionLayersRequireWhitelist` boolean DEFAULT true;
