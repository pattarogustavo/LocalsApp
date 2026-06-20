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
} from '@/types/voyage';
import { trpcVanilla } from '@/lib/trpc-vanilla';

interface TripsState {
  trips: Trip[];
  isLoading: boolean;
  isSyncing: boolean;
  userPlan: UserPlan;
  // Core trip actions
  addTrip: (trip: Trip) => Promise<void>;
  updateTrip: (id: string, updates: Partial<Trip>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  loadTrips: () => Promise<void>;
  syncWithCloud: () => Promise<void>;
  getTripById: (id: string) => Trip | undefined;
  // Places
  addPlace: (tripId: string, place: Place) => Promise<void>;
  removePlace: (tripId: string, placeId: string) => Promise<void>;
  setPlaces: (tripId: string, places: Place[]) => Promise<void>;
  updatePlace: (tripId: string, placeId: string, updates: Partial<Place>) => Promise<void>;
  // Documents
  addDocument: (tripId: string, doc: Document) => Promise<void>;
  removeDocument: (tripId: string, docId: string) => Promise<void>;
  // Expenses
  addExpense: (tripId: string, expense: Expense) => Promise<void>;
  removeExpense: (tripId: string, expenseId: string) => Promise<void>;
  // Travelers
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
 * Attempt to upsert a single trip to the cloud.
 * Silently fails if not authenticated or network is unavailable.
 */
const pushTripToCloud = async (trip: Trip) => {
  try {
    await trpcVanilla.cloudTrips.upsert.mutate({
      clientId: trip.id,
      data: JSON.stringify(trip),
    });
  } catch {
    // Offline or unauthenticated — local data is the source of truth
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

const DEFAULT_PLAN: UserPlan = {
  tier: 'free',
  aiCreditsUsed: 0,
  aiCreditsLimit: 3, // Free tier gets 3 AI uses
};

export const useTripsStore = create<TripsState>((set, get) => ({
  trips: [],
  isLoading: false,
  isSyncing: false,
  userPlan: DEFAULT_PLAN,

  loadTrips: async () => {
    set({ isLoading: true });
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        set({ trips: JSON.parse(stored) });
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

      set({ trips: merged });
      await saveToStorage(merged);
    } catch (e) {
      // Sync failed (offline/unauthenticated) — keep local data
      console.warn('[CloudSync] Sync failed, using local data:', e);
    } finally {
      set({ isSyncing: false });
    }
  },

  getTripById: (id: string) => get().trips.find((t) => t.id === id),

  addTrip: async (trip: Trip) => {
    const trips = [...get().trips, trip];
    set({ trips });
    await saveToStorage(trips);
    await pushTripToCloud(trip);
  },

  updateTrip: async (id: string, updates: Partial<Trip>) => {
    const trips = get().trips.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === id);
    if (updated) await pushTripToCloud(updated);
  },

  deleteTrip: async (id: string) => {
    const trips = get().trips.filter((t) => t.id !== id);
    set({ trips });
    await saveToStorage(trips);
    await deleteTripFromCloud(id);
  },

  // ─── Places ────────────────────────────────────────────────────────────────

  addPlace: async (tripId: string, place: Place) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, places: [...t.places, place], updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removePlace: async (tripId: string, placeId: string) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      const places = t.places.filter((p) => p.id !== placeId);
      const itinerary = t.itinerary.map((day) => ({
        ...day,
        stops: day.stops.filter((s) => s.placeId !== placeId),
      }));
      return { ...t, places, itinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  updatePlace: async (tripId: string, placeId: string, updates: Partial<Place>) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, places: t.places.map((p) => p.id === placeId ? { ...p, ...updates } : p), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  setPlaces: async (tripId: string, places: Place[]) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, places, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Documents ─────────────────────────────────────────────────────────────

  addDocument: async (tripId: string, doc: Document) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, documents: [...t.documents, doc], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeDocument: async (tripId: string, docId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, documents: t.documents.filter((d) => d.id !== docId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Expenses ──────────────────────────────────────────────────────────────

  addExpense: async (tripId: string, expense: Expense) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, expenses: [...t.expenses, expense], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeExpense: async (tripId: string, expenseId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, expenses: t.expenses.filter((e) => e.id !== expenseId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Travelers ─────────────────────────────────────────────────────────────

  addTraveler: async (tripId: string, traveler: Traveler) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, travelers: [...t.travelers, traveler], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeTraveler: async (tripId: string, travelerId: string) => {
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
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, transport: [...t.transport, transport], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeTransport: async (tripId: string, transportId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, transport: t.transport.filter((tr) => tr.id !== transportId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  updateTransport: async (tripId: string, transportId: string, updates: Partial<Transport>) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? {
            ...t,
            transport: t.transport.map((tr) => (tr.id === transportId ? { ...tr, ...updates } : tr)),
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  updateCityTransportMode: async (tripId: string, mode) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, cityTransportMode: mode, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Accommodations ────────────────────────────────────────────────────────

  addAccommodation: async (tripId: string, accommodation: Accommodation) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, accommodations: [...t.accommodations, accommodation], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeAccommodation: async (tripId: string, accommodationId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, accommodations: t.accommodations.filter((a) => a.id !== accommodationId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  updateAccommodation: async (tripId: string, accommodationId: string, updates: Partial<Accommodation>) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? {
            ...t,
            accommodations: t.accommodations.map((a) =>
              a.id === accommodationId ? { ...a, ...updates } : a
            ),
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Itinerary ─────────────────────────────────────────────────────────────

  setItinerary: async (tripId: string, days: DayItinerary[]) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, itinerary: days, aiGeneratedItinerary: true, updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Edit Trip ─────────────────────────────────────────────────────────────

  updateDestinations: async (tripId: string, destinations: Destination[]) => {
    const trip = get().trips.find((t) => t.id === tripId);
    if (!trip) return;
    const totalDays = destinations.reduce((sum, d) => sum + d.days, 0);
    const endDate = new Date(trip.startDate);
    endDate.setDate(endDate.getDate() + totalDays - 1);
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, destinations, totalDays, endDate: endDate.toISOString(), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  updateStartDate: async (tripId: string, startDate: string) => {
    const trip = get().trips.find((t) => t.id === tripId);
    const endDate = trip ? (() => { const d = new Date(startDate); d.setDate(d.getDate() + trip.totalDays - 1); return d.toISOString(); })() : startDate;
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, startDate, endDate, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Photos ─────────────────────────────────────────────────────────────────

  addPhoto: async (tripId: string, photo: TripPhoto) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, photos: [...(t.photos || []), photo], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removePhoto: async (tripId: string, photoId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, photos: (t.photos || []).filter((p) => p.id !== photoId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  updateCoverImage: async (tripId: string, url: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, coverImageUrl: url, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── Itinerary Stop Editing ────────────────────────────────────────────────

  updateItineraryStop: async (tripId: string, dayIndex: number, stopId: string, updates: Partial<ItineraryStop>) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: day.stops.map((s) => (s.id === stopId ? { ...s, ...updates } : s)) };
      });
      return { ...t, itinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeItineraryStop: async (tripId: string, dayIndex: number, stopId: string) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: day.stops.filter((s) => s.id !== stopId) };
      });
      return { ...t, itinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  moveItineraryStop: async (tripId: string, fromDayIndex: number, toDayIndex: number, stopId: string, toPosition?: number) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
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
      return { ...t, itinerary: updatedItinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  addItineraryStop: async (tripId: string, dayIndex: number, stop: ItineraryStop) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: [...day.stops, stop] };
      });
      return { ...t, itinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  reorderItineraryStops: async (tripId: string, dayIndex: number, newStops: ItineraryStop[]) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: newStops };
      });
      return { ...t, itinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  removeItineraryStopAndPlace: async (tripId: string, dayIndex: number, stopId: string, placeId?: string) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      const itinerary = t.itinerary.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, stops: day.stops.filter((s) => s.id !== stopId) };
      });
      const places = placeId ? t.places.filter((p) => p.id !== placeId) : t.places;
      return { ...t, itinerary, places, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
    const updated = trips.find((t) => t.id === tripId);
    if (updated) await pushTripToCloud(updated);
  },

  // ─── User Plan ─────────────────────────────────────────────────────────────

  updateUserPlan: (plan: Partial<UserPlan>) => {
    const updated = { ...get().userPlan, ...plan };
    set({ userPlan: updated });
    AsyncStorage.setItem(PLAN_KEY, JSON.stringify(updated)).catch(console.error);
  },
}));
