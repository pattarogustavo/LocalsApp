CREATE TABLE `trip_shares` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tripId` int NOT NULL,
	`ownerId` int NOT NULL,
	`inviteeEmail` varchar(320) NOT NULL,
	`inviteeUserId` int,
	`role` enum('viewer','editor') NOT NULL DEFAULT 'viewer',
	`status` enum('pending','accepted','revoked') NOT NULL DEFAULT 'pending',
	`token` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trip_shares_id` PRIMARY KEY(`id`),
	CONSTRAINT `trip_shares_token_unique` UNIQUE(`token`)
);
