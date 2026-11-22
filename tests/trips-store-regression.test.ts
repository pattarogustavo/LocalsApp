import { describe, it, expect, vi, beforeEach } from "vitest";

// store/trips.ts reaches into a handful of RN/network modules that don't
// resolve under vitest's plain Node environment (no @/ alias, no RN
// runtime) — stub them out so the store itself (the thing under test) loads
// and runs for real.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
    multiRemove: vi.fn(async () => {}),
  },
}));

vi.mock("@/lib/trpc-vanilla", () => ({
  trpcVanilla: {
    cloudTrips: {
      upsert: { mutate: vi.fn(async () => ({})) },
      delete: { mutate: vi.fn(async () => ({})) },
      list: { query: vi.fn(async () => []) },
      // Rejecting (not resolving) exercises the same offline-tolerant path
      // applyTripWrite already documents: the locally-computed `next` is
      // kept as-is when the cloud patch fails.
      patch: { mutate: vi.fn(async () => { throw new Error("offline"); }) },
    },
    sharing: {
      saveSharedTrip: { mutate: vi.fn(async () => ({ tripData: "{}" })) },
    },
  },
}));

vi.mock("@/utils/trip-helpers", async () => {
  const actual = await vi.importActual<typeof import("../utils/trip-helpers")>("../utils/trip-helpers");
  return {
    normalizeCityTransportMode: (m: unknown) => m,
    generateId: () => "generated-id",
    haversineDistanceMeters: actual.haversineDistanceMeters,
  };
});

vi.mock("@/lib/trip-notifications", () => ({
  reconcileTripReminders: vi.fn(async () => {}),
}));

const { useTripsStore } = await import("../store/trips");
type Trip = Awaited<ReturnType<typeof useTripsStore.getState>>["trips"][number];

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    name: "Test trip",
    startDate: new Date(Date.now() + 86400000 * 10).toISOString(),
    endDate: new Date(Date.now() + 86400000 * 13).toISOString(),
    totalDays: 4,
    destinations: [],
    transport: [],
    places: [],
    documents: [],
    expenses: [],
    travelers: [],
    accommodations: [],
    itinerary: [],
    currency: "BRL",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Trip;
}

beforeEach(() => {
  useTripsStore.setState({
    trips: [],
    isLoading: false,
    isSyncing: false,
    isTranslating: false,
    lastWriteError: null,
  });
});

// Regression test for the "trip screen doesn't update until pull-to-refresh"
// bug: a component reading `useTripsStore((s) => s.trips.find(...))` only
// re-renders when that selector's RESULT changes identity. If a mutator ever
// mutated the existing Trip object/array in place instead of producing a new
// one, the selector would keep returning the same reference and the screen
// would silently go stale. These assert the new-reference contract holds for
// the mutators named in the regression report.
describe("TripsStore mutators always produce a new Trip reference", () => {
  it("addTransport", async () => {
    const trip = makeTrip();
    useTripsStore.setState({ trips: [trip] });
    const before = useTripsStore.getState().trips.find((t) => t.id === trip.id);

    await useTripsStore.getState().addTransport(trip.id, { id: "transport-1" } as any);

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after).not.toBe(before);
    expect(after?.transport.some((t) => t.id === "transport-1")).toBe(true);
  });

  it("addTraveler", async () => {
    const trip = makeTrip();
    useTripsStore.setState({ trips: [trip] });
    const before = useTripsStore.getState().trips.find((t) => t.id === trip.id);

    await useTripsStore.getState().addTraveler(trip.id, {
      id: "traveler-1",
      name: "Ana",
      initials: "A",
      isRegistered: false,
    } as any);

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after).not.toBe(before);
    expect(after?.travelers.some((t) => t.id === "traveler-1")).toBe(true);
  });

  it("addPlace", async () => {
    const trip = makeTrip();
    useTripsStore.setState({ trips: [trip] });
    const before = useTripsStore.getState().trips.find((t) => t.id === trip.id);

    await useTripsStore.getState().addPlace(trip.id, { id: "place-1", name: "Louvre" } as any);

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after).not.toBe(before);
    expect(after?.places.some((p) => p.id === "place-1")).toBe(true);
  });
});

