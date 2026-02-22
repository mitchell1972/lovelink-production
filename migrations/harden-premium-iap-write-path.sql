-- Migration: Add secure RPC for premium writes from IAP purchases
-- Backward compatible: app falls back to legacy profile update if this RPC is not present.

CREATE OR REPLACE FUNCTION public.grant_premium_from_iap(
  p_user_id UUID,
  p_product_id TEXT,
  p_transaction_id TEXT,
  p_plan TEXT,
  p_premium_since TIMESTAMPTZ,
  p_premium_expires TIMESTAMPTZ
)
RETURNS JSON AS $$
DECLARE
  v_profile RECORD;
  v_partner_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_plan NOT IN ('monthly', 'yearly') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid plan');
  END IF;

  IF p_product_id IS NULL OR LENGTH(TRIM(p_product_id)) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Missing product id');
  END IF;

  IF p_product_id NOT IN (
    'com.lovelinkcouples.premium.monthly',
    'com.lovelinkcouples.premium.yearly',
    'com.lovelink.premium.monthly',
    'com.lovelink.premium.yearly',
    'lovelink.premium.monthly'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Unsupported product id');
  END IF;

  SELECT id, partner_id, iap_transaction_id
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Profile not found');
  END IF;

  IF p_transaction_id IS NOT NULL AND v_profile.iap_transaction_id = p_transaction_id THEN
    RETURN json_build_object('success', true, 'duplicate', true);
  END IF;

  UPDATE public.profiles
  SET
    is_premium = TRUE,
    premium_plan = p_plan,
    premium_since = p_premium_since,
    premium_expires = p_premium_expires,
    iap_transaction_id = p_transaction_id,
    iap_product_id = p_product_id,
    updated_at = NOW()
  WHERE id = p_user_id;

  v_partner_id := v_profile.partner_id;
  IF v_partner_id IS NULL THEN
    SELECT CASE
      WHEN p.user1_id = p_user_id THEN p.user2_id
      ELSE p.user1_id
    END
    INTO v_partner_id
    FROM public.partnerships p
    WHERE (p.user1_id = p_user_id OR p.user2_id = p_user_id)
      AND p.status = 'active'
    ORDER BY p.created_at DESC
    LIMIT 1;
  END IF;

  IF v_partner_id IS NOT NULL THEN
    UPDATE public.profiles
    SET
      is_premium = TRUE,
      premium_plan = p_plan,
      premium_since = p_premium_since,
      premium_expires = p_premium_expires,
      premium_granted_by = p_user_id,
      updated_at = NOW()
    WHERE id = v_partner_id;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.grant_premium_from_iap(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_premium_from_iap(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
