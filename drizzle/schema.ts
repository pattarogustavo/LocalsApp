import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with trial + subscription fields for monetization.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Supabase Auth user UUID. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),

  // ── Trial & Subscription ────────────────────────────────────────────────────
  trialStartedAt: timestamp("trialStartedAt"),
  trialEndsAt: timestamp("trialEndsAt"),
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["trial", "active", "expired", "cancelled"]).default("trial"),
  subscriptionPlan: mysqlEnum("subscriptionPlan", ["monthly", "annual"]),
  subscriptionExpiresAt: timestamp("subscriptionExpiresAt"),
  revenuecatUserId: varchar("revenuecatUserId", { length: 128 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Trips table — stores the full Trip JSON blob per user.
 * One row per trip. The `data` column holds the serialized Trip object.
 */
export const trips = mysqlTable("trips", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Client-side UUID (Trip.id) used to match local and remote records. */
  clientId: varchar("clientId", { length: 64 }).notNull(),
  /** Full Trip JSON serialized as text. */
  data: text("data").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TripRow = typeof trips.$inferSelect;
export type InsertTripRow = typeof trips.$inferInsert;

/**
 * Trip shares table — tracks who has been invited to access a trip.
 */
export const tripShares = mysqlTable("trip_shares", {
  id: int("id").autoincrement().primaryKey(),
  tripId: int("tripId").notNull(),
  ownerId: int("ownerId").notNull(),
  inviteeEmail: varchar("inviteeEmail", { length: 320 }).notNull(),
  inviteeUserId: int("inviteeUserId"),
  role: mysqlEnum("role", ["viewer", "editor"]).default("viewer").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "revoked"]).default("pending").notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TripShare = typeof tripShares.$inferSelect;
export type InsertTripShare = typeof tripShares.$inferInsert;
