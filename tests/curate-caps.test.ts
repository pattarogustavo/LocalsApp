import { describe, expect, it } from "vitest";
import { applyCategoryCaps } from "../scripts/curate/caps";

describe("applyCategoryCaps", () => {
  it("caps a category at its mega-tier limit, keeping the highest-priority items", () => {
    const places = Array.from({ length: 20 }, (_, i) => ({ category: "museum", priority: i }));
    const result = applyCategoryCaps(places, "mega");
    expect(result.length).toBe(15);
    expect(result.every((p) => p.priority >= 5)).toBe(true);
  });

  it("scales the cap down for a smaller tier", () => {
    const places = Array.from({ length: 20 }, (_, i) => ({ category: "museum", priority: i }));
    const result = applyCategoryCaps(places, "small");
    expect(result.length).toBeLessThan(applyCategoryCaps(places, "mega").length);
  });

  it("passes through categories with no configured cap (e.g. restaurant)", () => {
    const places = Array.from({ length: 30 }, (_, i) => ({ category: "restaurant", priority: i }));
    const result = applyCategoryCaps(places, "mega");
    expect(result.length).toBe(30);
  });
});
