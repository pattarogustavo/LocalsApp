import { PATCHABLE_TRIP_SECTION_KEYS } from "../../shared/trip-sections";

const ALLOWED_KEYS = new Set<string>(PATCHABLE_TRIP_SECTION_KEYS);

/** Generous ceiling on a single patch's JSON size, to keep an abusive/buggy client from writing an unbounded blob. */
export const MAX_PATCH_JSON_LENGTH = 2_000_000;

/**
 * Drops any key not in the patchable whitelist (e.g. `travelers`, `id`,
 * `isFavorite`). Pure — no DB access, safe to unit test directly.
 */
export function sanitizeTripPatch(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (ALLOWED_KEYS.has(key)) out[key] = raw[key];
  }
  return out;
}

/**
 * Shallow per-section merge: every key present in `patch` fully replaces
 * that section on `current`; every other section of `current` is left
 * untouched. This is what lets an owner editing Transport and an editor
 * editing Places save concurrently without either erasing the other —
 * each patch only ever carries the sections that actually changed.
 * Pure — no DB access, safe to unit test directly.
 */
export function mergeTripSections(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return { ...current, ...patch };
}

export interface ShareSaveCheck {
  status: string;
  hiddenByInvitee: boolean;
  role: string;
  inviteeUserId: number | null;
  inviteeEmail: string;
}

/**
 * Validates whether `user` may save an edit through a given share. Returns
 * a user-facing error message, or `null` when the save is allowed. Pure —
 * no DB access, safe to unit test directly.
 */
export function getSharedTripSaveError(
  share: ShareSaveCheck | null,
  user: { id: number; email: string | null }
): string | null {
  if (!share) return "Convite não encontrado.";
  if (share.status !== "accepted" || share.hiddenByInvitee) {
    return "Este convite não está mais ativo.";
  }
  const ownsShare =
    share.inviteeUserId === user.id ||
    (!!user.email && share.inviteeEmail.toLowerCase() === user.email.toLowerCase());
  if (!ownsShare) return "Este convite não pertence a você.";
  if (share.role !== "editor") return "Visualizadores não podem editar esta viagem.";
  return null;
}
