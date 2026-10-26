-- Run once in this CloudBase PostgreSQL environment's SQL editor.
-- No learning records or family secrets are seeded by this migration.
BEGIN;
CREATE TABLE IF NOT EXISTS public.xw_wordbooks (
  id text PRIMARY KEY,
  owner_id text NOT NULL UNIQUE,
  state text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  invite_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.xw_access_attempts (
  key text PRIMARY KEY,
  bucket bigint NOT NULL,
  count integer NOT NULL
);

ALTER TABLE public.xw_wordbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xw_access_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xw_wordbooks, public.xw_access_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.xw_wordbooks, public.xw_access_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.xw_bump_attempt(p_key text, p_window bigint)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  INSERT INTO public.xw_access_attempts AS current_attempt (key, bucket, count)
  VALUES (p_key, p_window, 1)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE WHEN current_attempt.bucket = EXCLUDED.bucket THEN current_attempt.count + 1 ELSE 1 END,
        bucket = EXCLUDED.bucket
  RETURNING count;
$function$;
REVOKE ALL ON FUNCTION public.xw_bump_attempt(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xw_bump_attempt(text, bigint) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
