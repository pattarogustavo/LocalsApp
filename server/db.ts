import { and, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, InsertPasswordResetToken, passwordResetTokens, users, trips, tripShares, InsertTripRow } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByGoogleId(googleId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createEmailUser(data: {
  name: string;
  email: string;
  passwordHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const trialEnds = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  // Generate a unique openId for email users
  const openId = `email_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const result = await db.insert(users).values({
    openId,
    name: data.name,
    email: data.email,
    passwordHash: data.passwordHash,
    authProvider: "email",
    loginMethod: "email",
    trialStartedAt: now,
    trialEndsAt: trialEnds,
    subscriptionStatus: "trial",
    lastSignedIn: now,
  });
  return { insertId: (result as any)[0]?.insertId ?? 0, openId };
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function updateSubscriptionStatus(userId: number, data: {
  subscriptionStatus: "trial" | "active" | "expired" | "cancelled";
  subscriptionPlan?: "monthly" | "annual" | null;
  subscriptionExpiresAt?: Date | null;
  revenuecatUserId?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, userId));
}

// ─── Password Reset helpers ───────────────────────────────────────────────────

export async function createPasswordResetToken(userId: number, token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.insert(passwordResetTokens).values({ userId, token, expiresAt });
}

export async function getValidPasswordResetToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const now = new Date();
  const result = await db.select().from(passwordResetTokens).where(
    and(
      eq(passwordResetTokens.token, token),
      eq(passwordResetTokens.used, false),
      gt(passwordResetTokens.expiresAt, now)
    )
  ).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function markPasswordResetTokenUsed(token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.token, token));
}

// ─── Subscription helpers ─────────────────────────────────────────────────────

export async function getSubscriptionStatus(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({
    subscriptionStatus: users.subscriptionStatus,
    subscriptionPlan: users.subscriptionPlan,
    subscriptionExpiresAt: users.subscriptionExpiresAt,
    trialStartedAt: users.trialStartedAt,
    trialEndsAt: users.trialEndsAt,
    revenuecatUserId: users.revenuecatUserId,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!result.length) return null;
  const row = result[0];
  const now = new Date();

  // Auto-expire trial if time has passed
  if (row.subscriptionStatus === "trial" && row.trialEndsAt && row.trialEndsAt < now) {
    await updateSubscriptionStatus(userId, { subscriptionStatus: "expired" });
    return { ...row, subscriptionStatus: "expired" as const };
  }
  // Auto-expire active subscription if time has passed
  if (row.subscriptionStatus === "active" && row.subscriptionExpiresAt && row.subscriptionExpiresAt < now) {
    await updateSubscriptionStatus(userId, { subscriptionStatus: "expired" });
    return { ...row, subscriptionStatus: "expired" as const };
  }
  return row;
}

// ─── Trip helpers ──────────────────────────────────────────────────────────────────────────────

export async function getUserTrips(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trips).where(eq(trips.userId, userId));
}

export async function upsertTrip(userId: number, clientId: string, data: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: trips.id }).from(trips)
    .where(eq(trips.userId, userId))
    .limit(500);
  // Check if this clientId already exists for this user
  const allForUser = await db.select().from(trips).where(eq(trips.userId, userId));
  const found = allForUser.find((r) => r.clientId === clientId);
  if (found) {
    await db.update(trips).set({ data, updatedAt: new Date() }).where(eq(trips.id, found.id));
    return found.id;
  } else {
    const result = await db.insert(trips).values({ userId, clientId, data });
    return (result as unknown as { insertId: number }).insertId;
  }
}

export async function deleteTripByClientId(userId: number, clientId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allForUser = await db.select().from(trips).where(eq(trips.userId, userId));
  const found = allForUser.find((r) => r.clientId === clientId);
  if (found) {
    await db.delete(trips).where(eq(trips.id, found.id));
  }
}

// ─── Trip Sharing helpers ─────────────────────────────────────────────────────

export async function createTripShare(data: {
  tripId: number;
  ownerId: number;
  inviteeEmail: string;
  role: "viewer" | "editor";
  token: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(tripShares).values({ ...data, status: "pending" });
}

export async function getTripSharesByTripId(tripId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tripShares).where(eq(tripShares.tripId, tripId));
}

export async function getTripSharesByInviteeEmail(email: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tripShares).where(eq(tripShares.inviteeEmail, email));
}

export async function getTripShareByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(tripShares).where(eq(tripShares.token, token)).limit(1);
  return rows[0] ?? null;
}

export async function acceptTripShare(token: string, inviteeUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tripShares)
    .set({ status: "accepted", inviteeUserId, updatedAt: new Date() })
    .where(eq(tripShares.token, token));
}

export async function revokeTripShare(shareId: number, ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tripShares)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(tripShares.id, shareId));
}

export async function getSharedTripsForUser(userId: number, email: string) {
  const db = await getDb();
  if (!db) return [];
  // Get accepted shares for this user by userId or email
  const sharesByUserId = await db.select().from(tripShares)
    .where(eq(tripShares.inviteeUserId, userId));
  const sharesByEmail = await db.select().from(tripShares)
    .where(eq(tripShares.inviteeEmail, email));
  // Merge unique shares
  const allShares = [...sharesByUserId, ...sharesByEmail];
  const seen = new Set<number>();
  const uniqueShares = allShares.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return s.status === "accepted";
  });
  if (uniqueShares.length === 0) return [];
  // Fetch the actual trip data for each share
  const tripIds = uniqueShares.map((s) => s.tripId);
  const sharedTrips = await db.select().from(trips).where(inArray(trips.id, tripIds));
  return sharedTrips.map((trip) => {
    const share = uniqueShares.find((s) => s.tripId === trip.id)!;
    return { ...trip, shareRole: share.role };
  });
}
