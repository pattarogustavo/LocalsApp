/**
 * Pure helpers for ai.generateFromScratch's parallel-by-day generation
 * (itinerary-engine speed/quality redesign): splitting a multi-destination,
 * multi-day trip into one descriptor per global day index, and deciding
 * which single day's prompt should carry a given must-visit place as a hard
 * requirement.
 *
 * The must-visit assignment here is only a PROMPT HINT to improve the odds
 * the model includes it on the first try — it is NOT the correctness
 * guarantee. That guarantee is validateAndCorrectItinerary's existing
 * forced-insertion step (ctx.mustVisit), which runs on the full merged
 * itinerary regardless of which day originally "owned" the hint, and can
 * still place a must-visit item on ANY day with free time. A wrong
 * assignment here costs a little prompt-hint accuracy, never correctness.
 */

import { addDaysToDateString } from "./dates";

export interface DayDescriptor {
  /** 0-based index across the WHOLE trip (not per-destination). */
  index: number;
  date: string;
  destinationName: string;
  destinationCountry?: string;
  lat?: number;
  lng?: number;
  isFirstDay: boolean;
  isLastDay: boolean;
}

export function buildDayDescriptors(
  startDate: string,
  destinations: { name: string; country?: string; days: number; lat?: number; lng?: number }[],
): DayDescriptor[] {
  const totalDays = destinations.reduce((sum, d) => sum + Math.max(0, d.days), 0);
  const descriptors: DayDescriptor[] = [];
  let offset = 0;
  for (const dest of destinations) {
    for (let i = 0; i < dest.days; i++) {
      const index = offset + i;
      descriptors.push({
        index,
        date: addDaysToDateString(startDate, index),
        destinationName: dest.name,
        destinationCountry: dest.country,
        lat: dest.lat,
        lng: dest.lng,
        isFirstDay: index === 0,
        isLastDay: index === totalDays - 1,
      });
    }
    offset += dest.days;
  }
  return descriptors;
}

export interface AssignableMustVisit {
  name: string;
  /** Present for a user-selected place (tied to one destination); absent for a free-text "must-see" hint (assigned to a middle day instead). */
  destinationName?: string;
  address?: string;
  lat?: number;
  lng?: number;
  hours?: string;
}

/** Day index → the must-visit items whose prompt should mention them as a hard requirement. */
export function assignMustVisitToDays(
  descriptors: DayDescriptor[],
  mustVisit: AssignableMustVisit[],
): Map<number, AssignableMustVisit[]> {
  const byDay = new Map<number, AssignableMustVisit[]>();
  if (descriptors.length === 0) return byDay;

  const addTo = (dayIndex: number, item: AssignableMustVisit) => {
    const list = byDay.get(dayIndex) ?? [];
    list.push(item);
    byDay.set(dayIndex, list);
  };

  for (const item of mustVisit) {
    if (item.destinationName) {
      const destDays = descriptors.filter((d) => d.destinationName === item.destinationName);
      const target = destDays[0] ?? descriptors[0];
      addTo(target.index, item);
    } else {
      // No destination tied to it (e.g. a resolved free-text "mustSee") —
      // a middle day tends to have the most schedule flexibility (neither
      // the arrival nor departure buffer applies to it).
      const target = descriptors[Math.floor(descriptors.length / 2)];
      addTo(target.index, item);
    }
  }

  return byDay;
}
