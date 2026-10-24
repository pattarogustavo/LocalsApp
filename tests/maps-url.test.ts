import { describe, expect, it } from "vitest";
import { buildDirectionsUrl, buildStopMapsUrl, locatorFor } from "../utils/maps-url";

describe("locatorFor", () => {
  it("prefers coordinates when present", () => {
    expect(locatorFor({ placeName: "Eiffel Tower", lat: 48.8584, lng: 2.2945, address: "Champ de Mars" })).toBe(
      "48.8584,2.2945"
    );
  });

  it("falls back to address when there are no coordinates", () => {
    expect(locatorFor({ placeName: "Eiffel Tower", address: "Champ de Mars, Paris" })).toBe("Champ de Mars, Paris");
  });

  it("falls back to name + destination context when nothing else is known", () => {
    expect(locatorFor({ placeName: "Café Central" }, "Vienna")).toBe("Café Central, Vienna");
  });

  it("falls back to the bare name when there is no context either", () => {
    expect(locatorFor({ placeName: "Café Central" })).toBe("Café Central");
  });
});

describe("buildStopMapsUrl", () => {
  it("builds a working search link even with no coordinates or place id", () => {
    const url = buildStopMapsUrl({ placeName: "Café Central" }, "Vienna");
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=Caf%C3%A9+Central%2C+Vienna");
  });

  it("properly URL-encodes special characters in the place name", () => {
    const url = buildStopMapsUrl({ placeName: "Ben & Jerry's" }, "New York");
    expect(url).toContain("query=Ben+%26+Jerry%27s%2C+New+York");
  });

  it("includes query_place_id when a verified googlePlaceId is present", () => {
    const url = buildStopMapsUrl({ placeName: "Café Central", googlePlaceId: "ChIJabc123" });
    expect(url).toContain("query_place_id=ChIJabc123");
  });

  it("prefers coordinates over name+context when both are present", () => {
    const url = buildStopMapsUrl({ placeName: "Café Central", lat: 48.2, lng: 16.4 }, "Vienna");
    expect(url).toContain("query=48.2%2C16.4");
    expect(url).not.toContain("Vienna");
  });
});

describe("buildDirectionsUrl", () => {
  it("builds an origin/destination/travelmode link from names + context when no coordinates exist", () => {
    const url = buildDirectionsUrl({ placeName: "Hotel A" }, { placeName: "Museum B" }, "walking", "Lisbon");
    expect(url).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=Hotel+A%2C+Lisbon&destination=Museum+B%2C+Lisbon&travelmode=walking"
    );
  });

  it("uses coordinates when available instead of names", () => {
    const url = buildDirectionsUrl(
      { placeName: "Hotel A", lat: 38.7, lng: -9.1 },
      { placeName: "Museum B", lat: 38.71, lng: -9.13 },
      "driving"
    );
    expect(url).toContain("origin=38.7%2C-9.1");
    expect(url).toContain("destination=38.71%2C-9.13");
  });

  it("adds origin_place_id/destination_place_id when verified place ids are present", () => {
    const url = buildDirectionsUrl(
      { placeName: "Hotel A", googlePlaceId: "place-origin" },
      { placeName: "Museum B", googlePlaceId: "place-dest" },
      "transit"
    );
    expect(url).toContain("origin_place_id=place-origin");
    expect(url).toContain("destination_place_id=place-dest");
  });

  it("never fabricates a place id for a stop that doesn't have one", () => {
    const url = buildDirectionsUrl({ placeName: "Hotel A" }, { placeName: "Museum B", googlePlaceId: "place-dest" }, "driving");
    expect(url).not.toContain("origin_place_id");
    expect(url).toContain("destination_place_id=place-dest");
  });
});
