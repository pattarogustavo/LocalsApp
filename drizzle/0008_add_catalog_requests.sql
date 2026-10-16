CREATE TABLE "catalog_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"destinationNormalized" varchar(255) NOT NULL,
	"destinationName" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"language" varchar(8),
	"count" integer DEFAULT 1 NOT NULL,
	"firstRequestedAt" timestamp DEFAULT now() NOT NULL,
	"lastRequestedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_requests_destinationNormalized_country_unique" UNIQUE("destinationNormalized","country")
);
--> statement-breakpoint
ALTER TABLE "catalog_requests" ENABLE ROW LEVEL SECURITY;
