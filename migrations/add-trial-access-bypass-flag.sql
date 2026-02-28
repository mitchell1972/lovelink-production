-- Migration: Add trial access bypass flag for internal/admin test accounts
-- This lets selected accounts bypass the 7-day core-feature trial gate.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS trial_access_bypass BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.trial_access_bypass IS
'If true, bypasses the 7-day trial paywall for internal/admin/test accounts.';

-- Prevent normal authenticated users from self-enabling bypass.
-- Admin/service updates remain allowed.
CREATE OR REPLACE FUNCTION public.prevent_trial_access_bypass_self_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trial_access_bypass IS DISTINCT FROM OLD.trial_access_bypass
     AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed to modify trial_access_bypass';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_trial_access_bypass_self_update ON public.profiles;
CREATE TRIGGER trg_prevent_trial_access_bypass_self_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_trial_access_bypass_self_update();
