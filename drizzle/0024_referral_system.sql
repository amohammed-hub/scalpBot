ALTER TABLE `app_users` ADD `referralCode` varchar(12);--> statement-breakpoint
ALTER TABLE `app_users` ADD `referredBy` varchar(12);--> statement-breakpoint
ALTER TABLE `app_users` ADD `extraBotSlots` int DEFAULT 0;--> statement-breakpoint
CREATE TABLE `referrals` (
`id` int AUTO_INCREMENT NOT NULL,
`referrerMobile` varchar(15) NOT NULL,
`refereeMobile` varchar(15) NOT NULL,
`referralCode` varchar(12) NOT NULL,
`rewardGranted` boolean NOT NULL DEFAULT false,
`createdAt` timestamp NOT NULL DEFAULT (now()),
CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
