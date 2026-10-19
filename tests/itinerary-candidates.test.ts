import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindCatalogDestination, mockGetApprovedCuratedPlaces, mockFetchCuratedPlaceDetails } = vi.hoisted(() => ({
  mockFindCatalogDestination: vi.fn(),
  mockGetApprovedCuratedPlaces: vi.fn(),
  mockFetchCuratedPlaceDetails: vi.fn(),
}));

vi.mock("../server/catalog", () => ({
  findCatalogDestination: mockFindCatalogDestination,
  getApprovedCuratedPlaces: mockGetApprovedCuratedPlaces,
  rankCuratedPlaces: (places: any[]) => [...places].sort((a, b) => a.rank - b.rank),
  pickCuratedDescription: (place: any) => place.descriptions?.en ?? "",
}));

vi.mock("../server/google-places", () => ({
  fetchCuratedPlaceDetails: mockFetchCuratedPlaceDetails,
}));

import { prepareCandidatePool } from "../server/itinerary/candidates";

function curatedPlace(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    googlePlaceId: "cat-1",
    aiName: "Bistro Local",
    category: "restaurant",
    confidence: "high",
    rank: 0,
    tags: ["gastronomia"],
    priceTier: "moderate",
    cuisine: "french",
    aiNeighborhood: "Le Marais",
    descriptions: { en: "A beloved neighborhood bistro." },
    ...overrides,
  };
}

function googleCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Generic Cafe",
    placeId: "g-1",
    destinationName: "Paris",
    rating: 4.0,
    userRatingsTotal: 50,
    types: ["cafe"],
    hasPhoto: true,
    lat: 48.86,
    lng: 2.36,
    ...overrides,
  };
}

const destinations = [{ name: "Paris", country: "France", lat: 48.8566, lng: 2.3522 }];

