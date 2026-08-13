// ─── Transport ────────────────────────────────────────────────────────────────

export type TransportMode = 'flight' | 'car' | 'train' | 'bus' | 'ferry' | 'other';

// Transport used within the destination city (for routing/itinerary)
export type CityTransportMode = 'car' | 'public';

export interface FlightInfo {
  flightNumber: string;
  airline: string;
  origin: string;           // IATA code e.g. GRU
  originCity?: string;      // Full city/airport name e.g. São Paulo
  destination: string;      // IATA code e.g. LHR
  destinationCity?: string; // Full city/airport name e.g. Londres
  departureTime: string;
  arrivalTime: string;
  departureActual?: string; // actual departure time if different
  arrivalActual?: string;   // actual arrival time if different
  duration: string;
  terminal?: string;
  gate?: string;
  status?: 'scheduled' | 'delayed' | 'boarding' | 'departed' | 'arrived' | 'cancelled';
  layovers?: string[];
}

export interface CarInfo {
  originAddress: string;       // e.g. "Aeroporto de Guarulhos, SP"
  destinationAddress: string;  // e.g. "Hotel Colosseo, Roma"
  desiredArrivalTime: string;  // ISO datetime string
  departureTime?: string;      // calculated: desiredArrivalTime - travelDuration
  travelDuration?: string;     // e.g. "1h30"
  travelDurationSeconds?: number;
  distanceText?: string;       // e.g. "45 km"
  mapsUrl?: string;            // Google Maps URL for the route
}

export interface TrainBusFerryInfo {
  originStation: string;       // Google Places selected station/port
  originStationPlaceId?: string;
  destinationStation: string;  // Google Places selected station/port
  destinationStationPlaceId?: string;
  departureTime?: string;      // ISO datetime
  arrivalTime?: string;        // ISO datetime
  ticketNumber?: string;       // free text
  notifyBeforeDeparture?: boolean;
  ticketDocUri?: string;       // local URI of ticket PDF/photo
}

export interface OtherTransportInfo {
  name: string;                // free text name
  departureTime?: string;      // ISO datetime
  arrivalTime?: string;        // ISO datetime
}

export interface Transport {
  id: string;
  mode: TransportMode;
  // Leg: which segment this transport covers (e.g. 'GRU → FCO', 'FCO → LHR')
  leg?: string;
  flight?: FlightInfo;
  car?: CarInfo;               // car-specific details
  trainBusFerry?: TrainBusFerryInfo; // train/bus/ferry details
  other?: OtherTransportInfo;  // other transport details
  // Legacy generic fields (kept for backward compat)
  distance?: string;
  tolls?: string;
  travelTime?: string;
  platform?: string;
  station?: string;
  trainNumber?: string;
  boardingPassUri?: string; // local URI of boarding pass image/QR
  notificationIds?: string[]; // scheduled notification IDs for this flight
  carContractUri?: string;   // local URI of car rental contract PDF/photo
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
  // Cached AI-suggested places for this destination, generated once and persisted
  aiSuggestedPlaces?: Place[];
  // Cached AI-generated destination info (climate, crowd, population, health, visa, tips), generated once and persisted
  aiDestinationInfo?: any;
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

// ─── Trip Photo ──────────────────────────────────────────────────────────────

export interface TripPhoto {
  id: string;
  url: string;           // local URI or remote URL
  caption?: string;
  uploadedBy: string;    // traveler name or 'me'
  uploadedAt: string;    // ISO date
  destinationId?: string;
}

// ─── Traveler ─────────────────────────────────────────────────────────────────

export interface Traveler {
  id: string;
  name: string;
  initials: string;
  color?: string;
  email?: string;        // platform user email (if registered)
  userId?: string;       // platform user ID (if registered)
  avatarUrl?: string;    // profile picture URL
  isRegistered?: boolean; // has a Voyage account
  inviteStatus?: 'pending' | 'accepted' | 'declined';
}

// ─── Accommodation ────────────────────────────────────────────────────────────

export type AccommodationType = 'hotel' | 'house' | 'other';

export interface Accommodation {
  id: string;
  destinationId: string;
  name: string;           // empty string for house/apartment
  type: AccommodationType;
  address?: string;
  addressPlaceId?: string; // Google Place ID for the address
  checkIn: string;
  checkOut: string;
  confirmationCode?: string;
  website?: string;
  phone?: string;
  notes?: string;
  pricePerNight?: number;
  imageUrl?: string;
  confirmationDocUri?: string; // local URI of confirmation PDF/photo
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
  photos?: TripPhoto[];  // shared photo album
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
