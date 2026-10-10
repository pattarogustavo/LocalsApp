import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Trip,
  Place,
  Document,
  Expense,
  Traveler,
  Transport,
  Accommodation,
  DayItinerary,
  Destination,
  UserPlan,
  TripPhoto,
  ItineraryStop,
  UpsertPlaceInput,
} from '@/types/voyage';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import { normalizeCityTransportMode, generateId } from '@/utils/trip-helpers';
import { PATCHABLE_TRIP_SECTION_KEYS } from '../shared/trip-sections';
import { reconcileTripReminders } from '@/lib/trip-notifications';

interface TripsState {
  trips: Trip[];
  isLoading: boolean;
  isSyncing: boolean;
  isTranslating: boolean;
  userPlan: UserPlan;
  /** Set when a write to a shared trip couldn't be saved on the server; the
   * local change has already been rolled back by the time this is set. The
   * UI (app/trip/[id].tsx) watches this to surface an alert, then clears it. */
  lastWriteError: { message: string } | null;
  clearLastWriteError: () => void;
  // Core trip actions
  addTrip: (trip: Trip) => Promise<void>;
  updateTrip: (id: string, updates: Partial<Trip>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  toggleFavorite: (tripId: string) => Promise<void>;
  loadTrips: () => Promise<void>;
  syncWithCloud: () => Promise<void>;
  getTripById: (id: string) => Trip | undefined;
  translateAllTripsToLanguage: (targetLanguage: string) => Promise<void>;
  /** Merges a trip shared with this account (from sharing.listSharedWithMe)
   * into the store, tagged with its shareId/shareRole, so every write method
   * below works on it exactly like an owned trip. Call again on every
   * refresh (focus, pull-to-refresh) to keep it current. */
  hydrateSharedTrip: (shareId: number, shareRole: 'editor' | 'viewer', trip: Trip) => void;
  /** Owner-side pull: if the server's copy of this owned trip is newer than
   * our local one (most likely because an editor saved a change), adopt
   * whichever patchable sections actually differ. Never touches sections we
   * haven't diverged from the server on, so it can't clobber a local edit
   * mid-flight. No-op for shared (non-owned) trips. */
  pullOwnedTripUpdates: (tripId: string) => Promise<void>;
  // Places
  addPlace: (tripId: string, place: Place) => Promise<void>;
  removePlace: (tripId: string, placeId: string) => Promise<void>;
  setPlaces: (tripId: string, places: Place[]) => Promise<void>;
  updatePlace: (tripId: string, placeId: string, updates: Partial<Place>) => Promise<void>;
  /**
   * Single entry point for adding a place from any source (AI recommendations,
   * manual search, itinerary generation). Reuses an existing Place when one
   * already matches by Google place_id (or, failing that, by name within the
   * same destination) instead of creating a disconnected duplicate. Returns
   * the local Place.id — either the existing one, or a freshly created one.
   */
  upsertPlace: (tripId: string, input: UpsertPlaceInput) => Promise<string>;
  // Documents
  addDocument: (tripId: string, doc: Document) => Promise<void>;
  removeDocument: (tripId: string, docId: string) => Promise<void>;
  // Expenses
  addExpense: (tripId: string, expense: Expense) => Promise<void>;
  removeExpense: (tripId: string, expenseId: string) => Promise<void>;
  // Travelers (owner-only — never shared/patchable, see shared/trip-sections.ts)
  addTraveler: (tripId: string, traveler: Traveler) => Promise<void>;
  removeTraveler: (tripId: string, travelerId: string) => Promise<void>;
  // Transport
  addTransport: (tripId: string, transport: Transport) => Promise<void>;
  removeTransport: (tripId: string, transportId: string) => Promise<void>;
  updateTransport: (tripId: string, transportId: string, updates: Partial<Transport>) => Promise<void>;
  updateCityTransportMode: (tripId: string, mode: import('@/types/voyage').CityTransportMode) => Promise<void>;
  // Accommodations
  addAccommodation: (tripId: string, accommodation: Accommodation) => Promise<void>;
  removeAccommodation: (tripId: string, accommodationId: string) => Promise<void>;
  updateAccommodation: (tripId: string, accommodationId: string, updates: Partial<Accommodation>) => Promise<void>;
  // Itinerary (AI-generated)
  setItinerary: (tripId: string, days: DayItinerary[]) => Promise<void>;
  // Edit trip dates/destinations
  updateDestinations: (tripId: string, destinations: Destination[]) => Promise<void>;
  updateDestinationSuggestedPlaces: (tripId: string, destinationId: string, places: Place[]) => Promise<void>;
  updateDestinationInfo: (tripId: string, destinationId: string, info: any) => Promise<void>;
  updateStartDate: (tripId: string, startDate: string) => Promise<void>;
  // Photos
  addPhoto: (tripId: string, photo: TripPhoto) => Promise<void>;
  removePhoto: (tripId: string, photoId: string) => Promise<void>;
  // Cover image
  updateCoverImage: (tripId: string, url: string) => Promise<void>;
  // Itinerary stop editing
  updateItineraryStop: (tripId: string, dayIndex: number, stopId: string, updates: Partial<ItineraryStop>) => Promise<void>;
  removeItineraryStop: (tripId: string, dayIndex: number, stopId: string) => Promise<void>;
  // Itinerary stop movement and addition
  moveItineraryStop: (tripId: string, fromDayIndex: number, toDayIndex: number, stopId: string, toPosition?: number) => Promise<void>;
  addItineraryStop: (tripId: string, dayIndex: number, stop: ItineraryStop) => Promise<void>;
  reorderItineraryStops: (tripId: string, dayIndex: number, newStops: ItineraryStop[]) => Promise<void>;
  removeItineraryStopAndPlace: (tripId: string, dayIndex: number, stopId: string, placeId?: string) => Promise<void>;
  // Plan
  updateUserPlan: (plan: Partial<UserPlan>) => void;
  // Account isolation
  clearLocalTrips: () => Promise<void>;
}

const STORAGE_KEY = 'voyage_trips';
const PLAN_KEY = 'voyage_user_plan';

const saveToStorage = async (trips: Trip[]) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  } catch (e) {
    console.error('Failed to save trips:', e);
  }
};

