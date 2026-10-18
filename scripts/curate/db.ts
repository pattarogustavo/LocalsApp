import { and, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  curatedDestinations,
  curatedPlaces,
  type CuratedDestination,
  type CuratedPlace,
  type InsertCuratedDestination,
  type InsertCuratedPlace,
} from "../../drizzle/schema";

export type CurateDb = ReturnType<typeof drizzle>;

let _db: CurateDb | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

/** Lazily connects using DATABASE_URL. This script writes ONLY to the curated_* tables. */
export function getCurateDb(): CurateDb {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to run curate-destinations");
    _sql = postgres(connectionString, { max: 1 });
    _db = drizzle(_sql);
  }
  return _db;
}

export async function closeCurateDb(): Promise<void> {
  await _sql?.end();
  _db = null;
  _sql = null;
}

/** Masks a connection string's host for the confirmation prompt, e.g. "postgres://***:***@db.***.supabase.co/***". */
export function maskDatabaseHost(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    const masked = host.replace(/^[^.]+/, (first) => first.slice(0, 2) + "***");
    return `${url.protocol}//${masked}${url.port ? ":" + url.port : ""}`;
  } catch {
    return "(unparseable connection string)";
  }
}

/** Aborts with a clear message instead of failing obscurely if the curated_* tables don't exist yet (migration not applied). */
export async function assertCuratedTablesExist(db: CurateDb): Promise<void> {
  try {
    await db.select({ id: curatedDestinations.id }).from(curatedDestinations).limit(1);
    await db.select({ id: curatedPlaces.id }).from(curatedPlaces).limit(1);
  } catch (err) {
    throw new Error(
      "curated_destinations/curated_places tables not found. Run the drizzle migration " +
        "(drizzle/0006_add_curated_places.sql) against this database before running curate-destinations.\n" +
        `Original error: ${(err as Error).message}`,
    );
  }
}

const ROLLBACK_SENTINEL = Symbol("preflight-rollback");

/**
 * curate:check preflight: inserts a throwaway destination + place inside a
 * transaction, then always rolls it back — proving the schema/writes work
 * without leaving anything behind. Returns true only if the insert actually
 * succeeded before the rollback.
 */
export async function runPreflightWriteCheck(db: CurateDb): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [destination] = await tx
        .insert(curatedDestinations)
        .values({
          slug: "__curate_preflight_check__",
          nameEn: "Preflight Check",
          namePt: "Checagem Preflight",
          country: "Nowhere",
          countryCode: "XX",
          tier: "small",
        })
        .returning();
      await tx.insert(curatedPlaces).values({
        destinationId: destination.id,
        destinationSlug: destination.slug,
        googlePlaceId: "__preflight_place__",
        aiName: "Preflight Place",
        category: "other",
        confidence: "low",
        status: "pending",
        source: "manual",
      });
      throw ROLLBACK_SENTINEL;
    });
  } catch (err) {
    if (err !== ROLLBACK_SENTINEL) throw err;
  }
}

export async function getDestinationBySlug(db: CurateDb, slug: string): Promise<CuratedDestination | undefined> {
  const rows = await db.select().from(curatedDestinations).where(eq(curatedDestinations.slug, slug)).limit(1);
  return rows[0];
}

