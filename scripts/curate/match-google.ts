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
 * rejection. For the name check, a candidate is accepted if ANY of `names`
 * (the place's own name plus any altNames) matches it reasonably well —
 * this is how curate:import copes with a place written in a different
 * language than what Google returns (see resolvePlace below for the
 * complementary same-search-different-language retry). Shared by the main
 * generate flow (verifyOnePlace), curate:add, and curate:import, so every
 * command rejects on exactly the same rules.
 */
export function pickVerifiedCandidate(
  names: string[],
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

    let candidateAccepted = false;
    let candidateIsNameMismatch = false;
    let candidateReason: string | undefined;

    for (const name of names) {
      const verification = verifyCandidate(
        { aiName: name, googleName: candidate.name, googleLocation: { lat: candidate.lat, lng: candidate.lng }, businessStatus: candidate.businessStatus },
        center,
        maxDistanceKm,
      );
      if (verification.accepted) {
        candidateAccepted = true;
        break;
      }
      if (verification.reason !== "name_mismatch") {
        // closed/too_far don't depend on which name we tried — no point trying the rest.
        candidateIsNameMismatch = false;
        candidateReason = verification.reason;
        break;
      }
      candidateIsNameMismatch = true;
      candidateReason = "name_mismatch";
    }

    if (candidateAccepted) {
      return { accepted: true, googlePlaceId: candidate.placeId, googleName: candidate.name };
    }

    if (candidateIsNameMismatch) {
      trackNameMismatch(discardCounts);
      lastReason = "nome não confere";
      lastGoogleName = candidate.name;
    } else {
      lastReason = candidateReason ?? "rejected";
      lastGoogleName = undefined;
    }
  }

  return { accepted: false, reason: lastReason, googleName: lastGoogleName };
}

// ─── cross-language / cross-type retry (shared by curate:add and curate:import) ──

/** Rejection reasons produced by checkPlaceIdAndTypes (via pickVerifiedCandidate) — i.e. Google's result shape, not the place itself. */
const ADDRESS_LIKE_REASONS = new Set(["id de endereço", "tipo de endereço", "id muito longo"]);

export function isAddressLikeRejection(reason: string): boolean {
  return ADDRESS_LIKE_REASONS.has(reason);
}

/**
 * Local language to retry a Google Places search in, per destination
 * country, used when a name search in the default (effectively English)
 * language finds no accepted match — e.g. "Torre de Belém" vs. Google's
 * "Belém Tower", or "Colosseo" vs. "Colosseum". Countries whose local
 * language already is English map to "en" (a harmless no-op retry).
 */
const LOCAL_LANGUAGE_BY_COUNTRY: Record<string, string> = {
  ES: "es",
  MX: "es",
  AR: "es",
  PT: "pt",
  BR: "pt",
  IT: "it",
  FR: "fr",
  DE: "de",
  AT: "de",
  CH: "de",
  NL: "nl",
  CZ: "cs",
  GR: "el",
  HU: "hu",
  TR: "tr",
  IE: "en",
  GB: "en",
  US: "en",
  CA: "en",
};

export function localLanguageForCountry(countryCode: string): string {
  return LOCAL_LANGUAGE_BY_COUNTRY[countryCode.toUpperCase()] ?? "en";
}

/** Google Places `type` to bias a Text Search retry by, for the categories where we know one. Categories with no clean Google type (neighborhood, market, beach, hidden_gem, other) get an unrestricted search instead. */
const GOOGLE_TYPE_BY_CATEGORY: Record<string, string> = {
  park: "park",
  museum: "museum",
  restaurant: "restaurant",
  cafe: "cafe",
  attraction: "tourist_attraction",
};

export function googleTypeForCategory(category: string | undefined): string | undefined {
  return category ? GOOGLE_TYPE_BY_CATEGORY[category] : undefined;
}

