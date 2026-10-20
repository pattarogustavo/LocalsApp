import { describe, it, expect } from "vitest";
import {
  sanitizeTripPatch,
  mergeTripSections,
  getSharedTripSaveError,
  type ShareSaveCheck,
} from "../server/sharing/trip-merge";

describe("sanitizeTripPatch", () => {
  it("keeps whitelisted section keys", () => {
    const patch = { places: [{ id: "p1" }], transport: [{ id: "t1" }] };
    expect(sanitizeTripPatch(patch)).toEqual(patch);
  });

  it("keeps draftItineraryProfile — the in-progress profile questionnaire must survive a cloud sync round-trip, not just AsyncStorage (regression: it used to be silently wiped the next time any OTHER whitelisted section synced, since an unlisted key is dropped from what the server echoes back)", () => {
    const draft = { travelStyles: ["cultura", "arte"], attractionsBudget: "luxo" as const };
    const sanitized = sanitizeTripPatch({ places: [], draftItineraryProfile: draft });
    expect(sanitized.draftItineraryProfile).toEqual(draft);
  });

  it("round-trips a null draftItineraryProfile (clearing it after a successful generation) through merge", () => {
    const current = { draftItineraryProfile: { travelStyles: ["compras"] }, places: [] };
    const merged = mergeTripSections(current, { draftItineraryProfile: null });
    expect(merged.draftItineraryProfile).toBeNull();
  });

  it("drops travelers — only the owner manages the traveler list", () => {
    const sanitized = sanitizeTripPatch({ places: [], travelers: [{ id: "tr1" }] });
    expect(sanitized).toEqual({ places: [] });
    expect(sanitized.travelers).toBeUndefined();
  });

  it("drops id, createdAt, contentLanguage, isFavorite, and updatedAt", () => {
    const sanitized = sanitizeTripPatch({
      id: "trip1",
      createdAt: "2024-01-01",
      contentLanguage: "en",
      isFavorite: true,
      updatedAt: "2024-01-02",
      name: "My Trip",
    });
    expect(sanitized).toEqual({ name: "My Trip" });
  });

  it("drops arbitrary unknown keys a buggy or malicious client might send", () => {
    const sanitized = sanitizeTripPatch({ name: "Trip", __proto__: { polluted: true }, hacked: 1 } as any);
    expect(sanitized).toEqual({ name: "Trip" });
  });

  it("returns an empty object for an empty patch", () => {
    expect(sanitizeTripPatch({})).toEqual({});
  });
});

describe("mergeTripSections", () => {
  it("merges different sections without erasing each other (owner edits Transport, editor edits Places)", () => {
    const current = {
      name: "Paris Trip",
      transport: [{ id: "old-transport" }],
      places: [{ id: "old-place" }],
    };
    const afterOwnerPatch = mergeTripSections(current, { transport: [{ id: "new-transport" }] });
    const afterEditorPatch = mergeTripSections(afterOwnerPatch, { places: [{ id: "new-place" }] });

    expect(afterEditorPatch.transport).toEqual([{ id: "new-transport" }]);
    expect(afterEditorPatch.places).toEqual([{ id: "new-place" }]);
    expect(afterEditorPatch.name).toBe("Paris Trip");
  });

  it("the last write to the same section wins", () => {
    const current = { places: [{ id: "a" }] };
    const afterFirst = mergeTripSections(current, { places: [{ id: "b" }] });
    const afterSecond = mergeTripSections(afterFirst, { places: [{ id: "c" }] });
    expect(afterSecond.places).toEqual([{ id: "c" }]);
  });

  it("an empty patch changes nothing", () => {
    const current = { name: "Trip", places: [{ id: "a" }] };
    expect(mergeTripSections(current, {})).toEqual(current);
  });
});

describe("getSharedTripSaveError", () => {
  const baseShare: ShareSaveCheck = {
    status: "accepted",
    hiddenByInvitee: false,
    role: "editor",
    inviteeUserId: 42,
    inviteeEmail: "guest@example.com",
  };
  const user = { id: 42, email: "guest@example.com" };

  it("allows an accepted editor matched by inviteeUserId", () => {
    expect(getSharedTripSaveError(baseShare, user)).toBeNull();
  });

  it("allows an accepted editor matched by email, case-insensitively, when inviteeUserId doesn't match", () => {
    const share: ShareSaveCheck = { ...baseShare, inviteeUserId: 999 };
    const caseInsensitiveUser = { id: 42, email: "Guest@Example.com" };
    expect(getSharedTripSaveError(share, caseInsensitiveUser)).toBeNull();
  });

  it("rejects a viewer", () => {
    const share: ShareSaveCheck = { ...baseShare, role: "viewer" };
    expect(getSharedTripSaveError(share, user)).toMatch(/visualizadores/i);
  });

  it("rejects a pending (not yet accepted) share", () => {
    const share: ShareSaveCheck = { ...baseShare, status: "pending" };
    expect(getSharedTripSaveError(share, user)).toBeTruthy();
  });

  it("rejects a share the invitee has hidden on their side", () => {
    const share: ShareSaveCheck = { ...baseShare, hiddenByInvitee: true };
    expect(getSharedTripSaveError(share, user)).toBeTruthy();
  });

  it("rejects a revoked share", () => {
    const share: ShareSaveCheck = { ...baseShare, status: "revoked" };
    expect(getSharedTripSaveError(share, user)).toBeTruthy();
  });

  it("rejects a user who doesn't own the share", () => {
    const otherUser = { id: 7, email: "someone-else@example.com" };
    expect(getSharedTripSaveError(baseShare, otherUser)).toBeTruthy();
  });

  it("rejects when the share doesn't exist", () => {
    expect(getSharedTripSaveError(null, user)).toBeTruthy();
  });
});
