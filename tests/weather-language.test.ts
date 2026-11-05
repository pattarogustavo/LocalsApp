import { describe, expect, it } from "vitest";
import { mapLanguageToOpenWeatherLang } from "../server/routers";

describe("mapLanguageToOpenWeatherLang", () => {
  it("maps pt to pt_br", () => {
    expect(mapLanguageToOpenWeatherLang("pt")).toBe("pt_br");
  });

  it("maps en, es, fr, de, it to themselves", () => {
    expect(mapLanguageToOpenWeatherLang("en")).toBe("en");
    expect(mapLanguageToOpenWeatherLang("es")).toBe("es");
    expect(mapLanguageToOpenWeatherLang("fr")).toBe("fr");
    expect(mapLanguageToOpenWeatherLang("de")).toBe("de");
    expect(mapLanguageToOpenWeatherLang("it")).toBe("it");
  });

  it("defaults to en for an unsupported or missing language", () => {
    expect(mapLanguageToOpenWeatherLang(undefined)).toBe("en");
    expect(mapLanguageToOpenWeatherLang("")).toBe("en");
    expect(mapLanguageToOpenWeatherLang("ja")).toBe("en");
  });

  it("is case-insensitive and tolerates locale suffixes", () => {
    expect(mapLanguageToOpenWeatherLang("PT")).toBe("pt_br");
    expect(mapLanguageToOpenWeatherLang("pt-BR")).toBe("pt_br");
  });
});

describe("weather.forecast URL uses the mapped lang param", () => {
  it("builds the OpenWeatherMap URL with &lang=<mapped code>", () => {
    const lang = mapLanguageToOpenWeatherLang("pt");
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=1&lon=2&appid=KEY&units=metric&cnt=40&lang=${lang}`;
    expect(url).toContain("&lang=pt_br");
  });
});
