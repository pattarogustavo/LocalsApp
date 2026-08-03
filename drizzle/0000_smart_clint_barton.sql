CREATE TYPE "public"."subscription_plan" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trip_share_role" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."trip_share_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "trip_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"tripId" integer NOT NULL,
	"ownerId" integer NOT NULL,
	"inviteeEmail" varchar(320) NOT NULL,
	"inviteeUserId" integer,
	"role" "trip_share_role" DEFAULT 'viewer' NOT NULL,
	"status" "trip_share_status" DEFAULT 'pending' NOT NULL,
	"token" varchar(64) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trip_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"clientId" varchar(64) NOT NULL,
	"data" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"trialStartedAt" timestamp,
	"trialEndsAt" timestamp,
	"subscriptionStatus" "subscription_status" DEFAULT 'trial',
	"subscriptionPlan" "subscription_plan",
	"subscriptionExpiresAt" timestamp,
	"revenuecatUserId" varchar(128),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