/**
 * Attempt to upsert a single trip to the cloud in full.
 * Silently fails if not authenticated or network is unavailable.
 * Used only for brand-new trips and for the one field (contentLanguage)
 * that lives in its own DB column and is only kept in sync via a full
 * upsert — every other update goes through `syncTripSectionsToCloud` below.
 */
const pushTripToCloud = async (trip: Trip) => {
  try {
    await trpcVanilla.cloudTrips.upsert.mutate({
      clientId: trip.id,
      data: JSON.stringify(trip),
    });
  } catch (err) {
    console.warn('[CloudSync] Failed to push trip to cloud:', err);
  }
};

/**
 * Attempt to delete a trip from the cloud.
 * Silently fails if not authenticated or network is unavailable.
 */
const deleteTripFromCloud = async (clientId: string) => {
  try {
    await trpcVanilla.cloudTrips.delete.mutate({ clientId });
  } catch {
    // Offline or unauthenticated — ignore
  }
};

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Não foi possível salvar sua alteração.';

/** Only the whitelisted, patchable top-level sections that actually changed between `previous` and `next`. */
const computeSectionPatch = (previous: Trip, next: Trip): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  for (const key of PATCHABLE_TRIP_SECTION_KEYS) {
    if (JSON.stringify((next as any)[key]) !== JSON.stringify((previous as any)[key])) {
      patch[key] = (next as any)[key];
    }
  }
  return patch;
};

/**
 * Sends only the sections that changed to the server and returns whatever
 * the server reports back as the merged trip (which may also carry sections
 * another editor/the owner changed concurrently) — or `next` unchanged if
 * there was nothing to send.
 *
 * - Owned trip: patches via cloudTrips.patch. Network/auth failures are
 *   swallowed (same offline-tolerant behavior as the old full-upsert path) —
 *   the local optimistic change is kept either way.
 * - Shared trip (editor): patches via sharing.saveSharedTrip. Failures are
 *   NOT swallowed — they propagate so the caller (applyTripWrite) can roll
 *   back the optimistic local change and surface an alert, since an editor
 *   has no other way to know their edit didn't actually land on the owner's
 *   trip.
 */
