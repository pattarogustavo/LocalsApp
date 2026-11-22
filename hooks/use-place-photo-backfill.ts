import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Place } from '@/types/voyage';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import { useAuthStore } from '@/store/auth';
import { useTripsStore } from '@/store/trips';
import { handlePaywallError } from '@/hooks/use-paywall-guard';

const BATCH_SIZE = 12; // places.catalogDetails' input cap

/**
 * Lazily backfills photo/address for already-saved places that don't have
 * one yet — same Google Places pipeline (places.catalogDetails) the
 * recommendations tab already uses for its own suggestions, just applied to
 * `trip.places` too. This is what gives AI-itinerary-added places (saved
 * without a photo by design — see ai.generateFromScratch) a photo once
 * they're actually displayed, instead of never fetching one.
 *
 * Only fetches for places currently passed in (the caller decides what's
 * "on screen"), at most BATCH_SIZE per render, and never re-fetches a
 * placeId this hook instance already tried (success or failure) — so
 * scrolling/re-rendering never causes repeat Google calls for the same
 * place. Fetched photos are persisted via updatePlace so they stick.
 */
export function usePlacePhotoBackfill(tripId: string, places: Place[]) {
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const { updatePlace } = useTripsStore(useShallow((s) => ({ updatePlace: s.updatePlace })));
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const needsDetails = places.filter(
      (p) => p.placeId && !fetchedRef.current.has(p.placeId) && (!p.imageUrl || !p.address)
    );
    if (needsDetails.length === 0) return;
    const batch = needsDetails.slice(0, BATCH_SIZE);
    batch.forEach((p) => fetchedRef.current.add(p.placeId!));
    (async () => {
      try {
        const res = await trpcVanilla.places.catalogDetails.query({
          placeIds: batch.map((p) => p.placeId!),
          language: preferredLanguage,
        });
        const details = res?.details;
        if (!details) return;
        for (const place of batch) {
          const d = place.placeId ? details[place.placeId] : undefined;
          if (!d) continue;
          const updates: Partial<Place> = {};
          if (place.imageUrl == null && d.imageUrl != null) updates.imageUrl = d.imageUrl;
          if (place.address == null && d.address != null) updates.address = d.address;
          if (place.hours == null && d.hours != null) updates.hours = d.hours;
          if (place.phone == null && d.phone != null) updates.phone = d.phone;
          if (Object.keys(updates).length > 0) {
            await updatePlace(tripId, place.id, updates);
          }
        }
      } catch (e) {
        console.error('[usePlacePhotoBackfill] batch fetch error:', e);
        handlePaywallError(e);
      }
    })();
  }, [places, preferredLanguage, tripId, updatePlace]);
}
