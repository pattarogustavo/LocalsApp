// ─── Transport ────────────────────────────────────────────────────────────────

export type TransportMode = 'flight' | 'car' | 'train' | 'bus' | 'ferry' | 'other';

// Transport used within the destination city (for routing/itinerary)
export type CityTransportMode = 'car' | 'public' | 'uber' | 'walk' | 'bike' | 'taxi';

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
  distance?: string;
  tolls?: string;
  travelTime?: string;
  platform?: string;
  station?: string;
  trainNumber?: string;
}

// ─── Destination ──────────────────────────────────────────────────────────────

export interface Destination {
  id: string;
  name: string;
  country: string;
  days: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  // Currency used in this destination country
  currency?: string;
}

// ─── Place ────────────────────────────────────────────────────────────────────

export type PlaceCategory = 'attraction' | 'restaurant' | 'cafe' | 'museum' | 'hidden_gem' | 'other';

export interface PlaceAttachment {
  id: string;
  name: string;
  url: string;
  type: 'pdf' | 'image' | 'other';
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  address?: string;
  hours?: string;
  phone?: string;
  rating?: number;
  priceLevel?: number;
  priceRange?: string;
  distance?: string;
  avgVisitTime?: string;
  estimatedDuration?: string;
  description?: string;
  curiosities?: string;
  website?: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  placeId?: string;
  destinationId: string;
  addedByAI?: boolean;
  attachments?: PlaceAttachment[];
}

// ─── Document ─────────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  name: string;
  type: 'passport' | 'visa' | 'ticket' | 'reservation' | 'insurance' | 'other';
  url?: string;
  expiryDate?: string;
}

// ─── Expense ──────────────────────────────────────────────────────────────────

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

// ─── Traveler ─────────────────────────────────────────────────────────────────

export interface Traveler {
  id: string;
  name: string;
  initials: string;
  color?: string;
}

// ─── Accommodation ────────────────────────────────────────────────────────────

export type AccommodationType = 'hotel' | 'house' | 'hostel' | 'airbnb' | 'other';

export interface Accommodation {
  id: string;
  destinationId: string;
  name: string;
  type: AccommodationType;
  address?: string;
  checkIn: string;
  checkOut: string;
  confirmationCode?: string;
  website?: string;
  phone?: string;
  notes?: string;
  pricePerNight?: number;
  imageUrl?: string;
}

// ─── Day-by-Day Itinerary (Timeline-based) ────────────────────────────────────

export interface ItineraryStop {
  id: string;
  time: string;           // e.g. "09:00"
  placeId?: string;       // links to Place.id
  placeName: string;
  placeCategory: PlaceCategory;
  description?: string;
  imageUrl?: string;
  address?: string;
  lat?: number;
  lng?: number;
  website?: string;
  phone?: string;
  hours?: string;
  // Travel to next stop
  travelTimeToNext?: string;   // e.g. "20 min"
  travelModeToNext?: CityTransportMode;
  mapsUrlToNext?: string;      // Google Maps URL from this stop to next
}

export interface DayItinerary {
  date: string;           // YYYY-MM-DD
  destination: string;   // destination name
  dayNumber: number;     // 1-based day number in trip
  stops: ItineraryStop[];
  tip?: string;           // AI tip for the day
  estimatedCost?: number; // estimated daily cost in local currency
  estimatedCostCurrency?: string;
  // Legacy fields (kept for backward compat)
  title?: string;
  morning?: { time: string; activity: string; place?: string; tip?: string };
  afternoon?: { time: string; activity: string; place?: string; tip?: string };
  evening?: { time: string; activity: string; place?: string; tip?: string };
  meals?: { breakfast?: string; lunch?: string; dinner?: string };
  places?: string[];
  notes?: string;
  tips?: string;
}

// ─── Trip ─────────────────────────────────────────────────────────────────────

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
  aiGeneratedItinerary?: boolean;
  cityTransportMode?: CityTransportMode;
  createdAt: string;
  updatedAt: string;
}

// ─── Curated Guides ───────────────────────────────────────────────────────────

export interface CuratedGuide {
  id: string;
  title: string;
  destination: string;
  days: number;
  spots: number;
  imageUrl: string;
  description?: string;
}

// ─── Subscription / Plan ──────────────────────────────────────────────────────

export type PlanTier = 'free' | 'pro' | 'premium';

export interface UserPlan {
  tier: PlanTier;
  expiresAt?: string;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
}

// ─── AI / Travel Preferences ──────────────────────────────────────────────────

export type TravelStyle =
  | 'cultura'
  | 'gastronomia'
  | 'natureza'
  | 'aventura'
  | 'relaxamento'
  | 'compras'
  | 'historia'
  | 'praia'
  | 'montanha'
  | 'cidade'
  | 'vida_noturna';

export type TravelBudget = 'econômico' | 'moderado' | 'luxo';
export type TravelPace = 'relaxado' | 'moderado' | 'intenso';
export type TravelProfile = 'casal' | 'família' | 'solo' | 'amigos' | 'negócios';

export interface ItineraryPreferences {
  profile: TravelProfile;
  style: TravelStyle[];
  budget: TravelBudget;
  pace: TravelPace;
  interests: string[];
  restrictions?: string;
  approximateBudget?: string;
  cityTransportMode?: CityTransportMode;
}

export interface TravelPreferences {
  style: TravelStyle[];
  budget: TravelBudget;
  pace: TravelPace;
  climate?: string;
  avoidLongFlights?: boolean;
  originCity?: string;
  includeBreakfast?: boolean;
  includeLunch?: boolean;
  includeDinner?: boolean;
  wakeUpTime?: string;
}
