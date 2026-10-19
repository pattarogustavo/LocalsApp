/**
 * Deterministic geographic clustering / day-distribution layer (spec
 * "Stage 4"). Runs BEFORE prompt construction, using coordinates only — no
 * AI call — to turn a flat candidate list into a bounded, pre-clustered
 * planning context: a suggested day→geographic-zone split the model is
 * given alongside the candidate pool, instead of being handed an unordered
 * list and expected to solve routing/geography entirely on its own (see
 * docs/itinerary-audit.md section 3.11 — no such module existed before).
 *
 * This is advisory, not a hard constraint: it only SUGGESTS which
 * candidates are geographically compatible with which day, so the model
 * (and the deterministic validator) can still move something for a
 * must-visit place, an opening-hours conflict, or an explicit user
 * priority. Nothing here drops a candidate — same invariant as
 * ./scoring.ts — it only groups/labels them.
 *
 * Clustering is deterministic (no randomness) so the same input always
 * produces the same grouping: farthest-point seeding (a reproducible
 * stand-in for k-means++) followed by a few Lloyd's-algorithm refinement
 * passes, using an equirectangular distance approximation (accurate enough
 * at city scale, cheaper than full haversine for repeated iteration).
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ClusterableCandidate extends GeoPoint {
  id: string;
}

export interface GeoCluster<T extends ClusterableCandidate> {
  dayIndex: number; // 0-based, relative to the destination's own day range
  centroid: GeoPoint;
  candidates: T[];
}

const EARTH_RADIUS_METERS = 6371000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Real great-circle distance in meters — used for distance-threshold decisions (a cheap pre-filter), never as a substitute for actual travel time. */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line pre-filter: drops candidates farther than `maxMeters` from
 * `anchor` (e.g. the accommodation, or a destination center when no
 * accommodation was given). Deliberately NOT used anywhere as a stand-in
 * for real travel time — only as a cheap first cut before the (bounded,
 * costlier) Routes API is involved, or to keep an obviously-wrong-city
 * candidate out of consideration.
 */
export function filterByStraightLineDistance<T extends GeoPoint>(
  candidates: T[],
  anchor: GeoPoint,
  maxMeters: number,
): T[] {
  return candidates.filter((c) => haversineDistanceMeters(anchor, c) <= maxMeters);
}

/** Cheap squared equirectangular distance for repeated clustering comparisons — monotonic with real distance at city scale, avoids trig in the hot loop. */
function planarDistanceSq(a: GeoPoint, b: GeoPoint): number {
  const latScale = Math.cos(toRad((a.lat + b.lat) / 2));
  const dLat = a.lat - b.lat;
  const dLng = (a.lng - b.lng) * latScale;
  return dLat * dLat + dLng * dLng;
}

