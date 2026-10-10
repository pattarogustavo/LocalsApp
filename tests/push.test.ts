import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("push.sendPush", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function loadPushWithTokens(tokens: Array<{ token: string; language: string }>) {
    vi.doMock("../server/db", () => ({
      getPushTokensForUsers: vi.fn(async () => tokens),
      deletePushToken: vi.fn(async () => {}),
    }));
    const db = await import("../server/db");
    const push = await import("../server/push");
    return { push, db };
  }

  it("builds a localized message per device across all 6 supported languages, falling back to pt", async () => {
    const languages = ["pt", "en", "es", "fr", "de", "it", "", "xx"];
    const tokens = languages.map((lang, i) => ({ token: `tok-${i}`, language: lang }));
    const { push } = await loadPushWithTokens(tokens);

    const fetchMock = vi.fn(async () => ({
      json: async () => ({ data: tokens.map(() => ({ status: "ok" })) }),
    }));
    global.fetch = fetchMock as any;

    await push.sendPush([1], (language) => ({
      title: `title-${language}`,
      body: `body-${language}`,
      data: { type: "invite" },
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const sentMessages = JSON.parse(requestInit.body) as Array<{ to: string; title: string }>;
    expect(sentMessages).toHaveLength(tokens.length);
    expect(sentMessages[0].title).toBe("title-pt");
    expect(sentMessages[1].title).toBe("title-en");
    expect(sentMessages[2].title).toBe("title-es");
    expect(sentMessages[3].title).toBe("title-fr");
    expect(sentMessages[4].title).toBe("title-de");
    expect(sentMessages[5].title).toBe("title-it");
    // Empty and unrecognized language codes both fall back to pt.
    expect(sentMessages[6].title).toBe("title-pt");
    expect(sentMessages[7].title).toBe("title-pt");
  });

  it("deletes a token when Expo reports DeviceNotRegistered, and leaves other tokens alone", async () => {
    const tokens = [
      { token: "tok-good", language: "en" },
      { token: "tok-stale", language: "en" },
    ];
    const { push, db } = await loadPushWithTokens(tokens);

    global.fetch = vi.fn(async () => ({
      json: async () => ({
        data: [
          { status: "ok" },
          { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
        ],
      }),
    })) as any;

    await push.sendPush([1], () => ({ title: "t", body: "b" }));

    expect(db.deletePushToken).toHaveBeenCalledTimes(1);
    expect(db.deletePushToken).toHaveBeenCalledWith("tok-stale");
  });

  it("never throws when the Expo request fails outright", async () => {
    const { push } = await loadPushWithTokens([{ token: "tok-1", language: "en" }]);
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as any;

    await expect(push.sendPush([1], () => ({ title: "t", body: "b" }))).resolves.toBeUndefined();
  });

  it("does nothing (and never throws) when the user has no registered devices", async () => {
    const { push } = await loadPushWithTokens([]);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    await expect(push.sendPush([1], () => ({ title: "t", body: "b" }))).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
