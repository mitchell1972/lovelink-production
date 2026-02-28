-- Migration: Add robust self-service account deletion RPC
-- Why this is needed:
-- - App calls `rpc('delete_user_account')` from Settings.
-- - This function was missing in some environments.
-- - Several references to profiles do not cascade on delete:
--   profiles.partner_id, profiles.premium_granted_by, partner_codes.used_by.
--   These must be cleared before deleting the auth user.

DROP FUNCTION IF EXISTS public.delete_user_account();

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Clear non-cascading references to this profile from other rows.
  UPDATE public.profiles
  SET
    partner_id = NULL,
    premium_granted_by = NULL,
    updated_at = NOW()
  WHERE partner_id = v_user_id
     OR premium_granted_by = v_user_id;

  UPDATE public.partner_codes
  SET used_by = NULL
  WHERE used_by = v_user_id;

  UPDATE public.plans
  SET confirmed_by = NULL
  WHERE confirmed_by = v_user_id;

  -- Delete auth user; profile row and dependent data cascade from there.
  DELETE FROM auth.users
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.delete_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
