/**
 * Top-level Trip JSON keys that may be sent in a partial sync patch
 * (cloudTrips.patch / sharing.saveSharedTrip) instead of re-uploading the
 * whole trip. Keeping this single list shared between the client's diffing
 * logic (store/trips.ts) and the server's patch validation
 * (server/sharing/trip-merge.ts) keeps them from drifting apart.
 *
 * Deliberately excluded, and always ignored by the server if present in a
 * patch:
 * - `travelers` — only the owner manages the traveler/invite list.
 * - `id`, `createdAt` — identity, never changes after creation.
 * - `contentLanguage` — owned by the translation pipeline (trip.translateContent).
 * - `isFavorite` — per-account, not a shared property of the trip.
 * - `updatedAt` — always server-controlled.
 */
export const PATCHABLE_TRIP_SECTION_KEYS = [
  'name',
  'startDate',
  'endDate',
  'totalDays',
  'destinations',
  'transport',
  'places',
  'documents',
  'expenses',
  'accommodations',
  'itinerary',
  'currency',
  'coverImageUrl',
  'aiGeneratedItinerary',
  'cityTransportMode',
  'photos',
] as const;

export type PatchableTripSectionKey = (typeof PATCHABLE_TRIP_SECTION_KEYS)[number];
