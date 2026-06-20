import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with trial + subscription fields for monetization.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),

  // ── Custom auth fields ──────────────────────────────────────────────────────
  /** bcrypt hash of password (null for OAuth-only users) */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** Google OAuth subject ID */
  googleId: varchar("googleId", { length: 128 }),
  /** auth provider used at registration */
  authProvider: mysqlEnum("authProvider", ["email", "google", "manus"]).default("manus"),

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
 * Password reset tokens for email-based password recovery.
 */
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

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
