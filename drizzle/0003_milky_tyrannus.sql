ALTER TYPE "public"."trip_share_status" ADD VALUE 'declined';--> statement-breakpoint
ALTER TABLE "trip_shares" ADD COLUMN "hiddenByInvitee" boolean DEFAULT false NOT NULL;