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

vi.mock("@/utils/trip-helpers", () => ({
  normalizeCityTransportMode: (m: unknown) => m,
  generateId: () => "generated-id",
}));

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
