import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/curate/cli-args";

describe("parseArgs", () => {
  it("parses a pilot generate run", () => {
    const opts = parseArgs(["generate", "--pilot"]);
    expect(opts).toMatchObject({ command: "generate", pilot: true, all: false, plan: false, dryRun: false, yes: false, refresh: false });
  });

  it("parses --only as a trimmed, comma-separated list", () => {
    const opts = parseArgs(["export", "--only= paris-fr, london-gb "]);
    expect(opts.only).toEqual(["paris-fr", "london-gb"]);
  });

  it("parses --max-google-calls", () => {
    const opts = parseArgs(["generate", "--all", "--max-google-calls=200"]);
    expect(opts.maxGoogleCalls).toBe(200);
  });

  it("parses --refresh", () => {
    const opts = parseArgs(["generate", "--pilot", "--refresh"]);
    expect(opts.refresh).toBe(true);
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["nope", "--pilot"])).toThrow(/Unknown command/);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["generate", "--pilot", "--bogus"])).toThrow(/Unknown flag/);
  });

  it("requires an explicit destination selection for generate/verify/translate/export", () => {
    expect(() => parseArgs(["generate"])).toThrow(/Specify a destination selection/);
    expect(() => parseArgs(["verify"])).toThrow(/Specify a destination selection/);
    expect(() => parseArgs(["translate"])).toThrow(/Specify a destination selection/);
    expect(() => parseArgs(["export"])).toThrow(/Specify a destination selection/);
  });

  it("rejects a non-positive --max-google-calls", () => {
    expect(() => parseArgs(["generate", "--pilot", "--max-google-calls=0"])).toThrow(/positive number/);
  });

  it("allows 'check' with no destination selection", () => {
    const opts = parseArgs(["check"]);
    expect(opts.command).toBe("check");
  });

  it("allows 'smoke' with no destination selection, and accepts --only to override the default", () => {
    expect(parseArgs(["smoke"]).command).toBe("smoke");
    const opts = parseArgs(["smoke", "--only=paris-fr"]);
    expect(opts.only).toEqual(["paris-fr"]);
  });

  describe("add", () => {
    it("parses --names as a trimmed, semicolon-separated list", () => {
      const opts = parseArgs(["add", "--only=london-gb", '--names=Buckingham Palace; Big Ben ; Trafalgar Square']);
      expect(opts.command).toBe("add");
      expect(opts.names).toEqual(["Buckingham Palace", "Big Ben", "Trafalgar Square"]);
    });

    it("requires --names", () => {
      expect(() => parseArgs(["add", "--only=london-gb"])).toThrow(/--names/);
    });

    it("requires a destination selection at all", () => {
      expect(() => parseArgs(["add", "--names=Big Ben"])).toThrow(/Specify a destination selection/);
    });

    it("rejects more than one --only destination", () => {
      expect(() => parseArgs(["add", "--only=paris-fr,london-gb", "--names=Big Ben"])).toThrow(/exactly one destination/);
    });

    it("rejects --pilot/--all", () => {
      expect(() => parseArgs(["add", "--pilot", "--names=Big Ben"])).toThrow(/single destination/);
      expect(() => parseArgs(["add", "--all", "--names=Big Ben"])).toThrow(/single destination/);
    });

    it("accepts --dry-run and --yes like other commands", () => {
      const opts = parseArgs(["add", "--only=london-gb", "--names=Big Ben", "--dry-run", "--yes"]);
      expect(opts.dryRun).toBe(true);
      expect(opts.yes).toBe(true);
    });
  });
});