// Regression coverage for the duplicated-places bug: the AI itinerary and
// the recommendations panel can both end up saving the same real-world
// place, named slightly differently (translation, partial name) and/or
// resolved to its Google place_id at different times.
describe("upsertPlace deduplication", () => {
  it("creates a new place when nothing matches", async () => {
    const trip = makeTrip({
      places: [{ id: "p1", name: "Louvre Museum", category: "museum", destinationId: "dest-1" } as any],
    });
    useTripsStore.setState({ trips: [trip] });

    const id = await useTripsStore.getState().upsertPlace(trip.id, {
      name: "Eiffel Tower",
      category: "attraction" as any,
      destinationId: "dest-1",
    });

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.places).toHaveLength(2);
    expect(after?.places.some((p) => p.id === id && p.name === "Eiffel Tower")).toBe(true);
  });

  it("matches an existing place by googlePlaceId regardless of name", async () => {
    const trip = makeTrip({
      places: [{ id: "p1", name: "Eiffel Tower", category: "attraction", destinationId: "dest-1", placeId: "ChIJgoogle" } as any],
    });
    useTripsStore.setState({ trips: [trip] });

    const id = await useTripsStore.getState().upsertPlace(trip.id, {
      name: "Torre Eiffel",
      category: "attraction" as any,
      destinationId: "dest-1",
      googlePlaceId: "ChIJgoogle",
      imageUrl: "https://example.com/photo.jpg",
    });

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.places).toHaveLength(1);
    expect(id).toBe("p1");
    expect(after?.places[0].imageUrl).toBe("https://example.com/photo.jpg");
  });

  it("fuzzy-matches an unresolved place by name (diacritics, partial name) when coordinates aren't known yet", async () => {
    const trip = makeTrip({
      places: [{ id: "p1", name: "Café de Flore", category: "cafe", destinationId: "dest-1" } as any],
    });
    useTripsStore.setState({ trips: [trip] });

    const id = await useTripsStore.getState().upsertPlace(trip.id, {
      name: "Cafe de Flore",
      category: "cafe" as any,
      destinationId: "dest-1",
    });

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.places).toHaveLength(1);
    expect(id).toBe("p1");
  });

  it("does not merge same-name places that are far apart (e.g. two branches of the same chain)", async () => {
    const trip = makeTrip({
      places: [{ id: "p1", name: "Starbucks", category: "cafe", destinationId: "dest-1", lat: 48.8566, lng: 2.3522 } as any],
    });
    useTripsStore.setState({ trips: [trip] });

    const id = await useTripsStore.getState().upsertPlace(trip.id, {
      name: "Starbucks",
      category: "cafe" as any,
      destinationId: "dest-1",
      lat: 48.9, // ~5km away
      lng: 2.3522,
    });

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.places).toHaveLength(2);
    expect(id).not.toBe("p1");
  });

  it("merges same-name places that are within 100m of each other", async () => {
    const trip = makeTrip({
      places: [{ id: "p1", name: "Starbucks", category: "cafe", destinationId: "dest-1", lat: 48.8566, lng: 2.3522 } as any],
    });
    useTripsStore.setState({ trips: [trip] });

    const id = await useTripsStore.getState().upsertPlace(trip.id, {
      name: "Starbucks",
      category: "cafe" as any,
      destinationId: "dest-1",
      lat: 48.85665, // a few meters away
      lng: 2.35225,
    });

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.places).toHaveLength(1);
    expect(id).toBe("p1");
  });
});

