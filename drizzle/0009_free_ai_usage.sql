CREATE TABLE "free_ai_usage" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"trip_id" varchar(64) NOT NULL,
	"info_used" boolean DEFAULT false NOT NULL,
	"places_used" boolean DEFAULT false NOT NULL,
	"itinerary_used" boolean DEFAULT false NOT NULL,
	CONSTRAINT "free_ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE "free_ai_usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Atomically claims a user's one free use of `feature` ('info'|'places'|
-- 'itinerary') on trip `tid`. Returns true if the use was granted (first
-- time this feature is used on this user's free trip), false otherwise
-- (feature already used, or `tid` isn't this user's free trip). The first
-- call for a user creates their free_ai_usage row and fixes `tid` as their
-- free trip for good — a later call with a different `tid` never matches
-- the UPDATE's `trip_id = $2` filter, so it fails closed.
CREATE OR REPLACE FUNCTION claim_free_ai(uid integer, tid varchar, feature text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
  IF feature NOT IN ('info', 'places', 'itinerary') THEN RETURN false; END IF;

  INSERT INTO free_ai_usage(user_id, trip_id) VALUES (uid, tid)
    ON CONFLICT (user_id) DO NOTHING;

  EXECUTE format(
    'UPDATE free_ai_usage SET %1$I = true
      WHERE user_id = $1 AND trip_id = $2 AND %1$I = false
      RETURNING true', feature || '_used')
    INTO ok USING uid, tid;

  RETURN coalesce(ok, false);
END $$;
--> statement-breakpoint
-- Gives back a claimed free use of `feature` for `uid` (regardless of
-- trip_id) — called when the AI generation itself fails after a successful
-- claim, so a server/LLM error never costs the user their one free credit.
CREATE OR REPLACE FUNCTION release_free_ai(uid integer, feature text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF feature NOT IN ('info', 'places', 'itinerary') THEN RETURN; END IF;

  EXECUTE format('UPDATE free_ai_usage SET %1$I = false WHERE user_id = $1',
                 feature || '_used') USING uid;
END $$;