const syncTripSectionsToCloud = async (previous: Trip, next: Trip): Promise<Trip> => {
  if (next.shareId) {
    const patch = computeSectionPatch(previous, next);
    if (Object.keys(patch).length === 0) return next;
    const result = await trpcVanilla.sharing.saveSharedTrip.mutate({ shareId: next.shareId, patch });
    const merged = JSON.parse(result.tripData) as Trip;
    return { ...merged, shareId: next.shareId, shareRole: next.shareRole };
  }

  // contentLanguage lives in its own DB column and is only ever kept in
  // sync via a full upsert (cloudTrips.patch has no notion of it, by design
  // — see shared/trip-sections.ts). This is the one legitimate owner-side
  // change outside the patchable whitelist, so fall back to a full upsert.
  if (next.contentLanguage !== previous.contentLanguage) {
    await pushTripToCloud(next);
    return next;
  }

  const patch = computeSectionPatch(previous, next);
  if (Object.keys(patch).length === 0) return next;
  try {
    const result = await trpcVanilla.cloudTrips.patch.mutate({ clientId: next.id, patch });
    return JSON.parse(result.data) as Trip;
  } catch (err) {
    console.warn('[CloudSync] Failed to patch trip to cloud:', err);
    return next;
  }
};

const DEFAULT_PLAN: UserPlan = {
  tier: 'free',
  aiCreditsUsed: 0,
  aiCreditsLimit: 3, // Free tier gets 3 AI uses
};

