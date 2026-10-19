import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google Routes API integration (server/itinerary/routes.ts) — ALL tests
 * here mock global `fetch`; no live call to routes.googleapis.com or the
 * legacy Directions API is ever made. See the migration report for the
 * official doc sources this module's request shape/headers were verified
 * against.
 */

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

async function freshRoutesModule() {
  vi.resetModules();
  return import("../server/itinerary/routes");
}

describe("computeRoute (Google Routes API — computeRoutes)", () => {
  beforeEach(() => {
    process.env.GOOGLE_DIRECTIONS_API_KEY = "test-routes-key";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it("returns null without making a request when no key is configured", async () => {
    delete process.env.GOOGLE_DIRECTIONS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const { computeRoute } = await freshRoutesModule();
    const result = await computeRoute({ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, "DRIVE");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the API key via the X-Goog-Api-Key header (not a query param) and a non-empty field mask", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ duration: "734s", distanceMeters: 5200 }] }),
    });
    global.fetch = fetchMock as any;
    const { computeRoute } = await freshRoutesModule();
    const result = await computeRoute({ lat: 48.8566, lng: 2.3522 }, { lat: 48.853, lng: 2.3499 }, "WALK");

    expect(result).toEqual({ durationSeconds: 734, distanceMeters: 5200 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("routes.googleapis.com");
    expect(url).not.toContain("key="); // never the legacy query-param auth style
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-routes-key");
    expect(init.headers["X-Goog-FieldMask"]).toMatch(/duration/);
    expect(init.headers["X-Goog-FieldMask"]).toMatch(/distanceMeters/);
    const body = JSON.parse(init.body);
    expect(body.travelMode).toBe("WALK");
    expect(body.routingPreference).toBeUndefined(); // only valid for DRIVE/TWO_WHEELER
  });

  it("sets routingPreference TRAFFIC_AWARE for DRIVE but not for WALK/TRANSIT/BICYCLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: "60s", distanceMeters: 100 }] }) });
    global.fetch = fetchMock as any;
    const { computeRoute } = await freshRoutesModule();

    await computeRoute({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, "DRIVE");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).routingPreference).toBe("TRAFFIC_AWARE");

    await computeRoute({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, "TRANSIT");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).routingPreference).toBeUndefined();
  });

  it("retries exactly once on a 429/5xx transient error, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "unavailable" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ routes: [{ duration: "100s", distanceMeters: 500 }] }) });
    global.fetch = fetchMock as any;
    const { computeRoute } = await freshRoutesModule();
    const result = await computeRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, "DRIVE");
    expect(result).toEqual({ durationSeconds: 100, distanceMeters: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry (never an unbounded loop) and returns null rather than throwing to the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "still down" });
    global.fetch = fetchMock as any;
    const { computeRoute } = await freshRoutesModule();
    const result = await computeRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, "DRIVE");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 try + 1 retry, never more
  });

  it("does not retry a permanent 400/403 (e.g. Routes API not enabled on the project) and returns null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Routes API has not been used in project" });
    global.fetch = fetchMock as any;
    const { computeRoute } = await freshRoutesModule();
    const result = await computeRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, "DRIVE");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("computeRouteMatrix (Google Routes API — computeRouteMatrix)", () => {
  beforeEach(() => {
    process.env.GOOGLE_DIRECTIONS_API_KEY = "test-routes-key";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it("parses the array-shaped response (not a wrapped object) into per-pair elements", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { originIndex: 0, destinationIndex: 0, duration: "300s", distanceMeters: 1000, status: {} },
        { originIndex: 0, destinationIndex: 1, duration: "600s", distanceMeters: 2500, status: {} },
      ],
    });
    global.fetch = fetchMock as any;
    const { computeRouteMatrix } = await freshRoutesModule();
    const result = await computeRouteMatrix([{ lat: 0, lng: 0 }], [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], "DRIVE");
    expect(result).toEqual([
      { originIndex: 0, destinationIndex: 0, durationSeconds: 300, distanceMeters: 1000, status: "OK" },
      { originIndex: 0, destinationIndex: 1, durationSeconds: 600, distanceMeters: 2500, status: "OK" },
    ]);
  });

  it("includes `status` in the field mask so a partial-failure element is never mistaken for OK by omission", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    global.fetch = fetchMock as any;
    const { computeRouteMatrix } = await freshRoutesModule();
    await computeRouteMatrix([{ lat: 0, lng: 0 }], [{ lat: 1, lng: 1 }], "DRIVE");
    expect(fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"]).toMatch(/\bstatus\b/);
  });

  it("marks an element with a non-zero status code as ERROR and zeroes its duration/distance instead of guessing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ originIndex: 0, destinationIndex: 0, status: { code: 7, message: "permission denied" } }],
    });
    global.fetch = fetchMock as any;
    const { computeRouteMatrix } = await freshRoutesModule();
    const [el] = await computeRouteMatrix([{ lat: 0, lng: 0 }], [{ lat: 1, lng: 1 }], "DRIVE");
    expect(el.status).toBe("ERROR");
    expect(el.durationSeconds).toBe(0);
  });

  it("throws BEFORE making a request when the origins×destinations count exceeds the TRANSIT 100-pair cap", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const { computeRouteMatrix, RoutesApiError } = await freshRoutesModule();
    const origins = Array.from({ length: 11 }, () => ({ lat: 0, lng: 0 }));
    const destinations = Array.from({ length: 10 }, () => ({ lat: 1, lng: 1 })); // 110 > 100
    await expect(computeRouteMatrix(origins, destinations, "TRANSIT")).rejects.toThrow(RoutesApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the same element count for DRIVE (625 cap), well above the TRANSIT cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    global.fetch = fetchMock as any;
    const { computeRouteMatrix } = await freshRoutesModule();
    const origins = Array.from({ length: 11 }, () => ({ lat: 0, lng: 0 }));
    const destinations = Array.from({ length: 10 }, () => ({ lat: 1, lng: 1 })); // 110, fine for DRIVE
    await expect(computeRouteMatrix(origins, destinations, "DRIVE")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array (never throws) on a request failure after its one retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "down" });
    global.fetch = fetchMock as any;
    const { computeRouteMatrix } = await freshRoutesModule();
    const result = await computeRouteMatrix([{ lat: 0, lng: 0 }], [{ lat: 1, lng: 1 }], "DRIVE");
    expect(result).toEqual([]);
  });
});

