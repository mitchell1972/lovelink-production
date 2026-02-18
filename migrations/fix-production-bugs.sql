-- Migration: Production bug fixes (plans/pulses/partner-code security/push tokens)
-- Run this in Supabase SQL editor for existing environments.

-- 1) Ensure push token column exists for notifications
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS push_token TEXT;

COMMENT ON COLUMN public.profiles.push_token IS 'Expo push notification token';

-- 2) Tighten partner code policies (remove broad read/update access)
DROP POLICY IF EXISTS "Anyone can validate codes" ON public.partner_codes;
DROP POLICY IF EXISTS "Users can use codes" ON public.partner_codes;

DROP POLICY IF EXISTS "Users can delete own unused codes" ON public.partner_codes;
CREATE POLICY "Users can delete own unused codes" ON public.partner_codes
  FOR DELETE USING (auth.uid() = user_id AND used_at IS NULL);

-- 3) Add secure validator RPC for partner code checks
CREATE OR REPLACE FUNCTION validate_partner_code(p_code TEXT)
RETURNS JSON AS $$
DECLARE
  v_code_record RECORD;
BEGIN
  SELECT
    pc.id,
    pc.code,
    pc.expires_at,
    pc.user_id,
    p.name AS partner_name
  INTO v_code_record
  FROM public.partner_codes pc
  JOIN public.profiles p ON p.id = pc.user_id
  WHERE pc.code = UPPER(p_code)
    AND pc.used_at IS NULL
    AND pc.expires_at > NOW();

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid or expired code');
  END IF;

  IF v_code_record.user_id = auth.uid() THEN
    RETURN json_build_object('valid', false, 'error', 'Cannot use your own code');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'code', json_build_object(
      'id', v_code_record.id,
      'code', v_code_record.code,
      'expires_at', v_code_record.expires_at,
      'user_id', v_code_record.user_id,
      'profiles', json_build_object('name', v_code_record.partner_name)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4) Allow deleting pulses sent by the current user only
DROP POLICY IF EXISTS "Users can delete own pulses" ON public.pulses;
CREATE POLICY "Users can delete own pulses" ON public.pulses
  FOR DELETE USING (
    auth.uid() = sender_id AND
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );
