ALTER TABLE `trade_log` ADD `partialBooked` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `trade_log` ADD `bookedQty` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `trade_log` ADD `bookedPnl` float DEFAULT 0;