export interface ResolvePlaceOptions {
  /** The place's own name, plus any altNames — any of them matching is enough (see pickVerifiedCandidate). */
  names: string[];
  neighborhood?: string;
  /** Used only to pick a Google `type` for the type-biased retry (see googleTypeForCategory); omit/leave undefined when unknown. */
  category?: string;
  countryCode: string;
  center: GeoPoint;
  maxDistanceKm: number;
  allowNeighborhood: boolean;
  discardCounts: DiscardReasonCounts;
  /** findplacefromtext-style search, injected so this stays network-free and testable. */
  findByText: (names: string[], neighborhood: string | undefined, language: string | undefined) => Promise<GoogleMatch[]>;
  /** Text-Search-style search biased toward the destination center, injected the same way. Only called when every candidate from findByText was rejected purely for an address-shaped place_id/type. */
  findByTextSearch: (names: string[], type: string | undefined) => Promise<GoogleMatch[]>;
}

export interface ResolvePlaceResult {
  outcome: GoogleMatchOutcome;
  /** True only when the ACCEPTED match came from the second-language retry. */
  usedLanguageRetry: boolean;
  /** True only when the ACCEPTED match came from the type-biased Text Search retry. */
  usedTypeRetry: boolean;
  /** Every distinct name Google returned across every attempt (first search, language retry, type retry) — even rejected ones — so a rejection can be reported with what Google actually called the place, in both languages when it answered twice. */
  seenGoogleNames: string[];
  /** The full matched candidate (including `types`), when accepted — e.g. to infer a missing category. */
  matchedCandidate?: GoogleMatch;
}

/**
 * Resolves one place against Google Places with up to two extra attempts
 * beyond the initial search: a same-search retry in the destination
 * country's local language (whenever the first search found no accepted
 * match, for any reason), and — only when every remaining candidate was
 * rejected purely for an address-shaped place_id/type (route,
 * intersection, ...) — a Text Search retry biased toward the destination
 * center with a `type` derived from the place's category. Both retries run
 * through the exact same pickVerifiedCandidate rules, so a genuine mismatch
 * (wrong place entirely) is never accepted just because we tried again.
 */
export async function resolvePlace(opts: ResolvePlaceOptions): Promise<ResolvePlaceResult> {
  const seenGoogleNames = new Set<string>();
  const allCandidates: GoogleMatch[] = [];
  const track = (candidates: GoogleMatch[]) => {
    for (const c of candidates) seenGoogleNames.add(c.name);
    allCandidates.push(...candidates);
  };

  const firstCandidates = await opts.findByText(opts.names, opts.neighborhood, undefined);
  track(firstCandidates);
  let outcome = pickVerifiedCandidate(opts.names, firstCandidates, opts.center, opts.maxDistanceKm, opts.allowNeighborhood, opts.discardCounts);
  let usedLanguageRetry = false;

  if (!outcome.accepted) {
    const retryLanguage = localLanguageForCountry(opts.countryCode);
    const retryCandidates = await opts.findByText(opts.names, opts.neighborhood, retryLanguage);
    track(retryCandidates);
    const retryOutcome = pickVerifiedCandidate(opts.names, retryCandidates, opts.center, opts.maxDistanceKm, opts.allowNeighborhood, opts.discardCounts);
    outcome = retryOutcome;
    usedLanguageRetry = retryOutcome.accepted;
  }

  let usedTypeRetry = false;
  if (!outcome.accepted && isAddressLikeRejection(outcome.reason)) {
    const type = googleTypeForCategory(opts.category);
    const textSearchCandidates = await opts.findByTextSearch(opts.names, type);
    track(textSearchCandidates);
    const typeOutcome = pickVerifiedCandidate(opts.names, textSearchCandidates, opts.center, opts.maxDistanceKm, opts.allowNeighborhood, opts.discardCounts);
    outcome = typeOutcome;
    usedTypeRetry = typeOutcome.accepted;
  }

  const matchedCandidate = outcome.accepted ? allCandidates.find((c) => c.placeId === outcome.googlePlaceId) : undefined;
  return { outcome, usedLanguageRetry, usedTypeRetry, seenGoogleNames: [...seenGoogleNames], matchedCandidate };
}