describe("buildTravelFetcher — itinerary-facing travel fetcher with legacy-Directions fallback", () => {
  beforeEach(() => {
    process.env.GOOGLE_DIRECTIONS_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it("uses the Routes API result and builds a maps.google.com nav link via its own URL scheme (not derived from the Routes API response)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ duration: "1800s", distanceMeters: 8000 }] }),
    });
    global.fetch = fetchMock as any;
    const { buildTravelFetcher } = await freshRoutesModule();
    const fetchTravel = buildTravelFetcher("car", "pt");
    const result = await fetchTravel(48.8566, 2.3522, 48.86, 2.34);

    expect(result).not.toBeNull();
    expect(result!.mode).toBe("driving");
    expect(result!.durationMinutes).toBe(30);
    expect(result!.mapsUrl).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=48.8566,2.3522&destination=48.86,2.34&travelmode=driving",
    );
  });

  it("re-checks short hops (<1.2km) against walking and prefers it when under 15 minutes", async () => {
    const fetchMock = vi
      .fn()
      // primary DRIVE call
      .mockResolvedValueOnce({ ok: true, json: async () => ({ routes: [{ duration: "300s", distanceMeters: 900 }] }) })
      // walking re-check call
      .mockResolvedValueOnce({ ok: true, json: async () => ({ routes: [{ duration: "420s", distanceMeters: 900 }] }) });
    global.fetch = fetchMock as any;
    const { buildTravelFetcher } = await freshRoutesModule();
    const fetchTravel = buildTravelFetcher("car", "pt");
    const result = await fetchTravel(0, 0, 0.005, 0.005);
    expect(result!.mode).toBe("walking");
    expect(result!.durationMinutes).toBe(7);
  });

  it("falls back to the legacy Directions API when the Routes API call fails (e.g. Routes API not enabled yet)", async () => {
    const fetchMock = vi
      .fn()
      // Routes API primary call fails permanently (403 is not retryable, so
      // computeRoute makes exactly one attempt before giving up and
      // returning null — see the dedicated non-retry test above).
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Routes API not enabled" })
      // legacy Directions API call succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "OK",
          routes: [{ legs: [{ duration: { text: "12 mins", value: 720 }, distance: { text: "5 km", value: 5000 } }] }],
        }),
      });
    global.fetch = fetchMock as any;
    const { buildTravelFetcher } = await freshRoutesModule();
    const fetchTravel = buildTravelFetcher("car", "pt");
    const result = await fetchTravel(0, 0, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.durationMinutes).toBe(12);
    // the legacy fallback call hit the legacy Directions endpoint
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("maps.googleapis.com/maps/api/directions/json");
  });

  it("maps cityTransportMode 'public' to TRANSIT", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: "600s", distanceMeters: 3000 }] }) });
    global.fetch = fetchMock as any;
    const { buildTravelFetcher } = await freshRoutesModule();
    const fetchTravel = buildTravelFetcher("public", "pt");
    const result = await fetchTravel(0, 0, 1, 1);
    expect(result!.mode).toBe("transit");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).travelMode).toBe("TRANSIT");
  });
});
