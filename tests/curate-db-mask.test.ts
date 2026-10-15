import { describe, expect, it } from "vitest";
import { maskDatabaseHost } from "../scripts/curate/db";

describe("maskDatabaseHost", () => {
  it("masks the host's first label, keeping the scheme and port visible", () => {
    const result = maskDatabaseHost("postgres://user:pass@db.supabase.co:5432/postgres");
    expect(result).toBe("postgres://db***.supabase.co:5432");
    expect(result).not.toContain("user");
    expect(result).not.toContain("pass");
  });

  it("falls back to a placeholder for an unparseable string", () => {
    expect(maskDatabaseHost("not-a-url")).toBe("(unparseable connection string)");
  });
});
