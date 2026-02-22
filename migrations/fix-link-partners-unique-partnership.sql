-- Fix duplicate-key failures when linking an already-existing couple pair.
-- This function now:
-- 1) Reuses an existing partnership for the pair in canonical order.
-- 2) Reactivates ended partnerships.
-- 3) Handles concurrent link requests safely via ON CONFLICT DO NOTHING.
-- 4) Returns `already_linked=true` when the pair already existed.

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

  SELECT id, status
  INTO v_existing_partnership
  FROM public.partnerships
  WHERE user1_id = v_user_low
    AND user2_id = v_user_high
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
      WHERE user1_id = v_user_low
        AND user2_id = v_user_high
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

  UPDATE public.profiles SET partner_id = v_current_user_id WHERE id = v_code_record.user_id;
  UPDATE public.profiles SET partner_id = v_code_record.user_id WHERE id = v_current_user_id;

  RETURN json_build_object(
    'success', true,
    'partnership_id', v_partnership_id,
    'partner_id', v_target_user_id,
    'already_linked', v_was_existing
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
