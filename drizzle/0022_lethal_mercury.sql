CREATE TABLE `admin_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(128) NOT NULL,
	`settingValue` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_settings_settingKey_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `alert_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`templateType` enum('entry','exit','daily_summary','critical') NOT NULL,
	`template` text NOT NULL,
	`isActive` tinyint NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `alert_templates_templateType_unique` UNIQUE(`templateType`)
);
--> statement-breakpoint
CREATE TABLE `broadcast_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message` text NOT NULL,
	`audience` enum('all','paid','free','specific') NOT NULL DEFAULT 'all',
	`specificTarget` varchar(255),
	`status` enum('draft','sent','scheduled','failed') NOT NULL DEFAULT 'draft',
	`scheduledAt` timestamp,
	`sentAt` timestamp,
	`sentCount` int DEFAULT 0,
	`failedCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `broadcast_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(255) NOT NULL,
	`tradeEntry` tinyint NOT NULL DEFAULT 1,
	`tradeExit` tinyint NOT NULL DEFAULT 1,
	`dailySummary` tinyint NOT NULL DEFAULT 1,
	`criticalAlerts` tinyint NOT NULL DEFAULT 1,
	`announcements` tinyint NOT NULL DEFAULT 1,
	`adminOverride` tinyint NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_preferences_sessionToken_unique` UNIQUE(`sessionToken`)
);
