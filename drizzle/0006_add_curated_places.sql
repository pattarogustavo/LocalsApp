CREATE TYPE "public"."curated_destination_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."curated_destination_tier" AS ENUM('mega', 'large', 'medium', 'small');--> statement-breakpoint
CREATE TYPE "public"."curated_place_category" AS ENUM('attraction', 'restaurant', 'cafe', 'museum', 'hidden_gem', 'other');--> statement-breakpoint
CREATE TYPE "public"."curated_place_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."curated_place_last_check" AS ENUM('ok', 'closed', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."curated_place_price_tier" AS ENUM('budget', 'moderate', 'luxury');--> statement-breakpoint
CREATE TYPE "public"."curated_place_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."curated_place_status" AS ENUM('pending', 'approved', 'rejected', 'closed');--> statement-breakpoint
CREATE TABLE "curated_destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"nameEn" text NOT NULL,
	"namePt" text NOT NULL,
	"country" text NOT NULL,
	"countryCode" varchar(2) NOT NULL,
	"tier" "curated_destination_tier" NOT NULL,
	"googlePlaceId" varchar(255),
	"status" "curated_destination_status" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"lastGeneratedAt" timestamp,
	"lastVerifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "curated_destinations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "curated_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"destinationId" integer NOT NULL,
	"destinationSlug" varchar(64) NOT NULL,
	"googlePlaceId" varchar(255) NOT NULL,
	"aiName" text NOT NULL,
	"aiNeighborhood" text,
	"aiNote" text,
	"category" "curated_place_category" NOT NULL,
	"tags" jsonb,
	"priceTier" "curated_place_price_tier",
	"meals" jsonb,
	"cuisine" text,
	"confidence" "curated_place_confidence" DEFAULT 'medium' NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"status" "curated_place_status" DEFAULT 'pending' NOT NULL,
	"source" "curated_place_source" DEFAULT 'ai' NOT NULL,
	"descriptions" jsonb,
	"verifiedAt" timestamp,
	"lastCheck" "curated_place_last_check",
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "curated_places_destinationId_googlePlaceId_unique" UNIQUE("destinationId","googlePlaceId")
);
--> statement-breakpoint
ALTER TABLE "curated_destinations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "curated_places" ENABLE ROW LEVEL SECURITY;
