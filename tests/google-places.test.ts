import { describe, expect, it } from "vitest";

describe("Google Places API Key", () => {
  it("should be set in environment", () => {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    expect(key).toBeDefined();
    expect(key?.length).toBeGreaterThan(10);
  });

  it("should be able to call Places Autocomplete API", async () => {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Paris&types=(cities)&key=${key}`;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(data.status).toBe("OK");
    expect(data.predictions.length).toBeGreaterThan(0);
    expect(data.predictions[0].description).toContain("Paris");
  }, 10000);
});
