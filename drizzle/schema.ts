import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "expired", "cancelled"]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["monthly", "annual"]);
export const tripShareRoleEnum = pgEnum("trip_share_role", ["viewer", "editor"]);
export const tripShareStatusEnum = pgEnum("trip_share_status", ["pending", "accepted", "revoked", "declined"]);

export const curatedDestinationTierEnum = pgEnum("curated_destination_tier", ["mega", "large", "medium", "small"]);
export const curatedDestinationStatusEnum = pgEnum("curated_destination_status", ["active", "inactive"]);
export const curatedPlaceCategoryEnum = pgEnum("curated_place_category", [
  "attraction",
  "restaurant",
  "cafe",
  "museum",
  "hidden_gem",
  "other",
  "park",
  "beach",
  "market",
  "neighborhood",
]);
export const curatedPlacePriceTierEnum = pgEnum("curated_place_price_tier", ["budget", "moderate", "luxury"]);
export const curatedPlaceConfidenceEnum = pgEnum("curated_place_confidence", ["high", "medium", "low"]);
export const curatedPlaceStatusEnum = pgEnum("curated_place_status", ["pending", "approved", "rejected", "closed"]);
export const curatedPlaceSourceEnum = pgEnum("curated_place_source", ["ai", "manual"]);
export const curatedPlaceLastCheckEnum = pgEnum("curated_place_last_check", ["ok", "closed", "not_found"]);

/**
 * Core user table backing auth flow.
 * Extended with subscription fields for monetization.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Supabase Auth user UUID. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  bio: text("bio"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),

  // ── Subscription ─────────────────────────────────────────────────────────
  subscriptionStatus: subscriptionStatusEnum("subscriptionStatus"),
  subscriptionPlan: subscriptionPlanEnum("subscriptionPlan"),
  subscriptionExpiresAt: timestamp("subscriptionExpiresAt"),
  revenuecatUserId: varchar("revenuecatUserId", { length: 128 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Trips table — stores the full Trip JSON blob per user.
 * One row per trip. The `data` column holds the serialized Trip object.
 */
export const trips = pgTable("trips", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Client-side UUID (Trip.id) used to match local and remote records. */
  clientId: varchar("clientId", { length: 64 }).notNull(),
  /** Full Trip JSON serialized as text. */
  data: text("data").notNull(),
  /** Language code (e.g. "pt", "en") the trip's textual content (name, Info tab, place descriptions) is currently written in. */
  contentLanguage: varchar("contentLanguage", { length: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type TripRow = typeof trips.$inferSelect;
export type InsertTripRow = typeof trips.$inferInsert;

/**
 * Trip shares table — tracks who has been invited to access a trip.
 */
export const tripShares = pgTable("trip_shares", {
  id: serial("id").primaryKey(),
  tripId: integer("tripId").notNull(),
  ownerId: integer("ownerId").notNull(),
  inviteeEmail: varchar("inviteeEmail", { length: 320 }).notNull(),
  inviteeUserId: integer("inviteeUserId"),
  role: tripShareRoleEnum("role").default("viewer").notNull(),
  status: tripShareStatusEnum("status").default("pending").notNull(),
  /** True when the invitee has "deleted" the trip on their side. Doesn't affect the owner or other invitees. */
  hiddenByInvitee: boolean("hiddenByInvitee").default(false).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type TripShare = typeof tripShares.$inferSelect;
export type InsertTripShare = typeof tripShares.$inferInsert;

/**
 * Expo push tokens, one row per device. A token is reassigned to whichever
 * account most recently registered it (e.g. a shared/reinstalled device),
 * since Expo tokens are device-scoped, not account-scoped.
 */
export const pushTokens = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  platform: varchar("platform", { length: 16 }).notNull(),
  /** App language at the time of registration (e.g. "pt"), used to localize push content. */
  language: varchar("language", { length: 8 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;

/**
 * Curated catalog of destinations we generate recommended places for.
 * Holds only our own editorial metadata plus the destination's Google
 * place_id — no other Google-sourced content (name/address/photo/rating)
 * is stored here.
 */
export const curatedDestinations = pgTable("curated_destinations", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  nameEn: text("nameEn").notNull(),
  namePt: text("namePt").notNull(),
  country: text("country").notNull(),
  countryCode: varchar("countryCode", { length: 2 }).notNull(),
  tier: curatedDestinationTierEnum("tier").notNull(),
  /** Google place_id for the city/destination itself (not a place within it). */
  googlePlaceId: varchar("googlePlaceId", { length: 255 }),
  status: curatedDestinationStatusEnum("status").default("active").notNull(),
  priority: integer("priority").default(0).notNull(),
  lastGeneratedAt: timestamp("lastGeneratedAt"),
  lastVerifiedAt: timestamp("lastVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CuratedDestination = typeof curatedDestinations.$inferSelect;
export type InsertCuratedDestination = typeof curatedDestinations.$inferInsert;

/**
 * Curated places within a destination. Only our own editorial content
 * (name/description/tags/etc. as suggested by our AI) plus the place's
 * Google place_id is stored — never Google's own name, address, hours,
 * photo, rating or coordinates (see CURATION rule in scripts/curate-destinations.ts).
 */
export const curatedPlaces = pgTable("curated_places", {
  id: serial("id").primaryKey(),
  destinationId: integer("destinationId").notNull(),
  /** Copy of curatedDestinations.slug, denormalized for filtering in the review panel. */
  destinationSlug: varchar("destinationSlug", { length: 64 }).notNull(),
  googlePlaceId: varchar("googlePlaceId", { length: 255 }).notNull(),
  /** Name as suggested by our AI — our own content, not Google's official name. */
  aiName: text("aiName").notNull(),
  aiNeighborhood: text("aiNeighborhood"),
  /** Short justification for why this place was curated. */
  aiNote: text("aiNote"),
  category: curatedPlaceCategoryEnum("category").notNull(),
  /** Subset of: culture, gastronomy, nature, adventure, shopping, relaxation, nightlife, art. */
  tags: jsonb("tags").$type<string[]>(),
  /** Only set for restaurants/cafes — our own price estimate, not Google's price_level. */
  priceTier: curatedPlacePriceTierEnum("priceTier"),
  /** Subset of: breakfast, lunch, dinner, snack. */
  meals: jsonb("meals").$type<string[]>(),
  cuisine: text("cuisine"),
  confidence: curatedPlaceConfidenceEnum("confidence").default("medium").notNull(),
  rank: integer("rank").default(0).notNull(),
  status: curatedPlaceStatusEnum("status").default("pending").notNull(),
  source: curatedPlaceSourceEnum("source").default("ai").notNull(),
  /** Original descriptions per language: { pt, en, es, fr, de, it }. */
  descriptions: jsonb("descriptions").$type<Partial<Record<"pt" | "en" | "es" | "fr" | "de" | "it", string>>>(),
  verifiedAt: timestamp("verifiedAt"),
  lastCheck: curatedPlaceLastCheckEnum("lastCheck"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  unique().on(table.destinationId, table.googlePlaceId),
]);

export type CuratedPlace = typeof curatedPlaces.$inferSelect;
export type InsertCuratedPlace = typeof curatedPlaces.$inferInsert;