/** Inserts the destination row if missing, or updates its editorial fields (never touches generated places). */
export async function upsertDestinationMeta(db: CurateDb, values: InsertCuratedDestination): Promise<CuratedDestination> {
  const existing = await getDestinationBySlug(db, values.slug);
  if (existing) {
    const [updated] = await db
      .update(curatedDestinations)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(curatedDestinations.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(curatedDestinations).values(values).returning();
  return created;
}

export async function markDestinationGenerated(db: CurateDb, destinationId: number): Promise<void> {
  await db.update(curatedDestinations).set({ lastGeneratedAt: new Date(), updatedAt: new Date() }).where(eq(curatedDestinations.id, destinationId));
}

export async function markDestinationVerified(db: CurateDb, destinationId: number): Promise<void> {
  await db.update(curatedDestinations).set({ lastVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(curatedDestinations.id, destinationId));
}

export async function getExistingPlaceIds(db: CurateDb, destinationId: number): Promise<Set<string>> {
  const rows = await db
    .select({ googlePlaceId: curatedPlaces.googlePlaceId })
    .from(curatedPlaces)
    .where(eq(curatedPlaces.destinationId, destinationId));
  return new Set(rows.map((r) => r.googlePlaceId));
}

export async function getPlacesForDestination(db: CurateDb, destinationId: number): Promise<CuratedPlace[]> {
  return db.select().from(curatedPlaces).where(eq(curatedPlaces.destinationId, destinationId));
}

export async function getApprovedPlaces(db: CurateDb, destinationId: number): Promise<CuratedPlace[]> {
  return db
    .select()
    .from(curatedPlaces)
    .where(and(eq(curatedPlaces.destinationId, destinationId), eq(curatedPlaces.status, "approved")));
}

/**
 * Inserts brand-new 'pending' rows only — never updates an existing row
 * (approved/rejected rows are frozen). Idempotent at the database level via
 * onConflictDoNothing on (destinationId, googlePlaceId), on top of the
 * app-level pre-filter (partitionNewCandidates) — so a checkpoint replay or
 * a retried insert can never duplicate or clobber a row.
 */
export async function insertPendingPlaces(db: CurateDb, rows: InsertCuratedPlace[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(curatedPlaces)
    .values(rows)
    .onConflictDoNothing({ target: [curatedPlaces.destinationId, curatedPlaces.googlePlaceId] });
}

export async function markPlacesClosed(db: CurateDb, placeIds: number[]): Promise<void> {
  if (placeIds.length === 0) return;
  await db
    .update(curatedPlaces)
    .set({ status: "closed", lastCheck: "closed", verifiedAt: new Date(), updatedAt: new Date() })
    .where(inArray(curatedPlaces.id, placeIds));
}

export async function markPlaceLastCheck(db: CurateDb, placeId: number, lastCheck: CuratedPlace["lastCheck"]): Promise<void> {
  await db
    .update(curatedPlaces)
    .set({ lastCheck, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(curatedPlaces.id, placeId));
}

export async function updatePlaceDescriptions(db: CurateDb, placeId: number, descriptions: CuratedPlace["descriptions"]): Promise<void> {
  await db.update(curatedPlaces).set({ descriptions, updatedAt: new Date() }).where(eq(curatedPlaces.id, placeId));
}

const REDESCRIBE_STATUSES: CuratedPlace["status"][] = ["approved", "pending"];

/**
 * curate:redescribe's candidate query: rows whose status is approved or
 * pending, scoped by destination slugs, by explicit ids, or (with `all`)
 * unscoped — slugs and ids combine (a union) when both are given, so
 * --only + --ids can pull in a forced row from outside the requested
 * destinations. The generic-template match itself is applied afterwards in
 * JS (see scripts/curate/redescribe-select.ts), not in this query.
 */
export async function getCandidatePlacesForRedescribe(db: CurateDb, filter: { all?: boolean; slugs?: string[]; ids?: number[] }): Promise<CuratedPlace[]> {
  const statusFilter = inArray(curatedPlaces.status, REDESCRIBE_STATUSES);
  if (filter.all) return db.select().from(curatedPlaces).where(statusFilter);

  const scopeClauses = [];
  if (filter.slugs?.length) scopeClauses.push(inArray(curatedPlaces.destinationSlug, filter.slugs));
  if (filter.ids?.length) scopeClauses.push(inArray(curatedPlaces.id, filter.ids));
  if (scopeClauses.length === 0) return [];

  const scope = scopeClauses.length === 1 ? scopeClauses[0] : or(...scopeClauses);
  return db.select().from(curatedPlaces).where(and(scope, statusFilter));
}

export async function getDestinationsByIds(db: CurateDb, ids: number[]): Promise<CuratedDestination[]> {
  if (ids.length === 0) return [];
  return db.select().from(curatedDestinations).where(inArray(curatedDestinations.id, ids));
}
