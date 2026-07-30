import { describe, it, expect } from "vitest";

describe("Supabase credentials", () => {
  it("should have EXPO_PUBLIC_SUPABASE_URL set and reachable", async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(url, "EXPO_PUBLIC_SUPABASE_URL must be set").toBeTruthy();
    expect(url).toMatch(/^https:\/\/.+\.supabase\.co$/);

    // Ping the health endpoint
    const res = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
      },
    });
    // 200 or 404 both mean the project is reachable
    // 200, 400, 401, 404 all mean the project is reachable (401 = anon key mismatch but URL valid)
    expect([200, 400, 401, 404]).toContain(res.status);
  });

  it("should have EXPO_PUBLIC_SUPABASE_ANON_KEY set", () => {
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    expect(key, "EXPO_PUBLIC_SUPABASE_ANON_KEY must be set").toBeTruthy();
    expect(key!.length).toBeGreaterThan(20);
  });

  it("should have SUPABASE_JWT_SECRET set", () => {
    const secret = process.env.SUPABASE_JWT_SECRET;
    expect(secret, "SUPABASE_JWT_SECRET must be set").toBeTruthy();
    expect(secret!.length).toBeGreaterThan(10);
  });
});
