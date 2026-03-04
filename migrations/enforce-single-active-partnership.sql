-- Enforce one active partnership per user and prevent multi-linking.
-- Run this in Supabase SQL editor for existing environments.

-- 1) Partnership creation must go through RPC, not direct table inserts.
DROP POLICY IF EXISTS "Users can create partnerships" ON public.partnerships;

-- 2) Cleanup existing bad data: end extra active rows so each user keeps only
-- the most recent active partnership.
WITH active_edges AS (
  SELECT id, created_at, user1_id AS user_id
  FROM public.partnerships
  WHERE status = 'active'
  UNION ALL
  SELECT id, created_at, user2_id AS user_id
  FROM public.partnerships
  WHERE status = 'active'
),
ranked_edges AS (
  SELECT
    id,
    user_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM active_edges
),
to_end AS (
  SELECT DISTINCT id
  FROM ranked_edges
  WHERE rn > 1
)
UPDATE public.partnerships p
SET
  status = 'ended'
WHERE p.id IN (SELECT id FROM to_end);

-- Keep profile.partner_id aligned with active partnerships after cleanup.
UPDATE public.profiles
SET
  partner_id = NULL
WHERE partner_id IS NOT NULL;

UPDATE public.profiles p
SET
  partner_id = ap.partner_id
FROM (
  SELECT user1_id AS user_id, user2_id AS partner_id
  FROM public.partnerships
  WHERE status = 'active'
  UNION ALL
  SELECT user2_id AS user_id, user1_id AS partner_id
  FROM public.partnerships
  WHERE status = 'active'
) ap
WHERE p.id = ap.user_id;

-- 3) DB-level guard: a user cannot appear in more than one active partnership.
CREATE OR REPLACE FUNCTION public.enforce_single_active_partnership()
RETURNS trigger AS $$
DECLARE
  v_conflict_id UUID;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent writes that may activate partnerships.
  LOCK TABLE public.partnerships IN SHARE ROW EXCLUSIVE MODE;

  SELECT p.id
  INTO v_conflict_id
  FROM public.partnerships p
  WHERE p.status = 'active'
    AND p.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      p.user1_id IN (NEW.user1_id, NEW.user2_id)
      OR p.user2_id IN (NEW.user1_id, NEW.user2_id)
    )
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'A user can only be in one active partnership'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_single_active_partnership ON public.partnerships;
CREATE TRIGGER trg_enforce_single_active_partnership
  BEFORE INSERT OR UPDATE OF user1_id, user2_id, status
  ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_active_partnership();

-- 4) Harden link RPC: reject linking if either user is already linked elsewhere.
CREATE OR REPLACE FUNCTION public.link_partners(p_code TEXT)
RETURNS JSON AS $$
DECLARE
  v_code_record RECORD;
  v_existing_partnership RECORD;
  v_partnership_id UUID;
  v_current_user_id UUID := auth.uid();
  v_target_user_id UUID;
  v_user_low UUID;
  v_user_high UUID;
  v_was_existing BOOLEAN := false;
BEGIN
  SELECT * INTO v_code_record
  FROM public.partner_codes
  WHERE code = UPPER(p_code)
    AND used_at IS NULL
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid or expired code');
  END IF;

  v_target_user_id := v_code_record.user_id;

  IF v_target_user_id = v_current_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot use your own code');
  END IF;

  v_user_low := LEAST(v_target_user_id, v_current_user_id);
  v_user_high := GREATEST(v_target_user_id, v_current_user_id);

  -- Deterministic advisory locks to serialize link attempts for both users.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_low::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_high::text, 0));

  -- If the current user is already linked with someone else, block.
  IF EXISTS (
    SELECT 1
    FROM public.partnerships p
    WHERE p.status = 'active'
      AND (p.user1_id = v_current_user_id OR p.user2_id = v_current_user_id)
      AND NOT (
        (p.user1_id = v_user_low AND p.user2_id = v_user_high)
        OR (p.user1_id = v_user_high AND p.user2_id = v_user_low)
      )
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'You are already linked to another partner. Unlink first.'
    );
  END IF;

  -- If the code owner is already linked with someone else, block.
  IF EXISTS (
    SELECT 1
    FROM public.partnerships p
    WHERE p.status = 'active'
      AND (p.user1_id = v_target_user_id OR p.user2_id = v_target_user_id)
      AND NOT (
        (p.user1_id = v_user_low AND p.user2_id = v_user_high)
        OR (p.user1_id = v_user_high AND p.user2_id = v_user_low)
      )
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'This person is already linked to another partner.'
    );
  END IF;

  SELECT id, status
  INTO v_existing_partnership
  FROM public.partnerships
  WHERE (user1_id = v_user_low AND user2_id = v_user_high)
     OR (user1_id = v_user_high AND user2_id = v_user_low)
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_was_existing := true;
    v_partnership_id := v_existing_partnership.id;

    IF v_existing_partnership.status <> 'active' THEN
      UPDATE public.partnerships
      SET status = 'active'
      WHERE id = v_partnership_id;
    END IF;
  ELSE
    INSERT INTO public.partnerships (user1_id, user2_id, status)
    VALUES (v_user_low, v_user_high, 'active')
    ON CONFLICT (user1_id, user2_id) DO NOTHING
    RETURNING id INTO v_partnership_id;

    IF v_partnership_id IS NULL THEN
      SELECT id, status
      INTO v_existing_partnership
      FROM public.partnerships
      WHERE (user1_id = v_user_low AND user2_id = v_user_high)
         OR (user1_id = v_user_high AND user2_id = v_user_low)
      ORDER BY created_at DESC
      LIMIT 1;

      IF FOUND THEN
        v_was_existing := true;
        v_partnership_id := v_existing_partnership.id;

        IF v_existing_partnership.status <> 'active' THEN
          UPDATE public.partnerships
          SET status = 'active'
          WHERE id = v_partnership_id;
        END IF;
      ELSE
        RETURN json_build_object('success', false, 'error', 'Failed to create partnership');
      END IF;
    END IF;
  END IF;

  UPDATE public.partner_codes
  SET
    used_at = COALESCE(used_at, NOW()),
    used_by = COALESCE(used_by, v_current_user_id)
  WHERE id = v_code_record.id;

  -- Invalidate any other outstanding codes for either user after successful link.
  UPDATE public.partner_codes
  SET used_at = NOW()
  WHERE used_at IS NULL
    AND id <> v_code_record.id
    AND user_id IN (v_current_user_id, v_target_user_id);

  UPDATE public.profiles SET partner_id = v_current_user_id WHERE id = v_code_record.user_id;
  UPDATE public.profiles SET partner_id = v_code_record.user_id WHERE id = v_current_user_id;

  RETURN json_build_object(
    'success', true,
    'partnership_id', v_partnership_id,
    'partner_id', v_target_user_id,
    'already_linked', v_was_existing
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
