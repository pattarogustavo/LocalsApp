import { TRPCError } from "@trpc/server";

/**
 * Normalizes any date-ish input (a bare "YYYY-MM-DD", or a full ISO datetime
 * like trip.startDate, which the app stores as `Date#toISOString()`) down to
 * its "YYYY-MM-DD" date part. Throws a clear, explicit error instead of
 * letting an unparsable value silently turn into an Invalid Date downstream
 * (which previously surfaced much later as an opaque "Invalid time value"
 * from `.toISOString()` deep inside itinerary generation).
 */
export function normalizeToDateOnlyString(dateStr: string): string {
  const datePart = (dateStr || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || Number.isNaN(new Date(`${datePart}T00:00:00Z`).getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Data inválida: "${dateStr}". Esperado um formato de data válido (YYYY-MM-DD ou ISO 8601).`,
    });
  }
  return datePart;
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${normalizeToDateOnlyString(dateStr)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
