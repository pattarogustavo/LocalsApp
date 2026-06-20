import { describe, it, expect } from "vitest";

describe("OpenWeatherMap API Key", () => {
  it("should be able to fetch weather data with the provided API key", async () => {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    expect(apiKey, "OPENWEATHERMAP_API_KEY must be set").toBeTruthy();

    // Test with London coordinates (lat=51.5, lon=-0.12) for a known city
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=51.5&lon=-0.12&appid=${apiKey}&units=metric&cnt=1`
    );

    expect(response.status, `API returned status ${response.status} - check if the key is valid`).toBe(200);

    const data = await response.json();
    expect(data.list).toBeDefined();
    expect(data.list.length).toBeGreaterThan(0);
    expect(data.list[0].main.temp).toBeDefined();
  }, 15000);
});
