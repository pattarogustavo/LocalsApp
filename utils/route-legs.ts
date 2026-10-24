import { locatorFor, type MapsLocatable, type DirectionsTravelMode } from './maps-url';

export interface LegStop extends MapsLocatable {
  id?: string;
  travelTimeToNext?: string;
  travelModeToNext?: string;
}

export interface LegDay {
  destination?: string;
  stops: LegStop[];
}

export interface RouteLeg {
  dayIdx: number;
  stopId: string;
  origin: string;
  destination: string;
  mode: DirectionsTravelMode;
}

/**
 * Consecutive-stop legs for every day, skipping a leg whose origin stop
 * already has a travel duration resolved for the requested mode (so a
 * rerun — rerender, tab change, regeneration of an already-resolved day —
 * never re-requests work that's already cached on the stop itself).
 */
export function buildConsecutiveLegs(days: LegDay[], mode: DirectionsTravelMode): RouteLeg[] {
  const legs: RouteLeg[] = [];
  days.forEach((day, dayIdx) => {
    const stops = day.stops || [];
    for (let i = 0; i < stops.length - 1; i++) {
      const cur = stops[i];
      const next = stops[i + 1];
      if (!cur.id) continue;
      if (cur.travelTimeToNext && (cur.travelModeToNext as any) === mode) continue;
      const origin = locatorFor(cur, day.destination);
      const destination = locatorFor(next, day.destination);
      if (!origin || !destination) continue;
      legs.push({ dayIdx, stopId: cur.id, origin, destination, mode });
    }
  });
  return legs;
}

/** Splits legs into chunks no larger than chunkSize (directions.batchRoute's own cap). */
export function chunkLegs(legs: RouteLeg[], chunkSize: number): RouteLeg[][] {
  const chunks: RouteLeg[][] = [];
  for (let i = 0; i < legs.length; i += chunkSize) {
    chunks.push(legs.slice(i, i + chunkSize));
  }
  return chunks;
}
