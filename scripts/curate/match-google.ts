import type { GeoPoint } from "./distance";
import type { GoogleMatch } from "./google";
import { verifyCandidate, checkPlaceIdAndTypes, trackPlaceIdRejection, trackNameMismatch, type DiscardReasonCounts } from "./verify";

export interface GoogleMatchAccepted {
  accepted: true;
  googlePlaceId: string;
  /** Google's own matched name — never persisted, only used for logging/pairing. */
  googleName: string;
}

export interface GoogleMatchRejected {
  accepted: false;
  reason: string;
  /** Set only when a candidate was rejected for a name mismatch — kept to calibrate the matching threshold. */
  googleName?: string;
}

export type GoogleMatchOutcome = GoogleMatchAccepted | GoogleMatchRejected;

/**
 * Picks the first Google candidate that passes every check — place_id/types
 * shape, distance from the destination center, business status, and name
 * match — trying each candidate in turn instead of failing on the first
 * rejection. Shared by the main generate flow (verifyOnePlace) and
 * curate:add, so both reject on exactly the same rules.
 */
export function pickVerifiedCandidate(
  aiName: string,
  candidates: GoogleMatch[],
  center: GeoPoint,
  maxDistanceKm: number,
  allowNeighborhood: boolean,
  discardCounts: DiscardReasonCounts,
): GoogleMatchOutcome {
  if (candidates.length === 0) return { accepted: false, reason: "no Google match found" };

  let lastReason = "no Google candidate passed verification";
  let lastGoogleName: string | undefined;

  for (const candidate of candidates) {
    const idCheck = checkPlaceIdAndTypes(candidate.placeId, candidate.types, allowNeighborhood);
    if (!idCheck.accepted) {
      trackPlaceIdRejection(discardCounts, idCheck.reason!);
      lastReason = idCheck.reason === "address_id" ? "id de endereço" : idCheck.reason === "address_type" ? "tipo de endereço" : "id muito longo";
      lastGoogleName = undefined;
      continue;
    }

    const verification = verifyCandidate(
      { aiName, googleName: candidate.name, googleLocation: { lat: candidate.lat, lng: candidate.lng }, businessStatus: candidate.businessStatus },
      center,
      maxDistanceKm,
    );
    if (!verification.accepted) {
      if (verification.reason === "name_mismatch") {
        trackNameMismatch(discardCounts);
        lastReason = "nome não confere";
        lastGoogleName = candidate.name;
      } else {
        lastReason = verification.reason ?? "rejected";
        lastGoogleName = undefined;
      }
      continue;
    }

    return { accepted: true, googlePlaceId: candidate.placeId, googleName: candidate.name };
  }

  return { accepted: false, reason: lastReason, googleName: lastGoogleName };
}
