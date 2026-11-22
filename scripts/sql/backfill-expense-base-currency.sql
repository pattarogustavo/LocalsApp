-- Backfill multi-currency fields (exchangeRate, baseAmount, rateSource) onto
-- existing expenses in the `trips` table.
--
-- Not a schema migration: Trip/Expense have no DB columns of their own —
-- they live inside `trips.data` (a JSON blob, see drizzle/schema.ts). This
-- is a one-off DATA backfill, run manually (not via drizzle-kit).
--
-- Why this is safe for every trip, regardless of its base currency:
-- before multi-currency support, `Expense.currency` existed in the type but
-- was never choosable by the user — every expense was always saved with
-- `currency` equal to its trip's `currency` (base currency). So for ANY
-- expense missing `baseAmount`, exchangeRate = 1 and baseAmount = amount is
-- exact, not an approximation — there is no "which trips need a different
-- rule" case to handle.
--
-- Idempotent (only touches expenses that don't already have `baseAmount`)
-- and optional: the app already falls back to this same rule at read time
-- (expense.baseAmount ?? expense.amount), so correctness doesn't depend on
-- running this — it just makes the stored data match what the app already
-- assumes, and lets future server-side reporting read `baseAmount` directly.
--
-- Run with:
--   psql "$DATABASE_URL" -f scripts/sql/backfill-expense-base-currency.sql
--
-- Review the SELECT below first to see how many rows would be touched.

BEGIN;

-- Preview (uncomment to run as a dry-run count before the UPDATE):
-- SELECT count(*) FROM trips
-- WHERE jsonb_typeof(data::jsonb->'expenses') = 'array'
--   AND EXISTS (
--     SELECT 1 FROM jsonb_array_elements(data::jsonb->'expenses') AS e
--     WHERE NOT (e ? 'baseAmount')
--   );

UPDATE trips
SET data = jsonb_set(
  data::jsonb,
  '{expenses}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN expense ? 'baseAmount' THEN expense
        ELSE expense || jsonb_build_object(
          'exchangeRate', 1,
          'baseAmount', expense->'amount',
          'rateSource', 'frankfurter'
        )
      END
    )
    FROM jsonb_array_elements(data::jsonb->'expenses') AS expense
  )
)::text
WHERE jsonb_typeof(data::jsonb->'expenses') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(data::jsonb->'expenses') AS e
    WHERE NOT (e ? 'baseAmount')
  );

COMMIT;
