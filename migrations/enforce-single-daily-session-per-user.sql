-- Enforce one Daily Session response per user per day.
-- Run this in Supabase SQL editor for existing environments.

-- Backfill any missing dates before adding constraints/index.
UPDATE public.sessions
SET session_date = CURRENT_DATE
WHERE session_date IS NULL;

ALTER TABLE public.sessions
ALTER COLUMN session_date SET NOT NULL;

-- Keep the newest row per (user_id, session_date) and delete older duplicates.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, session_date
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.sessions
)
DELETE FROM public.sessions s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

-- DB-level guard: each user can submit only one daily response.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_date_unique
  ON public.sessions(user_id, session_date);