describe("dedupePlaces", () => {
  it("merges places sharing a googlePlaceId, keeps the richer record, and repoints itinerary stops", async () => {
    const trip = makeTrip({
      places: [
        { id: "p1", name: "Eiffel Tower", category: "attraction", destinationId: "dest-1", placeId: "ChIJgoogle" } as any,
        { id: "p2", name: "Torre Eiffel", category: "attraction", destinationId: "dest-1", placeId: "ChIJgoogle", imageUrl: "https://example.com/photo.jpg", address: "Champ de Mars" } as any,
      ],
      itinerary: [
        { date: "2026-01-01", destination: "Paris", stops: [{ id: "s1", time: "09:00", placeId: "p1", placeName: "Eiffel Tower", placeCategory: "attraction" }] } as any,
      ],
    });
    useTripsStore.setState({ trips: [trip] });

    await useTripsStore.getState().dedupePlaces(trip.id);

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.places).toHaveLength(1);
    const kept = after!.places[0];
    expect(kept.imageUrl).toBe("https://example.com/photo.jpg");
    expect(kept.address).toBe("Champ de Mars");
    // Whichever record survived, the stop that pointed at the removed one
    // must now point at the one that's left.
    expect(after?.itinerary[0].stops[0].placeId).toBe(kept.id);
  });

  it("is a no-op (no new Trip reference) when there's nothing to merge", async () => {
    const trip = makeTrip({
      places: [{ id: "p1", name: "Eiffel Tower", category: "attraction", destinationId: "dest-1", placeId: "ChIJgoogle" } as any],
    });
    useTripsStore.setState({ trips: [trip] });
    const before = useTripsStore.getState().trips.find((t) => t.id === trip.id);

    await useTripsStore.getState().dedupePlaces(trip.id);

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after).toBe(before);
  });
});

// Multi-currency expenses (addExpense remembers the currency, and
// recalculateTripCurrency applies a base-currency switch atomically).
describe("addExpense remembers lastExpenseCurrency", () => {
  it("sets trip.lastExpenseCurrency to the saved expense's currency", async () => {
    const trip = makeTrip({ currency: "BRL" });
    useTripsStore.setState({ trips: [trip] });

    await useTripsStore.getState().addExpense(trip.id, {
      id: "e1", description: "Dinner", amount: 50, currency: "EUR",
      category: "food", date: "2024-01-01T00:00:00.000Z", paidBy: "You",
      exchangeRate: 5.4, baseAmount: 270,
    } as any);

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.lastExpenseCurrency).toBe("EUR");
    expect(after?.expenses).toHaveLength(1);
  });
});

describe("recalculateTripCurrency", () => {
  it("sets the new base currency and applies the given per-expense conversions in one write", async () => {
    const trip = makeTrip({
      currency: "BRL",
      expenses: [
        { id: "e1", description: "Lunch", amount: 100, currency: "BRL", category: "food", date: "2024-01-01T00:00:00.000Z", paidBy: "You", baseAmount: 100, exchangeRate: 1 },
        { id: "e2", description: "Taxi", amount: 20, currency: "USD", category: "transport", date: "2024-01-02T00:00:00.000Z", paidBy: "You", baseAmount: 100, exchangeRate: 5 },
      ] as any,
    });
    useTripsStore.setState({ trips: [trip] });

    await useTripsStore.getState().recalculateTripCurrency(trip.id, "USD", {
      e1: { exchangeRate: 0.2, baseAmount: 20, rateSource: "frankfurter" },
      e2: { exchangeRate: 1, baseAmount: 20, rateSource: "frankfurter" },
    });

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.currency).toBe("USD");
    const e1 = after?.expenses.find((e) => e.id === "e1");
    const e2 = after?.expenses.find((e) => e.id === "e2");
    expect(e1?.baseAmount).toBe(20);
    expect(e1?.exchangeRate).toBe(0.2);
    expect(e1?.amount).toBe(100); // the original amount/currency are never touched
    expect(e1?.currency).toBe("BRL");
    expect(e2?.baseAmount).toBe(20);
  });

  it("leaves an expense untouched if it's missing from the rates map", async () => {
    const trip = makeTrip({
      currency: "BRL",
      expenses: [
        { id: "e1", description: "Lunch", amount: 100, currency: "BRL", category: "food", date: "2024-01-01T00:00:00.000Z", paidBy: "You", baseAmount: 100, exchangeRate: 1 },
      ] as any,
    });
    useTripsStore.setState({ trips: [trip] });

    await useTripsStore.getState().recalculateTripCurrency(trip.id, "USD", {});

    const after = useTripsStore.getState().trips.find((t) => t.id === trip.id);
    expect(after?.currency).toBe("USD");
    expect(after?.expenses[0].baseAmount).toBe(100); // unchanged — no entry was provided for e1
  });
});
