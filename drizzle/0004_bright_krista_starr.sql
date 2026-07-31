DROP TABLE `password_reset_tokens`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `passwordHash`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `googleId`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `authProvider`;