describe("prepareCandidatePool", () => {
  beforeEach(() => {
    mockFindCatalogDestination.mockReset();
    mockGetApprovedCuratedPlaces.mockReset();
    mockFetchCuratedPlaceDetails.mockReset();
    mockFetchCuratedPlaceDetails.mockResolvedValue({ lat: 48.861, lng: 2.361, hours: "Monday: 9:00 AM – 6:00 PM" });
  });

  it("gracefully degrades to the Google-only pool when the catalog has no match for the destination", async () => {
    mockFindCatalogDestination.mockResolvedValue(null);
    const result = await prepareCandidatePool([googleCandidate()], destinations, {});
    expect(result.candidates).toHaveLength(1);
    expect(result.catalogCount).toBe(0);
  });

  it("merges catalog places into the pool, tagged source='catalog', even when the catalog place doesn't overlap any Google candidate", async () => {
    mockFindCatalogDestination.mockResolvedValue({ id: 1, slug: "paris-fr" });
    mockGetApprovedCuratedPlaces.mockResolvedValue([curatedPlace()]);

    const result = await prepareCandidatePool([googleCandidate()], destinations, {});
    expect(result.candidates).toHaveLength(2);
    expect(result.catalogCount).toBe(1);
    const catalogEntry = result.candidates.find((c) => c.placeId === "cat-1")!;
    expect(catalogEntry.source).toBe("catalog");
    expect(catalogEntry.curatedDescription).toBe("A beloved neighborhood bistro.");
  });

  it("merges by EXACT placeId only — a catalog place sharing a placeId with a Google candidate combines fields instead of duplicating", async () => {
    mockFindCatalogDestination.mockResolvedValue({ id: 1, slug: "paris-fr" });
    mockGetApprovedCuratedPlaces.mockResolvedValue([curatedPlace({ googlePlaceId: "shared-id" })]);

    const googleVersion = googleCandidate({ placeId: "shared-id", rating: 4.7, userRatingsTotal: 900, types: ["restaurant", "point_of_interest"] });
    const result = await prepareCandidatePool([googleVersion], destinations, {});

    const merged = result.candidates.find((c) => c.placeId === "shared-id")!;
    expect(result.candidates).toHaveLength(1); // not duplicated
    expect(merged.source).toBe("catalog"); // editorial fields win
    expect(merged.curatedDescription).toBe("A beloved neighborhood bistro.");
    expect(merged.rating).toBe(4.7); // objective Google signal backfilled
    expect(merged.userRatingsTotal).toBe(900);
  });

  it("NEVER drops a candidate for low interest/quality/popularity — only filterExcludedCandidates (literal avoid-list match) may remove one", async () => {
    mockFindCatalogDestination.mockResolvedValue(null);
    const irrelevantButPresent = googleCandidate({ placeId: "irrelevant", name: "Amusement Park", types: ["amusement_park"], rating: 3.0, userRatingsTotal: 2 });
    const result = await prepareCandidatePool([irrelevantButPresent], destinations, { travelStyles: ["cultura"] });
    expect(result.candidates.map((c) => c.placeId)).toContain("irrelevant");
  });

  it("hard-excludes only a literal avoid-list match, and reports excludedCount", async () => {
    mockFindCatalogDestination.mockResolvedValue(null);
    const avoided = googleCandidate({ placeId: "avoid-me", name: "Sea Life Aquarium", types: ["aquarium"] });
    const kept = googleCandidate({ placeId: "keep-me", name: "Art Museum", types: ["museum"] });
    const result = await prepareCandidatePool([avoided, kept], destinations, { avoidText: "não gosto de aquário" });
    expect(result.excludedCount).toBe(1);
    expect(result.candidates.map((c) => c.placeId)).toEqual(["keep-me"]);
  });

  it("excludes a name already in excludeNamesLower (e.g. already user-selected) without counting it as a hard exclusion", async () => {
    mockFindCatalogDestination.mockResolvedValue(null);
    const alreadySelected = googleCandidate({ placeId: "dup", name: "Louvre Museum" });
    const result = await prepareCandidatePool([alreadySelected], destinations, {
      excludeNamesLower: new Set(["louvre museum"]),
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.excludedCount).toBe(0);
  });

  it("ranks a curated-catalog pick above an equally-interest-matched but non-curated Google candidate (editorial affinity tie-breaker)", async () => {
    mockFindCatalogDestination.mockResolvedValue({ id: 1, slug: "paris-fr" });
    mockGetApprovedCuratedPlaces.mockResolvedValue([curatedPlace({ category: "museum", confidence: "high" })]);

    const genericMuseum = googleCandidate({ placeId: "generic-museum", name: "Generic Museum", types: ["museum"], rating: 3.9, userRatingsTotal: 40 });
    const result = await prepareCandidatePool([genericMuseum], destinations, { travelStyles: ["cultura"] });

    const catalogIndex = result.candidates.findIndex((c) => c.source === "catalog");
    const genericIndex = result.candidates.findIndex((c) => c.placeId === "generic-museum");
    expect(catalogIndex).toBeLessThan(genericIndex);
  });

  it("respects the safety cap AFTER ranking — never trims before scoring runs", async () => {
    mockFindCatalogDestination.mockResolvedValue(null);
    const many = Array.from({ length: 10 }, (_, i) => googleCandidate({ placeId: `g-${i}`, name: `Place ${i}`, userRatingsTotal: i }));
    const result = await prepareCandidatePool(many, destinations, { safetyCap: 3 });
    expect(result.candidates).toHaveLength(3);
    expect(result.totalBeforeCap).toBe(10);
    // Highest userRatingsTotal (g-9) should survive the cap — ranking ran first.
    expect(result.candidates.map((c) => c.placeId)).toContain("g-9");
  });

  it("backfills lat/lng/hours for catalog candidates via Place Details (never stored in the catalog at rest)", async () => {
    mockFindCatalogDestination.mockResolvedValue({ id: 1, slug: "paris-fr" });
    mockGetApprovedCuratedPlaces.mockResolvedValue([curatedPlace()]);

    const result = await prepareCandidatePool([], destinations, {});
    const catalogEntry = result.candidates.find((c) => c.source === "catalog")!;
    expect(catalogEntry.lat).toBe(48.861);
    expect(catalogEntry.lng).toBe(2.361);
    expect(catalogEntry.hoursText).toBe("Monday: 9:00 AM – 6:00 PM");
  });

  it("never blocks the pool when the catalog lookup throws", async () => {
    mockFindCatalogDestination.mockRejectedValue(new Error("db down"));
    const result = await prepareCandidatePool([googleCandidate()], destinations, {});
    expect(result.candidates).toHaveLength(1);
    expect(result.catalogCount).toBe(0);
  });
});
