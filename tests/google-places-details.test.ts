import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchCuratedPlaceDetails } from "../server/google-places";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * fetchCuratedPlaceDetails is the hottest Google Places call in the
 * itinerary-generation path (resolveAndVerifyStop runs it once per
 * AI-proposed stop). Resolving a photo URL is its own extra network
 * round-trip on top of the Place Details call itself — most callers never
 * read imageUrl, so `includePhoto: false` must skip that second request
 * entirely while still reporting whether a photo exists via `hasPhoto`
 * (itinerary-generation latency fix).
 */
describe("fetchCuratedPlaceDetails includePhoto option", () => {
  function mockDetailsWithPhoto() {
    return vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("/details/json")) {
        return {
          ok: true,
          json: async () => ({
            status: "OK",
            result: {
              formatted_address: "123 Real St",
              geometry: { location: { lat: 1, lng: 2 } },
              photos: [{ photo_reference: "ref-1", width: 800, height: 600 }],
            },
          }),
        } as any;
      }
      if (u.pathname.includes("/photo")) {
        return { ok: true, url: "https://lh3.googleusercontent.com/resolved" } as any;
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
  }

  it("includePhoto: false never calls the photo endpoint, but still reports hasPhoto", async () => {
    const fetchMock = mockDetailsWithPhoto();
    vi.stubGlobal("fetch", fetchMock);

    const details = await fetchCuratedPlaceDetails("place-1", "en", { includePhoto: false });

    expect(details.imageUrl).toBeUndefined();
    expect(details.hasPhoto).toBe(true);
    expect(details.address).toBe("123 Real St");
    expect(details.lat).toBe(1);
    expect(details.lng).toBe(2);
    // Exactly one HTTP call (Place Details) — the photo-redirect fetch never happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includePhoto defaulting to true still resolves the photo URL (unchanged behavior for existing callers)", async () => {
    const fetchMock = mockDetailsWithPhoto();
    vi.stubGlobal("fetch", fetchMock);

    const details = await fetchCuratedPlaceDetails("place-1", "en");

    expect(details.imageUrl).toBe("https://lh3.googleusercontent.com/resolved");
    expect(details.hasPhoto).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hasPhoto is false when the place has no photos, regardless of includePhoto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "OK",
          result: { formatted_address: "No Photo Place", geometry: { location: { lat: 3, lng: 4 } } },
        }),
      })) as any,
    );

    const details = await fetchCuratedPlaceDetails("place-2", "en", { includePhoto: true });
    expect(details.hasPhoto).toBe(false);
    expect(details.imageUrl).toBeUndefined();
  });
});
