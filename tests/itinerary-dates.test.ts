import { describe, it, expect } from "vitest";
import { addDaysToDateString, normalizeToDateOnlyString } from "../server/itinerary/dates";

describe("normalizeToDateOnlyString", () => {
  it("passes through a bare YYYY-MM-DD date unchanged", () => {
    expect(normalizeToDateOnlyString("2026-06-01")).toBe("2026-06-01");
  });

  it("extracts the date part from a full ISO datetime (trip.startDate's actual stored shape)", () => {
    expect(normalizeToDateOnlyString("2026-06-01T11:31:15.033Z")).toBe("2026-06-01");
  });

  it("extracts the date part regardless of timezone offset in the datetime", () => {
    expect(normalizeToDateOnlyString("2026-06-01T23:59:00.000-03:00")).toBe("2026-06-01");
  });

  it("rejects an invalid date string instead of silently producing an Invalid Date", () => {
    expect(() => normalizeToDateOnlyString("not-a-date")).toThrow(/Data inválida/);
  });

  it("rejects an empty string", () => {
    expect(() => normalizeToDateOnlyString("")).toThrow(/Data inválida/);
  });

  it("rejects a malformed calendar date (e.g. month 13)", () => {
    expect(() => normalizeToDateOnlyString("2026-13-40")).toThrow(/Data inválida/);
  });
});

describe("addDaysToDateString", () => {
  it("adds days to a bare date string", () => {
    expect(addDaysToDateString("2026-06-01", 3)).toBe("2026-06-04");
  });

  it("does not throw 'Invalid time value' when given the full ISO datetime trip.startDate actually is — this is the exact production regression", () => {
    const fullIsoStartDate = new Date("2026-06-01T11:31:15.033Z").toISOString();
    expect(() => addDaysToDateString(fullIsoStartDate, 0)).not.toThrow();
    expect(addDaysToDateString(fullIsoStartDate, 0)).toBe("2026-06-01");
  });

  it("correctly crosses a month/day boundary", () => {
    expect(addDaysToDateString("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("correctly crosses a year boundary (overnight/date transition)", () => {
    expect(addDaysToDateString("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("propagates a clear validation error for an unparsable date instead of a bare RangeError", () => {
    expect(() => addDaysToDateString("garbage", 1)).toThrow(/Data inválida/);
  });
});
