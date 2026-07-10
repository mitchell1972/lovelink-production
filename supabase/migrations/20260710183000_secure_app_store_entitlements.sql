-- Secure App Store subscription entitlements.
-- Only Apple-verified transactions may create or extend premium access.

CREATE TABLE IF NOT EXISTS public.app_store_entitlements (
  original_transaction_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL UNIQUE,
  app_account_token UUID NOT NULL,
  product_id TEXT NOT NULL CHECK (product_id IN (
    'com.lovelinkcouples.premium.monthly',
    'com.lovelinkcouples.premium.yearly'
  )),
  subscription_status SMALLINT NOT NULL CHECK (subscription_status BETWEEN 1 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('Production', 'Sandbox')),
  auto_renew_status SMALLINT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_store_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_store_entitlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_store_entitlements TO service_role;

CREATE OR REPLACE FUNCTION public.apply_verified_app_store_entitlement(
  p_user_id UUID,
  p_product_id TEXT,
  p_transaction_id TEXT,
  p_original_transaction_id TEXT,
  p_app_account_token UUID,
  p_subscription_status SMALLINT,
  p_expires_at TIMESTAMPTZ,
  p_environment TEXT,
  p_auto_renew_status SMALLINT
)
RETURNS JSONB AS $$
DECLARE
  v_existing_owner UUID;
  v_plan TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Service role required');
  END IF;

  IF p_app_account_token IS NULL OR p_app_account_token <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'App account token mismatch');
  END IF;

  IF p_product_id = 'com.lovelinkcouples.premium.monthly' THEN
    v_plan := 'monthly';
  ELSIF p_product_id = 'com.lovelinkcouples.premium.yearly' THEN
    v_plan := 'yearly';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unsupported product');
  END IF;

  IF p_transaction_id IS NULL OR LENGTH(TRIM(p_transaction_id)) = 0
     OR p_original_transaction_id IS NULL OR LENGTH(TRIM(p_original_transaction_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing verified transaction');
  END IF;

  IF p_subscription_status NOT IN (1, 4) OR p_expires_at <= NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscription is not entitled');
  END IF;

  IF p_environment NOT IN ('Production', 'Sandbox') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid App Store environment');
  END IF;

  SELECT user_id INTO v_existing_owner
  FROM public.app_store_entitlements
  WHERE original_transaction_id = p_original_transaction_id;

  IF v_existing_owner IS NOT NULL AND v_existing_owner <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscription already belongs to another account');
  END IF;

  INSERT INTO public.app_store_entitlements (
    original_transaction_id,
    user_id,
    transaction_id,
    app_account_token,
    product_id,
    subscription_status,
    expires_at,
    environment,
    auto_renew_status,
    verified_at,
    updated_at
  )
  VALUES (
    p_original_transaction_id,
    p_user_id,
    p_transaction_id,
    p_app_account_token,
    p_product_id,
    p_subscription_status,
    p_expires_at,
    p_environment,
    p_auto_renew_status,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    original_transaction_id = EXCLUDED.original_transaction_id,
    transaction_id = EXCLUDED.transaction_id,
    app_account_token = EXCLUDED.app_account_token,
    product_id = EXCLUDED.product_id,
    subscription_status = EXCLUDED.subscription_status,
    expires_at = EXCLUDED.expires_at,
    environment = EXCLUDED.environment,
    auto_renew_status = EXCLUDED.auto_renew_status,
    verified_at = NOW(),
    updated_at = NOW();

  UPDATE public.profiles
  SET
    is_premium = TRUE,
    premium_plan = v_plan,
    premium_since = CASE
      WHEN iap_store = 'app_store' AND premium_since IS NOT NULL THEN premium_since
      ELSE NOW()
    END,
    premium_expires = p_expires_at,
    iap_transaction_id = p_transaction_id,
    iap_product_id = p_product_id,
    iap_store = 'app_store',
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

REVOKE ALL ON FUNCTION public.apply_verified_app_store_entitlement(
  UUID, TEXT, TEXT, TEXT, UUID, SMALLINT, TIMESTAMPTZ, TEXT, SMALLINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_app_store_entitlement(
  UUID, TEXT, TEXT, TEXT, UUID, SMALLINT, TIMESTAMPTZ, TEXT, SMALLINT
) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_app_store_entitlement(
  p_user_id UUID,
  p_original_transaction_id TEXT,
  p_subscription_status SMALLINT,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Service role required');
  END IF;

  UPDATE public.app_store_entitlements
  SET
    subscription_status = COALESCE(p_subscription_status, 2),
    expires_at = COALESCE(p_expires_at, expires_at),
    verified_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id
    AND original_transaction_id = p_original_transaction_id;

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
    AND iap_store = 'app_store';

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.revoke_app_store_entitlement(
  UUID, TEXT, SMALLINT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_app_store_entitlement(
  UUID, TEXT, SMALLINT, TIMESTAMPTZ
) TO service_role;

-- Remove the released client-trusted write path. New iOS clients call the
-- authenticated Edge Function, which invokes only service-role RPCs.
REVOKE ALL ON FUNCTION public.grant_premium_from_iap(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.grant_premium_from_iap(
  UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
);

-- Premium writes must now come from a service-role verifier. Clearing remains
-- available so account deletion and unlink cleanup continue to fail closed.
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
     AND NOT v_clearing THEN
    RAISE EXCEPTION 'Premium fields can only be changed after server verification';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Existing iOS grants were created without Apple verification. Revoke them
-- once this migration is deployed; the new client can securely restore an
-- active subscription through the App Store verifier.
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
WHERE iap_store = 'app_store';
