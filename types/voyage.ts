export type TransportMode = 'flight' | 'car' | 'train' | 'bus' | 'other';

export interface FlightInfo {
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  terminal?: string;
  gate?: string;
  status?: 'scheduled' | 'delayed' | 'boarding' | 'departed' | 'arrived' | 'cancelled';
  layovers?: string[];
}

export interface Transport {
  id: string;
  mode: TransportMode;
  flight?: FlightInfo;
  // Car
  distance?: string;
  tolls?: string;
  travelTime?: string;
  // Train
  platform?: string;
  station?: string;
  trainNumber?: string;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  days: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
}

export interface Place {
  id: string;
  name: string;
  category: 'attraction' | 'restaurant' | 'cafe' | 'museum' | 'hidden_gem' | 'other';
  address?: string;
  hours?: string;
  rating?: number;
  priceLevel?: number;
  distance?: string;
  avgVisitTime?: string;
  description?: string;
  curiosities?: string;
  website?: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  placeId?: string;
  destinationId: string;
}

export interface Document {
  id: string;
  name: string;
  type: 'passport' | 'visa' | 'ticket' | 'reservation' | 'insurance' | 'other';
  url?: string;
  expiryDate?: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: 'food' | 'transport' | 'accommodation' | 'activity' | 'shopping' | 'other';
  date: string;
  paidBy: string;
  splitWith?: string[];
}

export interface Traveler {
  id: string;
  name: string;
  initials: string;
  color?: string;
}

export interface Accommodation {
  id: string;
  name: string;
  address?: string;
  checkIn: string;
  checkOut: string;
  confirmationCode?: string;
  website?: string;
}

export interface DayItinerary {
  date: string;
  places: Place[];
  notes?: string;
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  destinations: Destination[];
  transport: Transport[];
  places: Place[];
  documents: Document[];
  expenses: Expense[];
  travelers: Traveler[];
  accommodations: Accommodation[];
  itinerary: DayItinerary[];
  currency: string;
  coverImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CuratedGuide {
  id: string;
  title: string;
  destination: string;
  days: number;
  spots: number;
  imageUrl: string;
  description?: string;
}
