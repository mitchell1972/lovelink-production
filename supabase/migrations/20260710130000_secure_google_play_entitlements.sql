-- Secure Google Play subscription entitlements.
-- Google purchase tokens are stored in a service-role-only table and are never
-- trusted until the Google Play Developer API has verified them.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS premium_plan TEXT,
ADD COLUMN IF NOT EXISTS premium_since TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS premium_expires TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS iap_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS iap_product_id TEXT,
ADD COLUMN IF NOT EXISTS premium_granted_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS iap_store TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_premium_plan_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_premium_plan_check
    CHECK (premium_plan IS NULL OR premium_plan IN ('monthly', 'yearly'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_iap_store_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_iap_store_check
    CHECK (iap_store IS NULL OR iap_store IN ('app_store', 'google_play'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.google_play_entitlements (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  purchase_token TEXT NOT NULL UNIQUE,
  purchase_token_hash TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL CHECK (product_id IN (
    'com.lovelinkcouples.premium.monthly',
    'com.lovelinkcouples.premium.yearly'
  )),
  subscription_state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  base_plan_id TEXT,
  offer_id TEXT,
  auto_renewing BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_play_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_play_entitlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.google_play_entitlements TO service_role;

CREATE OR REPLACE FUNCTION public.apply_verified_google_play_entitlement(
  p_user_id UUID,
  p_product_id TEXT,
  p_purchase_token TEXT,
  p_purchase_token_hash TEXT,
  p_linked_purchase_token TEXT,
  p_subscription_state TEXT,
  p_expires_at TIMESTAMPTZ,
  p_base_plan_id TEXT,
  p_offer_id TEXT,
  p_auto_renewing BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
  v_existing_owner UUID;
  v_linked_owner UUID;
  v_plan TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Service role required');
  END IF;

  IF p_product_id = 'com.lovelinkcouples.premium.monthly' THEN
    v_plan := 'monthly';
  ELSIF p_product_id = 'com.lovelinkcouples.premium.yearly' THEN
    v_plan := 'yearly';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unsupported product');
  END IF;

  IF p_purchase_token IS NULL OR LENGTH(TRIM(p_purchase_token)) = 0
     OR p_purchase_token_hash IS NULL OR LENGTH(TRIM(p_purchase_token_hash)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing purchase token');
  END IF;

  IF p_subscription_state NOT IN (
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_CANCELED'
  ) OR p_expires_at <= NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscription is not entitled');
  END IF;

  SELECT user_id INTO v_existing_owner
  FROM public.google_play_entitlements
  WHERE purchase_token = p_purchase_token;

  IF v_existing_owner IS NOT NULL AND v_existing_owner <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purchase token already belongs to another account');
  END IF;

  IF p_linked_purchase_token IS NOT NULL AND LENGTH(TRIM(p_linked_purchase_token)) > 0 THEN
    SELECT user_id INTO v_linked_owner
    FROM public.google_play_entitlements
    WHERE purchase_token = p_linked_purchase_token;

    DELETE FROM public.google_play_entitlements
    WHERE purchase_token = p_linked_purchase_token;

    IF v_linked_owner IS NOT NULL AND v_linked_owner <> p_user_id THEN
      UPDATE public.profiles
      SET
        is_premium = FALSE,
        premium_plan = NULL,
        premium_since = NULL,
        premium_expires = NULL,
        iap_transaction_id = NULL,
        iap_product_id = NULL,
        iap_store = NULL,
        premium_granted_by = NULL,
        updated_at = NOW()
      WHERE id = v_linked_owner
        AND iap_store = 'google_play';
    END IF;
  END IF;

  INSERT INTO public.google_play_entitlements (
    user_id,
    purchase_token,
    purchase_token_hash,
    product_id,
    subscription_state,
    expires_at,
    base_plan_id,
    offer_id,
    auto_renewing,
    verified_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_purchase_token,
    p_purchase_token_hash,
    p_product_id,
    p_subscription_state,
    p_expires_at,
    p_base_plan_id,
    p_offer_id,
    p_auto_renewing,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    purchase_token = EXCLUDED.purchase_token,
    purchase_token_hash = EXCLUDED.purchase_token_hash,
    product_id = EXCLUDED.product_id,
    subscription_state = EXCLUDED.subscription_state,
    expires_at = EXCLUDED.expires_at,
    base_plan_id = EXCLUDED.base_plan_id,
    offer_id = EXCLUDED.offer_id,
    auto_renewing = EXCLUDED.auto_renewing,
    verified_at = NOW(),
    updated_at = NOW();

  UPDATE public.profiles
  SET
    is_premium = TRUE,
    premium_plan = v_plan,
    premium_since = CASE
      WHEN iap_store = 'google_play' AND premium_since IS NOT NULL THEN premium_since
      ELSE NOW()
    END,
    premium_expires = p_expires_at,
    iap_transaction_id = p_purchase_token_hash,
    iap_product_id = p_product_id,
    iap_store = 'google_play',
    premium_granted_by = NULL,
    updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'plan', v_plan,
    'expires_at', p_expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.apply_verified_google_play_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_google_play_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN
) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_google_play_entitlement(
  p_user_id UUID,
  p_purchase_token TEXT,
  p_subscription_state TEXT
)
RETURNS JSONB AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Service role required');
  END IF;

  UPDATE public.google_play_entitlements
  SET
    subscription_state = COALESCE(p_subscription_state, 'SUBSCRIPTION_STATE_EXPIRED'),
    verified_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND purchase_token = p_purchase_token;

  UPDATE public.profiles
  SET
    is_premium = FALSE,
    premium_plan = NULL,
    premium_since = NULL,
    premium_expires = NULL,
    iap_transaction_id = NULL,
    iap_product_id = NULL,
    iap_store = NULL,
    premium_granted_by = NULL,
    updated_at = NOW()
  WHERE id = p_user_id
    AND iap_store = 'google_play';

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.revoke_google_play_entitlement(UUID, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_google_play_entitlement(UUID, TEXT, TEXT)
TO service_role;

-- Prevent direct client updates from manufacturing or extending premium.
-- Clearing premium is allowed so existing unlink/account cleanup functions keep
-- working. The temporary iOS RPC below sets a transaction-local marker.
CREATE OR REPLACE FUNCTION public.prevent_unverified_premium_write()
RETURNS TRIGGER AS $$
DECLARE
  v_changed BOOLEAN;
  v_clearing BOOLEAN;
BEGIN
  v_changed :=
    NEW.is_premium IS DISTINCT FROM OLD.is_premium
    OR NEW.premium_plan IS DISTINCT FROM OLD.premium_plan
    OR NEW.premium_since IS DISTINCT FROM OLD.premium_since
    OR NEW.premium_expires IS DISTINCT FROM OLD.premium_expires
    OR NEW.iap_transaction_id IS DISTINCT FROM OLD.iap_transaction_id
    OR NEW.iap_product_id IS DISTINCT FROM OLD.iap_product_id
    OR NEW.iap_store IS DISTINCT FROM OLD.iap_store
    OR NEW.premium_granted_by IS DISTINCT FROM OLD.premium_granted_by;

  v_clearing :=
    COALESCE(NEW.is_premium, FALSE) = FALSE
    AND NEW.premium_plan IS NULL
    AND NEW.premium_since IS NULL
    AND NEW.premium_expires IS NULL
    AND NEW.iap_transaction_id IS NULL
    AND NEW.iap_product_id IS NULL
    AND NEW.iap_store IS NULL
    AND NEW.premium_granted_by IS NULL;

  IF v_changed
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('lovelink.allow_premium_write', TRUE), '') <> 'true'
     AND NOT v_clearing THEN
    RAISE EXCEPTION 'Premium fields can only be changed after server verification';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_prevent_unverified_premium_write ON public.profiles;
CREATE TRIGGER trg_prevent_unverified_premium_write
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unverified_premium_write();

-- Stop treating copied partner fields as independent subscriptions. Partner
-- access is resolved dynamically from the active partnership instead.
UPDATE public.profiles
SET
  is_premium = FALSE,
  premium_plan = NULL,
  premium_since = NULL,
  premium_expires = NULL,
  iap_transaction_id = NULL,
  iap_product_id = NULL,
  iap_store = NULL,
  premium_granted_by = NULL,
  updated_at = NOW()
WHERE premium_granted_by IS NOT NULL;

-- Temporary compatibility for the currently released iOS build. Android never
-- calls this function after 1.0.9; it uses Google server verification instead.
CREATE OR REPLACE FUNCTION public.grant_premium_from_iap(
  p_user_id UUID,
  p_product_id TEXT,
  p_transaction_id TEXT,
  p_plan TEXT,
  p_premium_since TIMESTAMPTZ,
  p_premium_expires TIMESTAMPTZ
)
RETURNS JSON AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_plan NOT IN ('monthly', 'yearly')
     OR (p_plan = 'monthly' AND p_product_id NOT IN (
       'com.lovelinkcouples.premium.monthly',
       'com.lovelink.premium.monthly',
       'lovelink.premium.monthly'
     ))
     OR (p_plan = 'yearly' AND p_product_id NOT IN (
       'com.lovelinkcouples.premium.yearly',
       'com.lovelink.premium.yearly'
     )) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid product or plan');
  END IF;

  IF p_transaction_id IS NULL OR LENGTH(TRIM(p_transaction_id)) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Missing transaction');
  END IF;

  IF ABS(EXTRACT(EPOCH FROM (p_premium_since - NOW()))) > 300
     OR p_premium_expires <= NOW()
     OR p_premium_expires > NOW() + INTERVAL '370 days' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid entitlement dates');
  END IF;

  PERFORM set_config('lovelink.allow_premium_write', 'true', TRUE);

  UPDATE public.profiles
  SET
    is_premium = TRUE,
    premium_plan = p_plan,
    premium_since = p_premium_since,
    premium_expires = p_premium_expires,
    iap_transaction_id = p_transaction_id,
    iap_product_id = p_product_id,
    iap_store = 'app_store',
    premium_granted_by = NULL,
    updated_at = NOW()
  WHERE id = p_user_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.grant_premium_from_iap(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_premium_from_iap(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;
