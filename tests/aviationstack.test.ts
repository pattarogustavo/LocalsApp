import { describe, it, expect } from "vitest";

describe("AviationStack API", () => {
  it("should have AVIATIONSTACK_API_KEY set", () => {
    expect(process.env.AVIATIONSTACK_API_KEY).toBeDefined();
    expect((process.env.AVIATIONSTACK_API_KEY ?? "").length).toBeGreaterThan(10);
  });

  it("should return a valid response from AviationStack", async () => {
    const key = process.env.AVIATIONSTACK_API_KEY;
    const url = new URL("http://api.aviationstack.com/v1/flights");
    url.searchParams.set("access_key", key!);
    url.searchParams.set("flight_iata", "LA8084");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString());
    expect(res.ok).toBe(true);

    const json = (await res.json()) as any;
    // AviationStack returns { data: [...] } or { error: {...} }
    // On free plan, data may be empty for past flights but the key should be valid
    expect(json).toBeDefined();
    expect(json.error).toBeUndefined();
  }, 15000);
});