export const useTripsStore = create<TripsState>((set, get) => {
  /**
   * Single entry point for every write below (except the few — addTraveler,
   * removeTraveler, toggleFavorite, addTrip, deleteTrip — that touch only
   * non-patchable or whole-trip-lifecycle fields and so have no need for
   * section diffing). Looks up the current trip, applies `mutate` to get the
   * next version, updates local state + storage optimistically, then syncs
   * only the changed sections to the cloud — as an owner patch or an
   * editor's sharing.saveSharedTrip, whichever this trip is. On a shared-trip
   * save failure, the optimistic change is rolled back and `lastWriteError`
   * is set so the UI can alert the user instead of losing their edit silently.
   */
  const applyTripWrite = async (
    tripId: string,
    mutate: (trip: Trip) => Trip,
    methodName = 'write'
  ): Promise<Trip | undefined> => {
    const previous = get().trips.find((t) => t.id === tripId);
    if (!previous) {
      console.warn(`[TripsStore] Ignored ${methodName}: trip ${tripId} is not loaded in this store.`);
      return undefined;
    }
    if (previous.shareRole === 'viewer') {
      console.warn(`[TripsStore] Ignored ${methodName}: trip ${tripId} is read-only (viewer) for this account.`);
      return undefined;
    }

    const next: Trip = { ...mutate(previous), updatedAt: new Date().toISOString() };
    const optimisticTrips = get().trips.map((t) => (t.id === tripId ? next : t));
    set({ trips: optimisticTrips });
    await saveToStorage(optimisticTrips);

    try {
      const synced = await syncTripSectionsToCloud(previous, next);
      if (synced !== next) {
        const finalTrips = get().trips.map((t) => (t.id === tripId ? synced : t));
        set({ trips: finalTrips });
        await saveToStorage(finalTrips);
      }
      return synced;
    } catch (err) {
      console.warn(`[CloudSync] ${methodName} failed to save to the shared trip, reverting:`, err);
      const rolledBack = get().trips.map((t) => (t.id === tripId ? previous : t));
      set({ trips: rolledBack, lastWriteError: { message: errorMessage(err) } });
      await saveToStorage(rolledBack);
      return undefined;
    }
  };

  return {
  trips: [],
  isLoading: false,
  isSyncing: false,
  isTranslating: false,
  userPlan: DEFAULT_PLAN,
  lastWriteError: null,

  clearLastWriteError: () => set({ lastWriteError: null }),

  loadTrips: async () => {
    set({ isLoading: true });
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedTrips = JSON.parse(stored) as Trip[];
        set({
          trips: parsedTrips.map((t) => ({
            ...t,
            cityTransportMode: normalizeCityTransportMode(t.cityTransportMode),
          })),
        });
      }
      const planStored = await AsyncStorage.getItem(PLAN_KEY);
      if (planStored) {
        set({ userPlan: JSON.parse(planStored) });
      }
    } catch (e) {
      console.error('Failed to load trips:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Sync trips with the cloud server.
   * - Fetches all trips from the server.
   * - Merges with local trips: cloud wins on conflict (newer updatedAt).
   * - Pushes any local-only trips to the cloud.
   * - Updates AsyncStorage with the merged result.
   * Shared (non-owned) trips are left untouched here — they're never part
   * of cloudTrips.list (which only returns trips this account owns), and
   * refreshed separately via sharing.listSharedWithMe + hydrateSharedTrip.
   */
  syncWithCloud: async () => {
    set({ isSyncing: true });
    try {
      const cloudRows = await trpcVanilla.cloudTrips.list.query();
      const localTrips = get().trips;

      // Build a map of cloud trips by clientId
      const cloudMap = new Map<string, Trip>();
      for (const row of cloudRows) {
        try {
          const parsed = JSON.parse(row.data) as Trip;
          cloudMap.set(row.clientId, parsed);
        } catch {
          // Skip malformed rows
        }
      }

      // Merge: for each local trip, compare updatedAt with cloud version
      const merged: Trip[] = [];
      const localIds = new Set<string>();

      for (const local of localTrips) {
        localIds.add(local.id);
        if (local.shareId) {
          // Not owned by this account — never reconciled against cloudTrips.list.
          merged.push(local);
          continue;
        }
        const cloud = cloudMap.get(local.id);
        if (!cloud) {
          // Local-only trip — push to cloud
          merged.push(local);
          await pushTripToCloud(local);
        } else {
          // Both exist — take the newer one
          const localDate = new Date(local.updatedAt || 0).getTime();
          const cloudDate = new Date(cloud.updatedAt || 0).getTime();
          if (cloudDate > localDate) {
            merged.push(cloud);
          } else {
            merged.push(local);
            // Push local to cloud in case it's newer
            if (localDate > cloudDate) {
              await pushTripToCloud(local);
            }
          }
        }
      }

      // Add cloud-only trips (not in local)
      for (const [clientId, cloudTrip] of cloudMap.entries()) {
        if (!localIds.has(clientId)) {
          merged.push(cloudTrip);
        }
      }

      const normalized = merged.map((t) => ({
        ...t,
        cityTransportMode: normalizeCityTransportMode(t.cityTransportMode),
      }));
      set({ trips: normalized });
      await saveToStorage(normalized);
    } catch (e) {
      // Sync failed (offline/unauthenticated) — keep local data
      console.warn('[CloudSync] Sync failed, using local data:', e);
    } finally {
      set({ isSyncing: false });
    }
  },

  getTripById: (id: string) => get().trips.find((t) => t.id === id),

  hydrateSharedTrip: (shareId: number, shareRole: 'editor' | 'viewer', trip: Trip) => {
    const existing = get().trips.find((t) => t.id === trip.id);
    // Never let a shared copy clobber a trip we own locally (shouldn't
    // happen with UUID ids, but this keeps the owner's own copy authoritative).
    if (existing && !existing.shareId) return;
    const hydrated: Trip = {
      ...trip,
      cityTransportMode: normalizeCityTransportMode(trip.cityTransportMode),
      shareId,
      shareRole,
    };
    const trips = existing
      ? get().trips.map((t) => (t.id === trip.id ? hydrated : t))
      : [...get().trips, hydrated];
    set({ trips });
    saveToStorage(trips).catch(() => {});
  },

  pullOwnedTripUpdates: async (tripId: string) => {
    const trip = get().trips.find((t) => t.id === tripId);
    if (!trip || trip.shareId) return; // only meaningful for a trip this account owns
    try {
      const cloud = await trpcVanilla.cloudTrips.get.query({ clientId: tripId });
      if (!cloud) return;
      const cloudUpdatedAt = new Date(cloud.updatedAt).getTime();
      const localUpdatedAt = new Date(trip.updatedAt || 0).getTime();
      if (cloudUpdatedAt <= localUpdatedAt) return; // nothing newer on the server

      const cloudTrip = JSON.parse(cloud.data) as Record<string, unknown>;
      const current = get().trips.find((t) => t.id === tripId);
      if (!current) return;
      let changed = false;
      const nextTrip: Trip = { ...current };
      for (const key of PATCHABLE_TRIP_SECTION_KEYS) {
        if (JSON.stringify(cloudTrip[key]) !== JSON.stringify((current as any)[key])) {
          (nextTrip as any)[key] = cloudTrip[key];
          changed = true;
        }
      }
      if (!changed) return;
      nextTrip.updatedAt = cloud.updatedAt;
      const trips = get().trips.map((t) => (t.id === tripId ? nextTrip : t));
      set({ trips });
      await saveToStorage(trips);
    } catch (e) {
      // Offline or request failed — keep local data, try again next time.
      console.warn('[CloudSync] Failed to pull owned trip updates:', e);
    }
  },

  /**
   * Fired in the background right after the app language changes. Asks the
   * backend to translate every trip not already in `targetLanguage` (name,
   * Info tab, recommended-place descriptions) and patches each trip locally
   * as its translation comes back — never blocks the language switch itself.
   */
  translateAllTripsToLanguage: async (targetLanguage: string) => {
    set({ isTranslating: true });
    try {
      const response = await trpcVanilla.trip.translateAllContent.mutate({ targetLanguage });
      let changed = false;
      const translatedByClientId = new Map<string, Trip>();
      for (const r of response.results) {
        if (r.ok && !r.skipped && r.data) {
          try {
            translatedByClientId.set(r.clientId, JSON.parse(r.data) as Trip);
            changed = true;
          } catch {
            // Malformed payload for this trip — leave it untouched locally.
          }
        }
      }
      if (changed) {
        const merged = get().trips.map((t) => translatedByClientId.get(t.id) ?? t);
        set({ trips: merged });
        await saveToStorage(merged);
      }
    } catch (err) {
      console.warn('[Translate] Failed to translate trips to', targetLanguage, err);
    } finally {
      set({ isTranslating: false });
    }
  },

  addTrip: async (trip: Trip) => {
    const trips = [...get().trips, trip];
    set({ trips });
    await saveToStorage(trips);
    await pushTripToCloud(trip);
    reconcileTripReminders(trips).catch(() => {});
  },

  updateTrip: async (id: string, updates: Partial<Trip>) => {
    await applyTripWrite(id, (t) => ({ ...t, ...updates }), 'updateTrip');
  },

  deleteTrip: async (id: string) => {
    if (!get().trips.some((t) => t.id === id)) {
      console.warn(`[TripsStore] Ignored deleteTrip: trip ${id} is not an owned trip in this store.`);
      return;
    }
    const trips = get().trips.filter((t) => t.id !== id);
    set({ trips });
    await saveToStorage(trips);
    await deleteTripFromCloud(id);
    reconcileTripReminders(trips).catch(() => {});
  },

  // isFavorite is per-account/local-only (never shared, see
  // shared/trip-sections.ts), so this keeps using a plain full upsert rather
  // than the section-patch path — same as before this feature existed.
  toggleFavorite: async (tripId: string) => {
    if (!get().trips.some((t) => t.id === tripId)) {
      console.warn(`[TripsStore] Ignored toggleFavorite: trip ${tripId} is not an owned trip in this store.`);
      return;
    }
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, isFavorite: !t.isFavorite, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Places ────────────────────────────────────────────────────────────────

  addPlace: async (tripId: string, place: Place) => {
    await applyTripWrite(tripId, (t) => ({ ...t, places: [...t.places, place] }), 'addPlace');
  },

  removePlace: async (tripId: string, placeId: string) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      places: t.places.filter((p) => p.id !== placeId),
      itinerary: t.itinerary.map((day) => ({
        ...day,
        stops: day.stops.filter((s) => s.placeId !== placeId),
      })),
    }), 'removePlace');
  },

  updatePlace: async (tripId: string, placeId: string, updates: Partial<Place>) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      places: t.places.map((p) => (p.id === placeId ? { ...p, ...updates } : p)),
    }), 'updatePlace');
  },

  upsertPlace: async (tripId: string, input: UpsertPlaceInput): Promise<string> => {
    const trip = get().trips.find((t) => t.id === tripId);
    if (!trip) {
      console.warn(`[TripsStore] Ignored upsertPlace: trip ${tripId} is not loaded in this store.`);
      return '';
    }

    const normalizedName = input.name.trim().toLowerCase();
    const existing =
      (input.googlePlaceId && trip.places.find((p) => p.placeId === input.googlePlaceId)) ||
      trip.places.find(
        (p) => !p.placeId && p.destinationId === input.destinationId && p.name.trim().toLowerCase() === normalizedName
      );

    if (existing) {
      // Fill in gaps on the existing record (e.g. a manually-added place that
      // had no photo/hours yet) without overwriting data already there or
      // touching its addedByAI origin.
      const updates: Partial<Place> = {};
      if (existing.placeId == null && input.googlePlaceId != null) updates.placeId = input.googlePlaceId;
      if (existing.address == null && input.address != null) updates.address = input.address;
      if (existing.hours == null && input.hours != null) updates.hours = input.hours;
      if (existing.phone == null && input.phone != null) updates.phone = input.phone;
      if (existing.rating == null && input.rating != null) updates.rating = input.rating;
      if (existing.imageUrl == null && input.imageUrl != null) updates.imageUrl = input.imageUrl;
      if (existing.description == null && input.description != null) updates.description = input.description;
      if (existing.lat == null && input.lat != null) updates.lat = input.lat;
      if (existing.lng == null && input.lng != null) updates.lng = input.lng;
      if (Object.keys(updates).length > 0) {
        await get().updatePlace(tripId, existing.id, updates);
      }
      return existing.id;
    }

    const newPlace: Place = {
      id: generateId(),
      name: input.name,
      category: input.category,
      destinationId: input.destinationId,
      address: input.address,
      hours: input.hours,
      phone: input.phone,
      rating: input.rating,
      imageUrl: input.imageUrl,
      description: input.description,
      lat: input.lat,
      lng: input.lng,
      placeId: input.googlePlaceId,
      addedByAI: input.addedByAI,
    };
    await get().addPlace(tripId, newPlace);
    return newPlace.id;
  },

  setPlaces: async (tripId: string, places: Place[]) => {
    await applyTripWrite(tripId, (t) => ({ ...t, places }), 'setPlaces');
  },

  // ─── Documents ─────────────────────────────────────────────────────────────

  addDocument: async (tripId: string, doc: Document) => {
    await applyTripWrite(tripId, (t) => ({ ...t, documents: [...t.documents, doc] }), 'addDocument');
  },

  removeDocument: async (tripId: string, docId: string) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      documents: t.documents.filter((d) => d.id !== docId),
    }), 'removeDocument');
  },

  // ─── Expenses ──────────────────────────────────────────────────────────────

  addExpense: async (tripId: string, expense: Expense) => {
    await applyTripWrite(tripId, (t) => ({ ...t, expenses: [...t.expenses, expense] }), 'addExpense');
  },

  removeExpense: async (tripId: string, expenseId: string) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      expenses: t.expenses.filter((e) => e.id !== expenseId),
    }), 'removeExpense');
  },

  // ─── Travelers ─────────────────────────────────────────────────────────────
  // Owner-only (Etapa 2) and never part of the shared/patchable section set
  // (Etapa 3, shared/trip-sections.ts) — kept on the original plain
  // full-upsert path, unaffected by the section-patch mechanism above.

  addTraveler: async (tripId: string, traveler: Traveler) => {
    if (!get().trips.some((t) => t.id === tripId)) {
      console.warn(`[TripsStore] Ignored addTraveler: trip ${tripId} is not an owned trip in this store.`);
      return;
    }
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, travelers: [...t.travelers, traveler], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    // Optimistic: the screen already reflects the new traveler via `set`
    // above, so the cloud push (which already swallows its own errors, see
    // pushTripToCloud) runs in the background instead of making callers wait
    // on the network for a save that's already safe locally.
    const updated = trips.find((t) => t.id === tripId);
    if (updated) pushTripToCloud(updated);
  },

  removeTraveler: async (tripId: string, travelerId: string) => {
    if (!get().trips.some((t) => t.id === tripId)) {
      console.warn(`[TripsStore] Ignored removeTraveler: trip ${tripId} is not an owned trip in this store.`);
      return;
    }
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, travelers: t.travelers.filter((tr) => tr.id !== travelerId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Transport ─────────────────────────────────────────────────────────────

  addTransport: async (tripId: string, transport: Transport) => {
    await applyTripWrite(tripId, (t) => ({ ...t, transport: [...t.transport, transport] }), 'addTransport');
  },

  removeTransport: async (tripId: string, transportId: string) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      transport: t.transport.filter((tr) => tr.id !== transportId),
    }), 'removeTransport');
  },

  updateTransport: async (tripId: string, transportId: string, updates: Partial<Transport>) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      transport: t.transport.map((tr) => (tr.id === transportId ? { ...tr, ...updates } : tr)),
    }), 'updateTransport');
  },

  updateCityTransportMode: async (tripId, mode) => {
    await applyTripWrite(tripId, (t) => ({ ...t, cityTransportMode: mode }), 'updateCityTransportMode');
  },

  // ─── Accommodations ────────────────────────────────────────────────────────

  addAccommodation: async (tripId: string, accommodation: Accommodation) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      accommodations: [...t.accommodations, accommodation],
    }), 'addAccommodation');
  },

  removeAccommodation: async (tripId: string, accommodationId: string) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      accommodations: t.accommodations.filter((a) => a.id !== accommodationId),
    }), 'removeAccommodation');
  },

  updateAccommodation: async (tripId: string, accommodationId: string, updates: Partial<Accommodation>) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      accommodations: t.accommodations.map((a) => (a.id === accommodationId ? { ...a, ...updates } : a)),
    }), 'updateAccommodation');
  },

  // ─── Itinerary ─────────────────────────────────────────────────────────────

  setItinerary: async (tripId: string, days: DayItinerary[]) => {
    await applyTripWrite(tripId, (t) => ({ ...t, itinerary: days, aiGeneratedItinerary: true }), 'setItinerary');
  },

  // ─── Edit Trip ─────────────────────────────────────────────────────────────

  updateDestinations: async (tripId: string, destinations: Destination[]) => {
    await applyTripWrite(tripId, (t) => {
      const totalDays = destinations.reduce((sum, d) => sum + d.days, 0);
      const endDate = new Date(t.startDate);
      endDate.setDate(endDate.getDate() + totalDays - 1);
      const firstName = destinations[0].name;
      const name = destinations.length === 1
        ? `${totalDays} ${totalDays === 1 ? 'Dia' : 'Dias'} em ${firstName}`
        : destinations.map((d) => d.name).join(' + ');
      return { ...t, name, destinations, totalDays, endDate: endDate.toISOString() };
    }, 'updateDestinations');
  },

  updateDestinationSuggestedPlaces: async (tripId: string, destinationId: string, places: Place[]) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      destinations: t.destinations.map((d) => (d.id === destinationId ? { ...d, aiSuggestedPlaces: places } : d)),
    }), 'updateDestinationSuggestedPlaces');
  },

  updateDestinationInfo: async (tripId: string, destinationId: string, info: any) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      destinations: t.destinations.map((d) => (d.id === destinationId ? { ...d, aiDestinationInfo: info } : d)),
    }), 'updateDestinationInfo');
  },

  updateStartDate: async (tripId: string, startDate: string) => {
    await applyTripWrite(tripId, (t) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + t.totalDays - 1);
      return { ...t, startDate, endDate: d.toISOString() };
    }, 'updateStartDate');
    reconcileTripReminders(get().trips).catch(() => {});
  },

  // ─── Photos ─────────────────────────────────────────────────────────────────

  addPhoto: async (tripId: string, photo: TripPhoto) => {
    await applyTripWrite(tripId, (t) => ({ ...t, photos: [...(t.photos || []), photo] }), 'addPhoto');
  },

  removePhoto: async (tripId: string, photoId: string) => {
    await applyTripWrite(tripId, (t) => ({
      ...t,
      photos: (t.photos || []).filter((p) => p.id !== photoId),
    }), 'removePhoto');
  },

  updateCoverImage: async (tripId: string, url: string) => {
    await applyTripWrite(tripId, (t) => ({ ...t, coverImageUrl: url }), 'updateCoverImage');
  },

  // ─── Itinerary Stop Editing ────────────────────────────────────────────────

  updateItineraryStop: async (tripId: string, dayIndex: number, stopId: string, updates: Partial<ItineraryStop>) => {
    await applyTripWrite(tripId, (t) => {
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: day.stops.map((s) => (s.id === stopId ? { ...s, ...updates } : s)) };
      });
      return { ...t, itinerary };
    }, 'updateItineraryStop');
  },

  removeItineraryStop: async (tripId: string, dayIndex: number, stopId: string) => {
    await applyTripWrite(tripId, (t) => {
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: day.stops.filter((s) => s.id !== stopId) };
      });
      return { ...t, itinerary };
    }, 'removeItineraryStop');
  },

  moveItineraryStop: async (tripId: string, fromDayIndex: number, toDayIndex: number, stopId: string, toPosition?: number) => {
    await applyTripWrite(tripId, (t) => {
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx === fromDayIndex) {
          return { ...day, stops: day.stops.filter((s) => s.id !== stopId) };
        }
        return day;
      });
      const fromDay = t.itinerary[fromDayIndex];
      const stop = fromDay?.stops.find((s) => s.id === stopId);
      if (!stop) return t;
      const updatedItinerary = itinerary.map((day, idx) => {
        if (idx !== toDayIndex) return day;
        const newStops = [...day.stops];
        if (toPosition !== undefined && toPosition >= 0 && toPosition <= newStops.length) {
          newStops.splice(toPosition, 0, stop);
        } else {
          newStops.push(stop);
        }
        return { ...day, stops: newStops };
      });
      return { ...t, itinerary: updatedItinerary };
    }, 'moveItineraryStop');
  },

  addItineraryStop: async (tripId: string, dayIndex: number, stop: ItineraryStop) => {
    await applyTripWrite(tripId, (t) => {
      const baseItinerary = [...t.itinerary];
      for (let i = baseItinerary.length; i <= dayIndex; i++) {
        const d = new Date(t.startDate);
        d.setDate(d.getDate() + i);
        baseItinerary.push({
          date: d.toISOString().split('T')[0],
          destination: '',
          dayNumber: i + 1,
          stops: [],
        });
      }
      const itinerary = baseItinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: [...day.stops, stop] };
      });
      return { ...t, itinerary };
    }, 'addItineraryStop');
  },

  reorderItineraryStops: async (tripId: string, dayIndex: number, newStops: ItineraryStop[]) => {
    await applyTripWrite(tripId, (t) => {
      const itinerary = t.itinerary.map((day, idx) => (idx !== dayIndex ? day : { ...day, stops: newStops }));
      return { ...t, itinerary };
    }, 'reorderItineraryStops');
  },

  removeItineraryStopAndPlace: async (tripId: string, dayIndex: number, stopId: string, placeId?: string) => {
    await applyTripWrite(tripId, (t) => {
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: day.stops.filter((s) => s.id !== stopId) };
      });
      const places = placeId ? t.places.filter((p) => p.id !== placeId) : t.places;
      return { ...t, itinerary, places };
    }, 'removeItineraryStopAndPlace');
  },

  // ─── User Plan ─────────────────────────────────────────────────────────────

  updateUserPlan: (plan: Partial<UserPlan>) => {
    const updated = { ...get().userPlan, ...plan };
    set({ userPlan: updated });
    AsyncStorage.setItem(PLAN_KEY, JSON.stringify(updated)).catch(console.error);
  },

  // ─── Account isolation ──────────────────────────────────────────────────────

  clearLocalTrips: async () => {
    set({ trips: [], userPlan: DEFAULT_PLAN, lastWriteError: null });
    await AsyncStorage.multiRemove([STORAGE_KEY, PLAN_KEY]);
  },
  };
});
