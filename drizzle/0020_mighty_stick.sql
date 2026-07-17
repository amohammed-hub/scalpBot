CREATE TABLE `access_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userMobile` varchar(15),
	`userEmail` varchar(320),
	`userName` varchar(128),
	`plan` enum('monthly','quarterly','half_yearly','yearly','custom') NOT NULL,
	`durationDays` int NOT NULL,
	`startsAt` timestamp NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`status` enum('active','expired','revoked') NOT NULL DEFAULT 'active',
	`note` text,
	`grantedBy` varchar(128) NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `access_grants_id` PRIMARY KEY(`id`)
);
