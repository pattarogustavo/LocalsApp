import { haversineDistanceKm, type GeoPoint } from "./distance";
import { namesReasonablyMatch } from "./normalize";

export interface VerificationInput {
  aiName: string;
  /** Candidate's matched name from the Google result, used only for similarity — never persisted. */
  googleName: string;
  googleLocation: GeoPoint;
  /** e.g. "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" — absent for places Google doesn't track (parks, monuments). */
  businessStatus?: string;
}

export interface VerificationResult {
  accepted: boolean;
  distanceKm: number;
  reason?: "too_far" | "name_mismatch" | "closed";
}

const CLOSED_STATUSES = new Set(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]);

/**
 * Decides whether a Google Places match for an AI-proposed place should be
 * accepted: within range of the destination center, name matches reasonably
 * well, and not reported closed. A missing `businessStatus` (parks,
 * monuments, viewpoints) is treated as acceptable — Google doesn't track
 * open/closed state for those.
 */
export function verifyCandidate(input: VerificationInput, center: GeoPoint, maxDistanceKm: number): VerificationResult {
  const distanceKm = haversineDistanceKm(input.googleLocation, center);

  if (input.businessStatus && CLOSED_STATUSES.has(input.businessStatus)) {
    return { accepted: false, distanceKm, reason: "closed" };
  }
  if (distanceKm > maxDistanceKm) {
    return { accepted: false, distanceKm, reason: "too_far" };
  }
  if (!namesReasonablyMatch(input.aiName, input.googleName)) {
    return { accepted: false, distanceKm, reason: "name_mismatch" };
  }
  return { accepted: true, distanceKm };
}

// ─── place_id / types acceptance ────────────────────────────────────────────

/**
 * A query combining two places with "&" (e.g. "Hyde Park & Kensington
 * Gardens") makes Google interpret it as a street intersection rather than
 * either place — Google then returns an address-shaped place_id ("Ej...")
 * for the crossing, not a "ChIJ.../GhIJ..." id for a real place. These
 * reasons drive both the discard log and the per-destination report.
 */
export type PlaceIdRejectionReason = "address_id" | "address_type" | "id_too_long";

export const MAX_PLACE_ID_LENGTH = 250;

/** Real Google Places ids; "Ej..." and other shapes are addresses/intersections, not places. */
const REAL_PLACE_ID_PATTERN = /^(ChIJ|GhIJ)[A-Za-z0-9_-]{20,}$/;

/** A result typed ONLY as one (or more) of these is an address/intersection, never a standalone place. */
const ADDRESS_ONLY_TYPES = new Set(["route", "intersection", "street_address", "premise", "subpremise", "postal_code", "plus_code"]);

/** Allowed as a standalone result only for group D (bairros/passeios) — rejected as a single result for every other group. */
const NEIGHBORHOOD_TYPES = new Set(["neighborhood", "sublocality"]);

export interface PlaceIdCheckResult {
  accepted: boolean;
  reason?: PlaceIdRejectionReason;
}

/**
 * Rejects a Google match whose place_id/types reveal it's an address or
 * intersection rather than the searched-for place (see module doc above).
 * `allowNeighborhood` should be true only for group D candidates, where a
 * neighborhood/sublocality result is a legitimate match.
 */
export function checkPlaceIdAndTypes(placeId: string, types: string[], allowNeighborhood: boolean): PlaceIdCheckResult {
  if (placeId.length > MAX_PLACE_ID_LENGTH) return { accepted: false, reason: "id_too_long" };
  if (!REAL_PLACE_ID_PATTERN.test(placeId)) return { accepted: false, reason: "address_id" };
  if (types.length > 0 && types.every((t) => ADDRESS_ONLY_TYPES.has(t))) return { accepted: false, reason: "address_type" };
  if (!allowNeighborhood && types.some((t) => NEIGHBORHOOD_TYPES.has(t))) return { accepted: false, reason: "address_type" };
  return { accepted: true };
}

// ─── discard reason counters (for the generate report) ────────────────────

export interface DiscardReasonCounts {
  addressId: number;
  addressType: number;
  idTooLong: number;
  nameMismatch: number;
}

export function newDiscardReasonCounts(): DiscardReasonCounts {
  return { addressId: 0, addressType: 0, idTooLong: 0, nameMismatch: 0 };
}

const PLACE_ID_REASON_FIELD: Record<PlaceIdRejectionReason, keyof DiscardReasonCounts> = {
  address_id: "addressId",
  address_type: "addressType",
  id_too_long: "idTooLong",
};

export function trackPlaceIdRejection(counts: DiscardReasonCounts, reason: PlaceIdRejectionReason): void {
  counts[PLACE_ID_REASON_FIELD[reason]] += 1;
}

export function trackNameMismatch(counts: DiscardReasonCounts): void {
  counts.nameMismatch += 1;
}

/** Tolerates undefined/null for either argument (treated as zero) — a checkpoint saved before a field existed can still hand one in. */
export function addDiscardReasonCounts(a: DiscardReasonCounts | null | undefined, b: DiscardReasonCounts | null | undefined): DiscardReasonCounts {
  return {
    addressId: (a?.addressId ?? 0) + (b?.addressId ?? 0),
    addressType: (a?.addressType ?? 0) + (b?.addressType ?? 0),
    idTooLong: (a?.idTooLong ?? 0) + (b?.idTooLong ?? 0),
    nameMismatch: (a?.nameMismatch ?? 0) + (b?.nameMismatch ?? 0),
  };
}

export function formatDiscardReasonCounts(counts: DiscardReasonCounts): string {
  return `id de endereço=${counts.addressId} tipo de endereço=${counts.addressType} id muito longo=${counts.idTooLong} nome não confere=${counts.nameMismatch}`;
}
