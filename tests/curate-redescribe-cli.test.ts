import { describe, expect, it } from "vitest";

import { parseRedescribeArgs } from "../scripts/curate/redescribe-cli";

describe("parseRedescribeArgs", () => {
  it("parses --only as a list of slugs", () => {
    const opts = parseRedescribeArgs(["--only=lisbon-pt,paris-fr"]);
    expect(opts.only).toEqual(["lisbon-pt", "paris-fr"]);
    expect(opts.all).toBe(false);
  });

  it("parses --all", () => {
    const opts = parseRedescribeArgs(["--all"]);
    expect(opts.all).toBe(true);
  });

  it("parses --ids as numbers", () => {
    const opts = parseRedescribeArgs(["--ids=1,2,3"]);
    expect(opts.ids).toEqual([1, 2, 3]);
  });

  it("parses --dry-run and --yes flags", () => {
    const opts = parseRedescribeArgs(["--all", "--dry-run", "--yes"]);
    expect(opts.dryRun).toBe(true);
    expect(opts.yes).toBe(true);
  });

  it("allows --only combined with --ids", () => {
    const opts = parseRedescribeArgs(["--only=lisbon-pt", "--ids=5"]);
    expect(opts.only).toEqual(["lisbon-pt"]);
    expect(opts.ids).toEqual([5]);
  });

  it("rejects --only and --all together", () => {
    expect(() => parseRedescribeArgs(["--only=lisbon-pt", "--all"])).toThrow();
  });

  it("requires at least one selection", () => {
    expect(() => parseRedescribeArgs(["--dry-run"])).toThrow();
  });

  it("rejects non-positive or non-numeric ids", () => {
    expect(() => parseRedescribeArgs(["--ids=1,0,3"])).toThrow();
    expect(() => parseRedescribeArgs(["--ids=1,abc"])).toThrow();
  });

  it("rejects an unknown flag", () => {
    expect(() => parseRedescribeArgs(["--all", "--bogus"])).toThrow();
  });
});
