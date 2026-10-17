import { describe, expect, it, vi } from "vitest";
import { pickVerifiedCandidate, resolvePlace, isAddressLikeRejection, localLanguageForCountry, googleTypeForCategory } from "../scripts/curate/match-google";
import { newDiscardReasonCounts } from "../scripts/curate/verify";
import type { GoogleMatch } from "../scripts/curate/google";

const center = { lat: 51.5072, lng: -0.1276 };
const nearby = { lat: 51.51, lng: -0.128 };
const farAway = { lat: 48.8566, lng: 2.3522 };

function match(overrides: Partial<GoogleMatch> = {}): GoogleMatch {
  return {
    placeId: "ChIJqRLoW-PfyUcRqsW-OPfnWSc",
    name: "Big Ben",
    lat: nearby.lat,
    lng: nearby.lng,
    types: ["tourist_attraction", "point_of_interest"],
    ...overrides,
  };
}

describe("pickVerifiedCandidate", () => {
  it("returns no_google_match when there are no candidates", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Big Ben"], [], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("no Google match found");
  });

  it("accepts the only candidate when it passes every check", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Big Ben"], [match()], center, 35, false, counts);
    expect(outcome.accepted).toBe(true);
    expect((outcome as any).googlePlaceId).toBe("ChIJqRLoW-PfyUcRqsW-OPfnWSc");
    expect((outcome as any).googleName).toBe("Big Ben");
  });

  it("rejects a neighborhood/sublocality result unless allowNeighborhood is true", () => {
    const counts = newDiscardReasonCounts();
    const rejected = pickVerifiedCandidate(["Covent Garden"], [match({ types: ["neighborhood", "political"] })], center, 35, false, counts);
    expect(rejected.accepted).toBe(false);
    expect(counts.addressType).toBe(1);

    const accepted = pickVerifiedCandidate(
      ["Covent Garden"],
      [match({ name: "Covent Garden", types: ["neighborhood", "political"] })],
      center,
      35,
      true,
      newDiscardReasonCounts(),
    );
    expect(accepted.accepted).toBe(true);
  });

  it("rejects an address-shaped place_id", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Big Ben"], [match({ placeId: "EjBLZW5zaW5ndG9uIFJkICYgSHlkZSBQYXJrIEdhdGUsIExvbmRvbg" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect(counts.addressId).toBe(1);
  });

  it("rejects a candidate too far from the destination center", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Big Ben"], [match({ lat: farAway.lat, lng: farAway.lng })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("too_far");
  });

  it("rejects a name mismatch and reports the Google name it saw", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Big Ben"], [match({ name: "Some Unrelated Pub" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("nome não confere");
    expect((outcome as any).googleName).toBe("Some Unrelated Pub");
    expect(counts.nameMismatch).toBe(1);
  });

  it("rejects a closed place", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Big Ben"], [match({ businessStatus: "CLOSED_PERMANENTLY" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("closed");
  });

  it("falls through to the next candidate when the first is rejected", () => {
    const counts = newDiscardReasonCounts();
    const candidates = [
      match({ placeId: "EjSomeAddressId", types: ["route"] }),
      match({ placeId: "ChIJanotherRealId000000000000000000", name: "Big Ben" }),
    ];
    const outcome = pickVerifiedCandidate(["Big Ben"], candidates, center, 35, false, counts);
    expect(outcome.accepted).toBe(true);
    expect((outcome as any).googlePlaceId).toBe("ChIJanotherRealId000000000000000000");
  });

  it("accepts a candidate when ANY of the given names matches (altNames)", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Torre de Belém", "Belem Tower"], [match({ name: "Belém Tower" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(true);
  });

  it("D) still rejects a genuine mismatch (Catedral da Sé de São Paulo vs Crypta of Se)", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate(["Catedral da Sé de São Paulo"], [match({ name: "Crypta of Se" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("nome não confere");
  });
});

describe("isAddressLikeRejection", () => {
  it("recognizes the three address-shaped rejection reasons", () => {
    expect(isAddressLikeRejection("id de endereço")).toBe(true);
    expect(isAddressLikeRejection("tipo de endereço")).toBe(true);
    expect(isAddressLikeRejection("id muito longo")).toBe(true);
  });

  it("does not treat a name mismatch or too_far as address-like", () => {
    expect(isAddressLikeRejection("nome não confere")).toBe(false);
    expect(isAddressLikeRejection("too_far")).toBe(false);
    expect(isAddressLikeRejection("closed")).toBe(false);
  });
});

describe("localLanguageForCountry", () => {
  it("maps known countries to their local language", () => {
    expect(localLanguageForCountry("PT")).toBe("pt");
    expect(localLanguageForCountry("BR")).toBe("pt");
    expect(localLanguageForCountry("IT")).toBe("it");
    expect(localLanguageForCountry("FR")).toBe("fr");
    expect(localLanguageForCountry("ES")).toBe("es");
    expect(localLanguageForCountry("MX")).toBe("es");
  });

  it("maps English-speaking countries to en", () => {
    expect(localLanguageForCountry("GB")).toBe("en");
    expect(localLanguageForCountry("US")).toBe("en");
  });

  it("falls back to en for an unknown country code", () => {
    expect(localLanguageForCountry("ZZ")).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(localLanguageForCountry("pt")).toBe("pt");
  });
});

describe("googleTypeForCategory", () => {
  it("maps known categories to a Google place type", () => {
    expect(googleTypeForCategory("park")).toBe("park");
    expect(googleTypeForCategory("museum")).toBe("museum");
    expect(googleTypeForCategory("restaurant")).toBe("restaurant");
    expect(googleTypeForCategory("cafe")).toBe("cafe");
    expect(googleTypeForCategory("attraction")).toBe("tourist_attraction");
  });

  it("returns undefined for categories with no clean Google type, and for undefined", () => {
    expect(googleTypeForCategory("neighborhood")).toBeUndefined();
    expect(googleTypeForCategory(undefined)).toBeUndefined();
  });
});

describe("resolvePlace", () => {
  it("accepts on the first search without retrying anything", async () => {
    const findByText = vi.fn(async () => [match()]);
    const findByTextSearch = vi.fn(async () => []);
    const result = await resolvePlace({
      names: ["Big Ben"],
      countryCode: "GB",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch,
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.usedLanguageRetry).toBe(false);
    expect(result.usedTypeRetry).toBe(false);
    expect(findByText).toHaveBeenCalledTimes(1);
    expect(findByTextSearch).not.toHaveBeenCalled();
  });

  it("retries once in the destination's local language when the first search finds no match (Torre de Belém / Belém Tower)", async () => {
    // Default-language search returns Google's English name (no match); the pt retry returns the localized name Google gives when asked in Portuguese (exact match).
    const findByText = vi.fn(async (_names: string[], _neighborhood: string | undefined, language: string | undefined) =>
      language === "pt" ? [match({ name: "Torre de Belém" })] : [match({ name: "Belém Tower" })],
    );
    const findByTextSearch = vi.fn(async () => []);
    const result = await resolvePlace({
      names: ["Torre de Belém"],
      countryCode: "PT",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch,
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.usedLanguageRetry).toBe(true);
    expect(findByText).toHaveBeenCalledTimes(2);
    expect(findByText.mock.calls[1][2]).toBe("pt");
  });

  it("matches Colosseo / Colosseum via the local-language retry", async () => {
    const findByText = vi.fn(async (_names: string[], _n: unknown, language: string | undefined) =>
      language === "it" ? [match({ name: "Colosseo" })] : [match({ name: "Colosseum" })],
    );
    const result = await resolvePlace({
      names: ["Colosseo"],
      countryCode: "IT",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch: vi.fn(async () => []),
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.usedLanguageRetry).toBe(true);
  });

  it("falls back to the type-biased Text Search retry when every candidate is rejected only for an address-shaped place_id/type (Puerta del Sol)", async () => {
    const findByText = vi.fn(async () => [match({ name: "Puerta del Sol", types: ["route"] })]);
    const findByTextSearch = vi.fn(async (_names: string[], type: string | undefined) => {
      expect(type).toBe("tourist_attraction");
      return [match({ name: "Puerta del Sol", placeId: "ChIJtextsearchRealId00000000000000", types: ["tourist_attraction"] })];
    });
    const result = await resolvePlace({
      names: ["Puerta del Sol"],
      category: "attraction",
      countryCode: "ES",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch,
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.usedTypeRetry).toBe(true);
    expect(findByTextSearch).toHaveBeenCalledTimes(1);
  });

  it("also tries the type retry for Arc de Triomphe", async () => {
    const findByText = vi.fn(async () => [match({ name: "Arc de Triomphe", types: ["route"] })]);
    const findByTextSearch = vi.fn(async () => [
      match({ name: "Arc de Triomphe", placeId: "ChIJarcdetriomphe000000000000000000", types: ["tourist_attraction"] }),
    ]);
    const result = await resolvePlace({
      names: ["Arc de Triomphe"],
      category: "attraction",
      countryCode: "FR",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch,
    });
    expect(result.outcome.accepted).toBe(true);
    expect(result.usedTypeRetry).toBe(true);
  });

  it("does not attempt the type retry for a plain name mismatch (not an address-shaped rejection)", async () => {
    const findByText = vi.fn(async () => [match({ name: "Completely Unrelated Pub" })]);
    const findByTextSearch = vi.fn(async () => []);
    const result = await resolvePlace({
      names: ["Big Ben"],
      countryCode: "GB",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch,
    });
    expect(result.outcome.accepted).toBe(false);
    expect(findByTextSearch).not.toHaveBeenCalled();
  });

  it("D) still rejects a false match across every retry (Le Marais vs 3rd arrondissement)", async () => {
    const findByText = vi.fn(async () => [match({ name: "3rd arrondissement", types: ["route"] })]);
    const findByTextSearch = vi.fn(async () => [match({ name: "3rd arrondissement", placeId: "ChIJ3rdarrondissement00000000000000" })]);
    const result = await resolvePlace({
      names: ["Le Marais"],
      countryCode: "FR",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: true,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch,
    });
    expect(result.outcome.accepted).toBe(false);
  });

  it("D) still rejects Miradouro da Senhora do Monte vs Miradouro da Graça", async () => {
    const findByText = vi.fn(async () => [match({ name: "Miradouro da Graça" })]);
    const result = await resolvePlace({
      names: ["Miradouro da Senhora do Monte"],
      countryCode: "PT",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch: vi.fn(async () => []),
    });
    expect(result.outcome.accepted).toBe(false);
  });

  it("collects every distinct Google name seen across attempts, for reporting", async () => {
    const findByText = vi.fn(async (_n: string[], _nb: unknown, language: string | undefined) =>
      language ? [match({ name: "Second Language Name" })] : [match({ name: "First Language Name" })],
    );
    const result = await resolvePlace({
      names: ["Something"],
      countryCode: "PT",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch: vi.fn(async () => []),
    });
    expect(result.outcome.accepted).toBe(false);
    expect(result.seenGoogleNames.sort()).toEqual(["First Language Name", "Second Language Name"]);
  });

  it("respects the Google call budget via the injected finders (doesn't bypass it)", async () => {
    let calls = 0;
    const findByText = async () => {
      calls++;
      return [];
    };
    await resolvePlace({
      names: ["X"],
      countryCode: "PT",
      center,
      maxDistanceKm: 35,
      allowNeighborhood: false,
      discardCounts: newDiscardReasonCounts(),
      findByText,
      findByTextSearch: async () => [],
    });
    expect(calls).toBe(2); // first search + one local-language retry, never more
  });
});
