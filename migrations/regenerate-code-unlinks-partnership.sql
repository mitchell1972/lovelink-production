-- Regenerate partner code and unlink current active partnership atomically.
-- Run this in Supabase SQL editor for existing environments.

CREATE OR REPLACE FUNCTION public.regenerate_partner_code()
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_partnership_id UUID;
  v_partner_id UUID;
  v_new_code TEXT;
  v_code_record RECORD;
  v_unlinked BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT
    p.id,
    CASE
      WHEN p.user1_id = v_user_id THEN p.user2_id
      ELSE p.user1_id
    END
  INTO v_partnership_id, v_partner_id
  FROM public.partnerships p
  WHERE p.status = 'active'
    AND (p.user1_id = v_user_id OR p.user2_id = v_user_id)
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_partnership_id IS NOT NULL AND v_partner_id IS NOT NULL THEN
    -- Serialize operations that affect this couple's active relationship.
    PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(v_user_id, v_partner_id)::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(v_user_id, v_partner_id)::text, 0));

    UPDATE public.partnerships
    SET status = 'ended'
    WHERE id = v_partnership_id
      AND status = 'active';

    v_unlinked := FOUND;

    UPDATE public.profiles
    SET partner_id = NULL
    WHERE id IN (v_user_id, v_partner_id);
  END IF;

  DELETE FROM public.partner_codes
  WHERE user_id = v_user_id
    AND used_at IS NULL;

  v_new_code := public.generate_partner_code();

  INSERT INTO public.partner_codes (user_id, code, expires_at)
  VALUES (v_user_id, v_new_code, NOW() + INTERVAL '48 hours')
  RETURNING
    id,
    user_id,
    code,
    expires_at
  INTO v_code_record;

  RETURN json_build_object(
    'success', true,
    'unlinked', v_unlinked,
    'partnership_id', v_partnership_id,
    'code', json_build_object(
      'id', v_code_record.id,
      'user_id', v_code_record.user_id,
      'code', v_code_record.code,
      'expires_at', v_code_record.expires_at
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.regenerate_partner_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_partner_code() TO authenticated;
