ALTER TABLE "users" ALTER COLUMN "subscriptionStatus" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."subscription_status";--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'expired', 'cancelled');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "subscriptionStatus" SET DATA TYPE "public"."subscription_status" USING "subscriptionStatus"::"public"."subscription_status";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "subscriptionStatus" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "trialStartedAt";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "trialEndsAt";