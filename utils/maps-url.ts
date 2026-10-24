/**
 * Google Maps URL builders — pure, local, no API calls.
 *
 * These construct the universal "Maps URLs" scheme
 * (https://developers.google.com/maps/documentation/urls/get-started), which
 * Google Maps itself resolves/geocodes client-side when the link is opened.
 * That means a stop can always get a working Maps link immediately after
 * generation — even with no lat/lng or googlePlaceId yet — by falling back
 * to its name plus the destination city as a search/geocoding hint. Prefer
 * coordinates or a verified Place ID when present, for precise identification.
 */

export interface MapsLocatable {
  placeName?: string;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
  address?: string;
}

export type DirectionsTravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

/** Best-effort text/coordinate locator for a stop — never fabricates data. */
export function locatorFor(stop: MapsLocatable, context?: string): string {
  if (stop.lat != null && stop.lng != null) return `${stop.lat},${stop.lng}`;
  if (stop.address) return stop.address;
  const name = stop.placeName || '';
  return context ? `${name}, ${context}` : name;
}

/** A single stop's "open in Maps" link — a search, not directions. */
export function buildStopMapsUrl(stop: MapsLocatable, context?: string): string {
  const query = locatorFor(stop, context);
  const params = new URLSearchParams({ api: '1', query });
  if (stop.googlePlaceId) params.set('query_place_id', stop.googlePlaceId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/** Directions link between two stops, honoring the app's travel mode. */
export function buildDirectionsUrl(
  origin: MapsLocatable,
  destination: MapsLocatable,
  mode: DirectionsTravelMode,
  context?: string,
): string {
  const params = new URLSearchParams({
    api: '1',
    origin: locatorFor(origin, context),
    destination: locatorFor(destination, context),
    travelmode: mode,
  });
  if (origin.googlePlaceId) params.set('origin_place_id', origin.googlePlaceId);
  if (destination.googlePlaceId) params.set('destination_place_id', destination.googlePlaceId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
