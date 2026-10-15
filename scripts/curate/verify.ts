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
