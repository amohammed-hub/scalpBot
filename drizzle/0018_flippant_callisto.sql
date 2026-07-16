CREATE TABLE `app_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mobile` varchar(15) NOT NULL,
	`name` varchar(128),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`isVerified` boolean NOT NULL DEFAULT false,
	`sessionToken` varchar(128),
	`lastLoginAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_users_mobile_unique` UNIQUE(`mobile`)
);
--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mobile` varchar(15) NOT NULL,
	`code` varchar(6) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`verified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `otp_codes_id` PRIMARY KEY(`id`)
);
