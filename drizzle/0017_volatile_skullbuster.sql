CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(128) NOT NULL,
	`plan` enum('trial','monthly','quarterly','half_yearly','yearly') NOT NULL,
	`status` enum('active','expired','cancelled') NOT NULL DEFAULT 'active',
	`razorpayOrderId` varchar(128),
	`razorpayPaymentId` varchar(128),
	`razorpaySubscriptionId` varchar(128),
	`amountPaid` int DEFAULT 0,
	`startsAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `trade_log` ADD `entryUnderlyingPrice` float;