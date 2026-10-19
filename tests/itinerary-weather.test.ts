import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

async function freshWeatherModule() {
  vi.resetModules();
  return import("../server/itinerary/weather");
}

describe("fetchForecastSummary (reuses the existing OpenWeatherMap integration)", () => {
  beforeEach(() => {
    process.env.OPENWEATHERMAP_API_KEY = "test-weather-key";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it("returns an empty map (no invented forecast) when no API key is configured", async () => {
    delete process.env.OPENWEATHERMAP_API_KEY;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const { fetchForecastSummary } = await freshWeatherModule();
    const result = await fetchForecastSummary(48.85, 2.35, ["2026-11-01"]);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("groups 3-hour entries by day and only returns the requested dates that are actually present in the forecast window", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        list: [
          { dt_txt: "2026-11-01 09:00:00", main: { temp: 10 }, weather: [{ description: "clear sky" }], pop: 0.1 },
          { dt_txt: "2026-11-01 12:00:00", main: { temp: 15 }, weather: [{ description: "light rain" }], pop: 0.6 },
          { dt_txt: "2026-11-01 18:00:00", main: { temp: 12 }, weather: [{ description: "overcast" }], pop: 0.3 },
        ],
      }),
    });
    global.fetch = fetchMock as any;
    const { fetchForecastSummary } = await freshWeatherModule();
    // "2026-11-09" is requested but not present in the (short) forecast window.
    const result = await fetchForecastSummary(48.85, 2.35, ["2026-11-01", "2026-11-09"]);

    expect(result.has("2026-11-09")).toBe(false);
    const day = result.get("2026-11-01")!;
    expect(day.tempMinC).toBe(10);
    expect(day.tempMaxC).toBe(15);
    expect(day.description).toBe("light rain"); // picked from the midday (12:00) entry
    expect(day.rainProbability).toBe(0.6);
  });

  it("never throws on a network/API failure — returns whatever could be parsed (possibly empty)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as any;
    const { fetchForecastSummary } = await freshWeatherModule();
    await expect(fetchForecastSummary(0, 0, ["2026-01-01"])).resolves.toBeInstanceOf(Map);
  });
});

describe("computeApproxSunTimes (deterministic solar-position formula, no paid API)", () => {
  it("gives a near-equator, near-equinox location sunrise/sunset close to 6:00/18:00 local", async () => {
    const { computeApproxSunTimes } = await freshWeatherModule();
    // Quito, Ecuador is on the equator; late March is close to the equinox.
    const result = computeApproxSunTimes(-0.1807, -78.4678, "2026-03-20");
    expect(result.polarExtreme).toBe(false);
    const [sunriseH] = result.sunriseLocal.split(":").map(Number);
    const [sunsetH] = result.sunsetLocal.split(":").map(Number);
    expect(sunriseH).toBeGreaterThanOrEqual(5);
    expect(sunriseH).toBeLessThanOrEqual(7);
    expect(sunsetH).toBeGreaterThanOrEqual(17);
    expect(sunsetH).toBeLessThanOrEqual(19);
  });

  it("gives a longer day in a northern-hemisphere city in summer than in winter", async () => {
    const { computeApproxSunTimes } = await freshWeatherModule();
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const dayLengthMinutes = (sunrise: string, sunset: string) => toMinutes(sunset) - toMinutes(sunrise);

    const london = { lat: 51.5074, lng: -0.1278 };
    const summer = computeApproxSunTimes(london.lat, london.lng, "2026-06-21");
    const winter = computeApproxSunTimes(london.lat, london.lng, "2026-12-21");
    expect(dayLengthMinutes(summer.sunriseLocal, summer.sunsetLocal)).toBeGreaterThan(
      dayLengthMinutes(winter.sunriseLocal, winter.sunsetLocal),
    );
  });

  it("flags polarExtreme instead of returning a misleading single sunrise/sunset during polar night", async () => {
    const { computeApproxSunTimes } = await freshWeatherModule();
    // Deep in the Arctic Circle, December — polar night.
    const result = computeApproxSunTimes(78.9, 11.9, "2026-12-21");
    expect(result.polarExtreme).toBe(true);
  });

  it("is a pure function of (lat, lng, date) — same input always gives the same output", async () => {
    const { computeApproxSunTimes } = await freshWeatherModule();
    const a = computeApproxSunTimes(35.6762, 139.6503, "2026-07-04");
    const b = computeApproxSunTimes(35.6762, 139.6503, "2026-07-04");
    expect(a).toEqual(b);
  });
});
