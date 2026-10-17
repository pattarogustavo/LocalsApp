import { describe, expect, it } from "vitest";
import { parseImportArgs } from "../scripts/curate/import-cli";

describe("parseImportArgs", () => {
  it("parses --file with defaults", () => {
    const opts = parseImportArgs(["--file=import/lisbon-pt.json"]);
    expect(opts).toMatchObject({ file: "import/lisbon-pt.json", dir: undefined, status: "pending", translate: false, dryRun: false, yes: false });
  });

  it("parses --dir", () => {
    const opts = parseImportArgs(["--dir=import"]);
    expect(opts.dir).toBe("import");
    expect(opts.file).toBeUndefined();
  });

  it("parses --status=approved", () => {
    const opts = parseImportArgs(["--file=x.json", "--status=approved"]);
    expect(opts.status).toBe("approved");
  });

  it("rejects an invalid --status", () => {
    expect(() => parseImportArgs(["--file=x.json", "--status=bogus"])).toThrow(/pending.*approved/);
  });

  it("parses --translate, --dry-run and --yes", () => {
    const opts = parseImportArgs(["--file=x.json", "--translate", "--dry-run", "--yes"]);
    expect(opts.translate).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.yes).toBe(true);
  });

  it("parses --max-google-calls", () => {
    const opts = parseImportArgs(["--file=x.json", "--max-google-calls=50"]);
    expect(opts.maxGoogleCalls).toBe(50);
  });

  it("requires exactly one of --file or --dir", () => {
    expect(() => parseImportArgs([])).toThrow(/--file.*--dir/);
    expect(() => parseImportArgs(["--file=x.json", "--dir=y"])).toThrow(/only one/);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseImportArgs(["--file=x.json", "--bogus"])).toThrow(/Unknown flag/);
  });

  it("rejects a non-positive --max-google-calls", () => {
    expect(() => parseImportArgs(["--file=x.json", "--max-google-calls=0"])).toThrow(/positive number/);
  });
});
