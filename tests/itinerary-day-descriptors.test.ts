import { describe, expect, it } from "vitest";
import { buildDayDescriptors, assignMustVisitToDays } from "../server/itinerary/day-descriptors";
import { buildMinimalDaySchema, buildItineraryDaysSchema } from "../server/itinerary/schema";

describe("buildDayDescriptors", () => {
  it("builds one descriptor per day, in global-index order, across a single destination", () => {
    const descriptors = buildDayDescriptors("2026-11-10", [{ name: "Barcelona", country: "Spain", days: 3 }]);
    expect(descriptors.map((d) => d.date)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(descriptors.every((d) => d.destinationName === "Barcelona")).toBe(true);
  });

  it("marks only the very first and very last day of the WHOLE trip, across multiple destinations", () => {
    const descriptors = buildDayDescriptors("2026-11-10", [
      { name: "Barcelona", country: "Spain", days: 2 },
      { name: "Madrid", country: "Spain", days: 2 },
    ]);
    expect(descriptors).toHaveLength(4);
    expect(descriptors[0]).toMatchObject({ index: 0, destinationName: "Barcelona", isFirstDay: true, isLastDay: false });
    expect(descriptors[1]).toMatchObject({ index: 1, destinationName: "Barcelona", isFirstDay: false, isLastDay: false });
    expect(descriptors[2]).toMatchObject({ index: 2, destinationName: "Madrid", isFirstDay: false, isLastDay: false });
    expect(descriptors[3]).toMatchObject({ index: 3, destinationName: "Madrid", isFirstDay: false, isLastDay: true });
  });

  it("carries each destination's own lat/lng onto its days", () => {
    const descriptors = buildDayDescriptors("2026-11-10", [{ name: "Kyoto", country: "Japan", days: 1, lat: 35.0116, lng: 135.7681 }]);
    expect(descriptors[0]).toMatchObject({ lat: 35.0116, lng: 135.7681 });
  });
});

describe("assignMustVisitToDays", () => {
  const descriptors = buildDayDescriptors("2026-11-10", [{ name: "Barcelona", country: "Spain", days: 5 }]);

  it("assigns a user-selected place (has destinationName) to the first day of its destination", () => {
    const byDay = assignMustVisitToDays(descriptors, [{ name: "Hotel Arts", destinationName: "Barcelona" }]);
    expect(byDay.get(0)).toEqual([{ name: "Hotel Arts", destinationName: "Barcelona" }]);
    expect(byDay.get(1)).toBeUndefined();
  });

  it("assigns a destination-less must-see (free-text hint) to a middle day, not day 0 or the last day", () => {
    const byDay = assignMustVisitToDays(descriptors, [{ name: "Sagrada Família" }]);
    const assignedDayIndex = [...byDay.keys()][0];
    expect(assignedDayIndex).toBeGreaterThan(0);
    expect(assignedDayIndex).toBeLessThan(descriptors.length - 1);
  });

  it("never loses an item — every input must-visit ends up assigned to exactly one day", () => {
    const items = [
      { name: "Selected A", destinationName: "Barcelona" },
      { name: "Selected B", destinationName: "Barcelona" },
      { name: "Free-text must-see" },
    ];
    const byDay = assignMustVisitToDays(descriptors, items);
    const totalAssigned = [...byDay.values()].reduce((sum, list) => sum + list.length, 0);
    expect(totalAssigned).toBe(items.length);
  });

  it("returns an empty map when there is nothing to assign", () => {
    expect(assignMustVisitToDays(descriptors, []).size).toBe(0);
  });

  it("never throws on an empty descriptor list", () => {
    expect(assignMustVisitToDays([], [{ name: "Anything" }]).size).toBe(0);
  });
});

describe("buildMinimalDaySchema — the per-day call's reduced output contract", () => {
  it("only asks for day-level fields plus per-stop time/placeName/placeCategory/description", () => {
    const schema = buildMinimalDaySchema() as any;
    expect(schema.required.sort()).toEqual(["title", "tip", "estimatedCost", "estimatedCostCurrency", "stops"].sort());
    const stopSchema = schema.properties.stops.items;
    expect(stopSchema.required.sort()).toEqual(["time", "placeName", "placeCategory", "description"].sort());
  });

  it("drops every field the full schema asks for that the backend now resolves itself (googlePlaceId, hours, address, lat, lng, travelTimeToNext, travelModeToNext, date, destination)", () => {
    const minimalStopFields = new Set((buildMinimalDaySchema() as any).properties.stops.items.required);
    const fullStopFields: string[] = (buildItineraryDaysSchema({ dayTipField: "tip" }) as any).properties.days.items.properties.stops.items.required;
    const droppedFields = fullStopFields.filter((f) => !minimalStopFields.has(f));
    expect(droppedFields.sort()).toEqual(
      ["googlePlaceId", "hours", "address", "lat", "lng", "travelTimeToNext", "travelModeToNext"].sort(),
    );
  });
});
