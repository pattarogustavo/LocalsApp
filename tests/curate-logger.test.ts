import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatBatchLine, logFileName, createLogger } from "../scripts/curate/logger";

describe("formatBatchLine", () => {
  it("matches the expected progress format", () => {
    expect(formatBatchLine(3, 8, "ok", 14, 41)).toBe("lote 3/8: ok, 14 lugares, 41 s");
  });

  it("works for a failed batch", () => {
    expect(formatBatchLine(1, 1, "falhou", 0, 5)).toBe("lote 1/1: falhou, 0 lugares, 5 s");
  });
});

describe("logFileName", () => {
  it("formats as curate-<YYYY-MM-DD>.log", () => {
    expect(logFileName(new Date("2026-03-05T10:00:00Z"))).toBe("curate-2026-03-05.log");
  });
});

describe("createLogger", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("log() appends a timestamped line to the file without printing to console", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger(dir, new Date("2026-03-05T10:00:00Z"));
    logger.log("hello");
    expect(logSpy).not.toHaveBeenCalled();
    const content = fs.readFileSync(logger.path, "utf8");
    expect(content).toContain("hello");
    logSpy.mockRestore();
  });

  it("info() both prints and appends to the file", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger(dir, new Date("2026-03-05T10:00:00Z"));
    logger.info("progress update");
    expect(logSpy).toHaveBeenCalledWith("progress update");
    const content = fs.readFileSync(logger.path, "utf8");
    expect(content).toContain("progress update");
    logSpy.mockRestore();
  });

  it("accumulates multiple lines across calls", () => {
    const logger = createLogger(dir, new Date("2026-03-05T10:00:00Z"));
    logger.log("line1");
    logger.log("line2");
    const content = fs.readFileSync(logger.path, "utf8");
    expect(content.split("\n").filter(Boolean)).toHaveLength(2);
  });
});
