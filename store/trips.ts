import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip, Place, Document, Expense, Traveler, Transport, Accommodation } from '@/types/voyage';

interface TripsState {
  trips: Trip[];
  isLoading: boolean;
  // Actions
  addTrip: (trip: Trip) => Promise<void>;
  updateTrip: (id: string, updates: Partial<Trip>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  addPlace: (tripId: string, place: Place) => Promise<void>;
  removePlace: (tripId: string, placeId: string) => Promise<void>;
  addDocument: (tripId: string, doc: Document) => Promise<void>;
  removeDocument: (tripId: string, docId: string) => Promise<void>;
  addExpense: (tripId: string, expense: Expense) => Promise<void>;
  removeExpense: (tripId: string, expenseId: string) => Promise<void>;
  addTraveler: (tripId: string, traveler: Traveler) => Promise<void>;
  removeTraveler: (tripId: string, travelerId: string) => Promise<void>;
  addTransport: (tripId: string, transport: Transport) => Promise<void>;
  addAccommodation: (tripId: string, accommodation: Accommodation) => Promise<void>;
  loadTrips: () => Promise<void>;
  getTripById: (id: string) => Trip | undefined;
}

const STORAGE_KEY = 'voyage_trips';

const saveToStorage = async (trips: Trip[]) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
  } catch (e) {
    console.error('Failed to save trips:', e);
  }
};

export const useTripsStore = create<TripsState>((set, get) => ({
  trips: [],
  isLoading: false,

  loadTrips: async () => {
    set({ isLoading: true });
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        set({ trips: JSON.parse(stored) });
      }
    } catch (e) {
      console.error('Failed to load trips:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  getTripById: (id: string) => {
    return get().trips.find((t) => t.id === id);
  },

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

  addPlace: async (tripId: string, place: Place) => {
    const trips = get().trips.map((t) =>
      t.id === tripId ? { ...t, places: [...t.places, place], updatedAt: new Date().toISOString() } : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  removePlace: async (tripId: string, placeId: string) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, places: t.places.filter((p) => p.id !== placeId), updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

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

  addTransport: async (tripId: string, transport: Transport) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, transport: [...t.transport, transport], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
  },

  addAccommodation: async (tripId: string, accommodation: Accommodation) => {
    const trips = get().trips.map((t) =>
      t.id === tripId
        ? { ...t, accommodations: [...t.accommodations, accommodation], updatedAt: new Date().toISOString() }
        : t
    );
    set({ trips });
    await saveToStorage(trips);
  },
}));
