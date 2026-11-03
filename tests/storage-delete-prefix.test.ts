import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const removeMock = vi.fn();
const fromMock = vi.fn(() => ({ list: listMock, remove: removeMock }));

vi.mock("../server/_core/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ storage: { from: fromMock } }),
}));

const ORIGINAL_ENV = { ...process.env };

async function freshStorageDeletePrefix() {
  process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
  vi.resetModules();
  const mod = await import("../server/storage");
  return mod.storageDeletePrefix;
}

function file(name: string) {
  return { name, id: "11111111-1111-1111-1111-111111111111", metadata: {} };
}

function folder(name: string) {
  return { name, id: null, metadata: null };
}

beforeEach(() => {
  listMock.mockReset();
  removeMock.mockReset();
  fromMock.mockClear();
  removeMock.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("storageDeletePrefix", () => {
  it("deletes every file found under the prefix, using the right bucket", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    listMock.mockResolvedValueOnce({ data: [file("a.pdf"), file("b.jpg")], error: null });

    await storageDeletePrefix("trip-documents/42/");

    expect(fromMock).toHaveBeenCalledWith("test-bucket");
    expect(listMock).toHaveBeenCalledWith("trip-documents/42", { limit: 100, offset: 0 });
    expect(removeMock).toHaveBeenCalledWith(["trip-documents/42/a.pdf", "trip-documents/42/b.jpg"]);
  });

  it("paginates through list results until a short page is returned", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    const fullPage = Array.from({ length: 100 }, (_, i) => file(`f${i}.jpg`));
    listMock
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [file("last.jpg")], error: null });

    await storageDeletePrefix("trip-documents/7/");

    expect(listMock).toHaveBeenNthCalledWith(1, "trip-documents/7", { limit: 100, offset: 0 });
    expect(listMock).toHaveBeenNthCalledWith(2, "trip-documents/7", { limit: 100, offset: 100 });
    expect(removeMock).toHaveBeenCalledTimes(2);
    const removedPaths = removeMock.mock.calls.flatMap((call) => call[0] as string[]);
    expect(removedPaths).toHaveLength(101);
    expect(removedPaths).toContain("trip-documents/7/last.jpg");
  });

  it("recurses into subfolders (one per trip) and only deletes files under them", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    listMock
      .mockResolvedValueOnce({ data: [folder("tripA"), folder("tripB")], error: null })
      .mockResolvedValueOnce({ data: [file("doc1.pdf")], error: null })
      .mockResolvedValueOnce({ data: [file("doc2.pdf")], error: null });

    await storageDeletePrefix("trip-documents/42/");

    expect(listMock).toHaveBeenCalledWith("trip-documents/42/tripA", { limit: 100, offset: 0 });
    expect(listMock).toHaveBeenCalledWith("trip-documents/42/tripB", { limit: 100, offset: 0 });
    expect(removeMock).toHaveBeenCalledWith([
      "trip-documents/42/tripA/doc1.pdf",
      "trip-documents/42/tripB/doc2.pdf",
    ]);
  });

  it("never touches another user's prefix", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    listMock.mockResolvedValueOnce({ data: [file("mine.pdf")], error: null });

    await storageDeletePrefix("trip-documents/42/");

    for (const call of listMock.mock.calls) {
      expect(String(call[0])).toMatch(/^trip-documents\/42(\/|$)/);
    }
    for (const call of removeMock.mock.calls) {
      for (const path of call[0] as string[]) {
        expect(path.startsWith("trip-documents/99/")).toBe(false);
      }
    }
  });

  it("throws a clear error when listing fails", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    listMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(storageDeletePrefix("trip-documents/42/")).rejects.toThrow(/Storage list failed/);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("throws a clear error when removal fails", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    listMock.mockResolvedValueOnce({ data: [file("a.pdf")], error: null });
    removeMock.mockResolvedValueOnce({ data: null, error: { message: "nope" } });

    await expect(storageDeletePrefix("trip-documents/42/")).rejects.toThrow(/Storage delete failed/);
  });

  it("does nothing when the prefix is empty", async () => {
    const storageDeletePrefix = await freshStorageDeletePrefix();
    listMock.mockResolvedValueOnce({ data: [], error: null });

    await storageDeletePrefix("trip-documents/42/");

    expect(removeMock).not.toHaveBeenCalled();
  });
});
