import { integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trial", "active", "expired", "cancelled"]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["monthly", "annual"]);
export const tripShareRoleEnum = pgEnum("trip_share_role", ["viewer", "editor"]);
export const tripShareStatusEnum = pgEnum("trip_share_status", ["pending", "accepted", "revoked"]);

/**
 * Core user table backing auth flow.
 * Extended with trial + subscription fields for monetization.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Supabase Auth user UUID. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),

  // ── Trial & Subscription ────────────────────────────────────────────────────
  trialStartedAt: timestamp("trialStartedAt"),
  trialEndsAt: timestamp("trialEndsAt"),
  subscriptionStatus: subscriptionStatusEnum("subscriptionStatus").default("trial"),
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
  token: varchar("token", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type TripShare = typeof tripShares.$inferSelect;
export type InsertTripShare = typeof tripShares.$inferInsert;
