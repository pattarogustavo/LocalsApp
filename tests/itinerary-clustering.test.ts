import { describe, it, expect } from "vitest";
import {
  haversineDistanceMeters,
  filterByStraightLineDistance,
  clusterByDay,
  buildClusteringPromptBlock,
} from "../server/itinerary/clustering";

describe("haversineDistanceMeters", () => {
  it("returns ~0 for the same point", () => {
    expect(haversineDistanceMeters({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBeCloseTo(0, 1);
  });

  it("matches a known real-world distance within a small tolerance (Eiffel Tower → Louvre, ~3.2km)", () => {
    const eiffel = { lat: 48.8584, lng: 2.2945 };
    const louvre = { lat: 48.8606, lng: 2.3376 };
    const meters = haversineDistanceMeters(eiffel, louvre);
    expect(meters).toBeGreaterThan(2800);
    expect(meters).toBeLessThan(3600);
  });
});

describe("filterByStraightLineDistance", () => {
  it("is a cheap pre-filter only — drops points beyond the radius, keeps points within it", () => {
    const anchor = { lat: 0, lng: 0 };
    const near = { lat: 0, lng: 0.001, id: "near" }; // ~111m
    const far = { lat: 0, lng: 1, id: "far" }; // ~111km
    const kept = filterByStraightLineDistance([near, far], anchor, 1000);
    expect(kept).toEqual([near]);
  });
});

describe("clusterByDay", () => {
  it("is deterministic — the same input always produces the same grouping", () => {
    const candidates = [
      { id: "a", lat: 48.86, lng: 2.33 },
      { id: "b", lat: 48.861, lng: 2.332 },
      { id: "c", lat: 48.87, lng: 2.38 },
      { id: "d", lat: 48.871, lng: 2.382 },
    ];
    const run1 = clusterByDay(candidates, 2);
    const run2 = clusterByDay(candidates, 2);
    expect(run1).toEqual(run2);
  });

  it("groups geographically close points into the same cluster, far points into different ones", () => {
    const candidates = [
      { id: "a", lat: 48.86, lng: 2.33 },
      { id: "b", lat: 48.8605, lng: 2.3305 }, // very close to a
      { id: "c", lat: 48.95, lng: 2.45 }, // far from a/b
      { id: "d", lat: 48.9505, lng: 2.4505 }, // very close to c
    ];
    const { clusters, unclustered } = clusterByDay(candidates, 2);
    expect(unclustered).toHaveLength(0);
    expect(clusters).toHaveLength(2);

    const clusterOf = (id: string) => clusters.find((c) => c.candidates.some((cand) => cand.id === id));
    expect(clusterOf("a")).toBe(clusterOf("b"));
    expect(clusterOf("c")).toBe(clusterOf("d"));
    expect(clusterOf("a")).not.toBe(clusterOf("c"));
  });

  it("never drops a candidate — every input candidate appears in exactly one cluster or in unclustered", () => {
    const candidates = [
      { id: "a", lat: 10, lng: 10 },
      { id: "b", lat: 10.1, lng: 10.1 },
      { id: "c", lat: -5, lng: 40 },
      { id: "d", lat: -5.1, lng: 40.1 },
      { id: "e", lat: 60, lng: -70 },
    ];
    const { clusters, unclustered } = clusterByDay(candidates, 3);
    const seen = new Set([...unclustered.map((c) => c.id), ...clusters.flatMap((c) => c.candidates.map((cand) => cand.id))]);
    expect(seen).toEqual(new Set(candidates.map((c) => c.id)));
  });

  it("puts candidates without usable lat/lng into `unclustered` rather than dropping or crashing", () => {
    const candidates = [
      { id: "a", lat: 10, lng: 10 },
      { id: "b", lat: NaN as unknown as number, lng: 10 },
      { id: "c", lat: undefined as unknown as number, lng: undefined as unknown as number },
    ];
    const { clusters, unclustered } = clusterByDay(candidates, 2);
    expect(unclustered.map((c) => c.id).sort()).toEqual(["b", "c"]);
    expect(clusters.flatMap((c) => c.candidates.map((cand) => cand.id))).toEqual(["a"]);
  });

  it("biases the first cluster (day 0 — typically the arrival day) toward the given anchor when provided", () => {
    const anchor = { lat: 48.86, lng: 2.33 };
    const candidates = [
      { id: "near-anchor", lat: 48.861, lng: 2.331 },
      { id: "far-1", lat: 49.5, lng: 3.5 },
      { id: "far-2", lat: 49.51, lng: 3.51 },
    ];
    const { clusters } = clusterByDay(candidates, 2, { anchor });
    const day0 = clusters.find((c) => c.dayIndex === 0)!;
    expect(day0.candidates.map((c) => c.id)).toContain("near-anchor");
  });

  it("caps the number of clusters at the candidate count when dayCount exceeds it", () => {
    const candidates = [{ id: "a", lat: 0, lng: 0 }];
    const { clusters } = clusterByDay(candidates, 5);
    expect(clusters).toHaveLength(1);
  });

  it("returns no clusters (everything unclustered) for an empty candidate list", () => {
    const { clusters, unclustered } = clusterByDay([], 3);
    expect(clusters).toEqual([]);
    expect(unclustered).toEqual([]);
  });
});

describe("buildClusteringPromptBlock", () => {
  it("renders non-empty clusters as a day-numbered list, applying the day offset", () => {
    const block = buildClusteringPromptBlock(
      [
        { dayIndex: 0, centroid: { lat: 0, lng: 0 }, candidates: [{ id: "a", name: "Louvre", lat: 0, lng: 0 }] },
        { dayIndex: 1, centroid: { lat: 1, lng: 1 }, candidates: [] },
      ],
      2, // e.g. second destination in a multi-city trip, starting at day 3
    );
    expect(block).toContain("Dia 3");
    expect(block).toContain("Louvre");
    expect(block).not.toContain("Dia 4"); // the empty cluster is omitted, not rendered as an empty day
  });

  it("returns an empty string when every cluster is empty", () => {
    expect(buildClusteringPromptBlock([{ dayIndex: 0, centroid: { lat: 0, lng: 0 }, candidates: [] }])).toBe("");
  });
});
