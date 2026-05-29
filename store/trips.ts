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

interface TripsState {
  trips: Trip[];
  isLoading: boolean;
  userPlan: UserPlan;
  // Core trip actions
  addTrip: (trip: Trip) => Promise<void>;
  updateTrip: (id: string, updates: Partial<Trip>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  loadTrips: () => Promise<void>;
  getTripById: (id: string) => Trip | undefined;
  // Places
  addPlace: (tripId: string, place: Place) => Promise<void>;
  removePlace: (tripId: string, placeId: string) => Promise<void>;
  setPlaces: (tripId: string, places: Place[]) => Promise<void>;
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

const DEFAULT_PLAN: UserPlan = {
  tier: 'free',
  aiCreditsUsed: 0,
  aiCreditsLimit: 3, // Free tier gets 3 AI uses
};

export const useTripsStore = create<TripsState>((set, get) => ({
  trips: [],
  isLoading: false,
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

  getTripById: (id: string) => get().trips.find((t) => t.id === id),

  addTrip: async (trip: Trip) => {
    const trips = [...get().trips, trip];
    set({ trips });
    await saveToStorage(trips);
  },

  updateTrip: async (id: string, updates: Partial<Trip>) => {
    const trips = get().trips.map((t) =>
      t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  deleteTrip: async (id: string) => {
    const trips = get().trips.filter((t) => t.id !== id);
    set({ trips });
    await saveToStorage(trips);
  },

  // ─── Places ────────────────────────────────────────────────────────────────

  addPlace: async (tripId: string, place: Place) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, places: [...t.places, place], updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  removePlace: async (tripId: string, placeId: string) => {
    const trips = get().trips.map((t) => {
      if (t.id !== tripId) return t;
      // Remove from places list
      const places = t.places.filter((p) => p.id !== placeId);
      // Also remove matching itinerary stops that reference this place
      const itinerary = t.itinerary.map((day) => ({
        ...day,
        stops: day.stops.filter((s) => s.placeId !== placeId),
      }));
      return { ...t, places, itinerary, updatedAt: new Date().toISOString() };
    });
    set({ trips });
    await saveToStorage(trips);
  },

  setPlaces: async (tripId: string, places: Place[]) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, places, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  removeDocument: async (tripId: string, docId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, documents: t.documents.filter((d) => d.id !== docId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  removeExpense: async (tripId: string, expenseId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, expenses: t.expenses.filter((e) => e.id !== expenseId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  removeTraveler: async (tripId: string, travelerId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, travelers: t.travelers.filter((tr) => tr.id !== travelerId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  removeTransport: async (tripId: string, transportId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, transport: t.transport.filter((tr) => tr.id !== transportId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  updateCityTransportMode: async (tripId: string, mode) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, cityTransportMode: mode, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  removeAccommodation: async (tripId: string, accommodationId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, accommodations: t.accommodations.filter((a) => a.id !== accommodationId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
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
  },

  updateStartDate: async (tripId: string, startDate: string) => {
    const trip = get().trips.find((t) => t.id === tripId);
    const endDate = trip ? (() => { const d = new Date(startDate); d.setDate(d.getDate() + trip.totalDays - 1); return d.toISOString(); })() : startDate;
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, startDate, endDate, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  // ─── User Plan ─────────────────────────────────────────────────────────────

  // ─── Photos ─────────────────────────────────────────────────────────────────

  addPhoto: async (tripId: string, photo: TripPhoto) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, photos: [...(t.photos || []), photo], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  removePhoto: async (tripId: string, photoId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, photos: (t.photos || []).filter((p) => p.id !== photoId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  updateCoverImage: async (tripId: string, url: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, coverImageUrl: url, updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

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
      // Find the stop that was moved
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
  },

  updateUserPlan: (plan: Partial<UserPlan>) => {
    const updated = { ...get().userPlan, ...plan };
    set({ userPlan: updated });
    AsyncStorage.setItem(PLAN_KEY, JSON.stringify(updated)).catch(console.error);
  },
}));
