-- Regenerate partner code and unlink current active partnership atomically.
-- Run this in Supabase SQL editor for existing environments.

CREATE OR REPLACE FUNCTION public.regenerate_partner_code()
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_partnership_id UUID;
  v_partner_id UUID;
  v_disconnected_partner_ids UUID[];
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

  IF v_partnership_id IS NOT NULL THEN
    -- Serialize partnership regeneration to avoid races.
    LOCK TABLE public.partnerships IN SHARE ROW EXCLUSIVE MODE;

    SELECT ARRAY_AGG(DISTINCT ended.partner_id)
    INTO v_disconnected_partner_ids
    FROM (
      UPDATE public.partnerships p
      SET status = 'ended'
      WHERE p.status = 'active'
        AND (p.user1_id = v_user_id OR p.user2_id = v_user_id)
      RETURNING CASE
        WHEN p.user1_id = v_user_id THEN p.user2_id
        ELSE p.user1_id
      END AS partner_id
    ) ended;

    v_unlinked := COALESCE(array_length(v_disconnected_partner_ids, 1), 0) > 0;

    UPDATE public.profiles
    SET partner_id = NULL
    WHERE id = v_user_id
      OR id = ANY(COALESCE(v_disconnected_partner_ids, ARRAY[]::UUID[]))
      OR partner_id = v_user_id;

    -- Revoke cross-shared premium access when this couple disconnects.
    -- A real payer keeps their own premium (premium_granted_by is NULL),
    -- while the recipient of shared premium loses access.
    UPDATE public.profiles
    SET
      is_premium = FALSE,
      premium_plan = NULL,
      premium_since = NULL,
      premium_expires = NULL,
      iap_transaction_id = NULL,
      iap_product_id = NULL,
      premium_granted_by = NULL,
      updated_at = NOW()
    WHERE (
      id = v_user_id
      OR id = ANY(COALESCE(v_disconnected_partner_ids, ARRAY[]::UUID[]))
    )
      AND (
        premium_granted_by = v_user_id
        OR premium_granted_by = ANY(COALESCE(v_disconnected_partner_ids, ARRAY[]::UUID[]))
      );
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
