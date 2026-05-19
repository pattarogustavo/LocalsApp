import { describe, expect, it } from "vitest";
import {
  generateId,
  formatDate,
  getDaysUntil,
  getTripBadge,
  getTripName,
  getInitials,
  getCurrencySymbol,
  getTotalSpots,
  isTripUpcoming,
  isTripPast,
} from "../utils/trip-helpers";
import type { Trip } from "../types/voyage";

function makeMockTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "test-1",
    name: "",
    startDate: new Date(Date.now() + 86400000 * 10).toISOString(), // 10 days from now
    endDate: new Date(Date.now() + 86400000 * 13).toISOString(), // 13 days from now
    totalDays: 4,
    destinations: [{ id: "d1", name: "Paris", country: "France", days: 4 }],
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
  };
}

describe("generateId", () => {
  it("generates unique IDs", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
  });
});

describe("formatDate", () => {
  it("formats date in short format", () => {
    const result = formatDate("2026-06-12T00:00:00.000Z", "short");
    expect(result).toContain("Jun");
    expect(result).toContain("12");
  });

  it("formats date in medium format with year", () => {
    const result = formatDate("2026-06-12T00:00:00.000Z", "medium");
    expect(result).toContain("2026");
  });
});

describe("getDaysUntil", () => {
  it("returns positive number for future dates", () => {
    const futureDate = new Date(Date.now() + 86400000 * 5).toISOString();
    const days = getDaysUntil(futureDate);
    expect(days).toBeGreaterThan(0);
  });

  it("returns negative number for past dates", () => {
    const pastDate = new Date(Date.now() - 86400000 * 5).toISOString();
    const days = getDaysUntil(pastDate);
    expect(days).toBeLessThan(0);
  });
});

describe("getTripBadge", () => {
  it("shows 'em X dias' for upcoming trips", () => {
    const trip = makeMockTrip();
    const badge = getTripBadge(trip);
    expect(badge).toMatch(/em \d+ dias/);
  });

  it("shows 'há X dias' for past trips", () => {
    const trip = makeMockTrip({
      startDate: new Date(Date.now() - 86400000 * 10).toISOString(),
      endDate: new Date(Date.now() - 86400000 * 7).toISOString(),
    });
    const badge = getTripBadge(trip);
    expect(badge).toMatch(/há \d+ dias/);
  });
});

describe("getTripName", () => {
  it("returns trip name if set", () => {
    const trip = makeMockTrip({ name: "Minha Viagem" });
    expect(getTripName(trip)).toBe("Minha Viagem");
  });

  it("generates name from destinations if no name", () => {
    const trip = makeMockTrip({ name: "" });
    const name = getTripName(trip);
    expect(name).toContain("Paris");
    expect(name).toContain("4");
  });
});

describe("getInitials", () => {
  it("returns initials from full name", () => {
    expect(getInitials("João Silva")).toBe("JS");
  });

  it("returns single initial for single name", () => {
    expect(getInitials("Maria")).toBe("M");
  });
});

describe("getCurrencySymbol", () => {
  it("returns correct symbols", () => {
    expect(getCurrencySymbol("BRL")).toBe("R$");
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("EUR")).toBe("€");
    expect(getCurrencySymbol("GBP")).toBe("£");
  });

  it("returns currency code for unknown currencies", () => {
    expect(getCurrencySymbol("XYZ")).toBe("XYZ");
  });
});

describe("getTotalSpots", () => {
  it("returns 0 for trip with no places", () => {
    const trip = makeMockTrip({ places: [] });
    expect(getTotalSpots(trip)).toBe(0);
  });

  it("returns correct count", () => {
    const trip = makeMockTrip({
      places: [
        { id: "p1", name: "Big Ben", category: "attraction", destinationId: "d1" },
        { id: "p2", name: "London Eye", category: "attraction", destinationId: "d1" },
      ],
    });
    expect(getTotalSpots(trip)).toBe(2);
  });
});

describe("isTripUpcoming / isTripPast", () => {
  it("identifies upcoming trips", () => {
    const trip = makeMockTrip();
    expect(isTripUpcoming(trip)).toBe(true);
    expect(isTripPast(trip)).toBe(false);
  });

  it("identifies past trips", () => {
    const trip = makeMockTrip({
      startDate: new Date(Date.now() - 86400000 * 10).toISOString(),
      endDate: new Date(Date.now() - 86400000 * 7).toISOString(),
    });
    expect(isTripPast(trip)).toBe(true);
    expect(isTripUpcoming(trip)).toBe(false);
  });
});
