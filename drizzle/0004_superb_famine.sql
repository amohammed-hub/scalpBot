ALTER TABLE `bot_sessions` ADD `telegramBotToken` varchar(256);--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `telegramChatId` varchar(64);--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `telegramEnabled` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `bot_sessions` ADD `botSlot` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `trade_log` ADD `botSlot` int DEFAULT 0;