function meanPoint(points: GeoPoint[]): GeoPoint {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

/**
 * Deterministic farthest-point seeding: the first centroid is `anchor` when
 * given (so day 0 — typically the arrival day — starts near the
 * accommodation), otherwise the point closest to the overall mean. Each
 * subsequent centroid is the remaining point that maximizes its minimum
 * distance to all centroids chosen so far — a reproducible stand-in for
 * k-means++ initialization, with no randomness.
 */
function seedCentroids<T extends GeoPoint>(points: T[], k: number, anchor?: GeoPoint): GeoPoint[] {
  if (points.length === 0 || k <= 0) return [];
  const centroids: GeoPoint[] = [];

  if (anchor) {
    centroids.push(anchor);
  } else {
    const mean = meanPoint(points);
    let closest = points[0];
    let closestDist = planarDistanceSq(mean, closest);
    for (const p of points) {
      const d = planarDistanceSq(mean, p);
      if (d < closestDist) {
        closest = p;
        closestDist = d;
      }
    }
    centroids.push({ lat: closest.lat, lng: closest.lng });
  }

  while (centroids.length < k && centroids.length < points.length) {
    let farthest: GeoPoint = points[0];
    let farthestMinDist = -1;
    for (const p of points) {
      let minDist = Infinity;
      for (const c of centroids) {
        minDist = Math.min(minDist, planarDistanceSq(c, p));
      }
      if (minDist > farthestMinDist) {
        farthestMinDist = minDist;
        farthest = p;
      }
    }
    centroids.push({ lat: farthest.lat, lng: farthest.lng });
  }

  return centroids;
}

const LLOYD_ITERATIONS = 4;

/**
 * Splits `candidates` into up to `dayCount` geographic clusters. Candidates
 * without usable lat/lng are returned separately as `unclustered` — they
 * can't be geographically grouped, but callers should still offer them to
 * the model, just without a suggested day. An `anchor` (the accommodation,
 * when known) biases cluster 0 toward it, so the arrival day's suggested
 * zone starts near where the traveler is actually staying.
 */
export function clusterByDay<T extends ClusterableCandidate>(
  candidates: T[],
  dayCount: number,
  opts: { anchor?: GeoPoint } = {},
): { clusters: GeoCluster<T>[]; unclustered: T[] } {
  const withCoords = candidates.filter(
    (c): c is T => typeof c.lat === "number" && typeof c.lng === "number" && Number.isFinite(c.lat) && Number.isFinite(c.lng),
  );
  const unclustered = candidates.filter((c) => !withCoords.includes(c));

  const k = Math.max(1, Math.min(dayCount, withCoords.length));
  if (withCoords.length === 0 || k === 0) {
    return { clusters: [], unclustered: candidates };
  }

  let centroids = seedCentroids(withCoords, k, opts.anchor);

  let assignment: number[] = new Array(withCoords.length).fill(0);
  for (let iter = 0; iter < LLOYD_ITERATIONS; iter++) {
    // Assign step.
    assignment = withCoords.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let ci = 0; ci < centroids.length; ci++) {
        const d = planarDistanceSq(centroids[ci], p);
        if (d < bestDist) {
          bestDist = d;
          best = ci;
        }
      }
      return best;
    });

    // Update step — recompute centroid as the mean of its assigned points.
    // A cluster that lost all its points keeps its previous centroid rather
    // than collapsing to NaN.
    const next: GeoPoint[] = centroids.map((prev, ci) => {
      const members = withCoords.filter((_, i) => assignment[i] === ci);
      return members.length > 0 ? meanPoint(members) : prev;
    });
    centroids = next;
  }

  const clusters: GeoCluster<T>[] = centroids.map((centroid, dayIndex) => ({
    dayIndex,
    centroid,
    candidates: withCoords.filter((_, i) => assignment[i] === dayIndex),
  }));

  return { clusters, unclustered };
}

/**
 * Renders the clustering result as a short, deterministic prompt block —
 * the model still makes the final call on which candidate goes where, but
 * is given a geography-aware starting point instead of an unordered list.
 * Never invents anything: only restates candidate IDs/names already present
 * in the pool, grouped by the day index computed above.
 */
export function buildClusteringPromptBlock<T extends ClusterableCandidate & { name: string }>(
  clusters: GeoCluster<T>[],
  dayOffset = 0,
): string {
  const nonEmpty = clusters.filter((c) => c.candidates.length > 0);
  if (nonEmpty.length === 0) return "";
  const lines = nonEmpty.map(
    (c) =>
      `- Dia ${c.dayIndex + 1 + dayOffset} (zona geográfica sugerida): ${c.candidates.map((cand) => cand.name).join(", ")}`,
  );
  return `\nSugestão de agrupamento geográfico por dia (baseado em coordenadas reais — uma sugestão de ponto de partida, não uma obrigação; priorize sempre horário de funcionamento, lugares obrigatórios e preferências do viajante sobre este agrupamento quando houver conflito):\n${lines.join("\n")}`;
}
