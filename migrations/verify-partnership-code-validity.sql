-- Migration: Add verify_partnership_code_validity function
-- This function checks if either partner has regenerated their code since
-- the partnership was created. If so, it ends the partnership automatically.
-- Run this in Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.verify_partnership_code_validity(
  p_partnership_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partnership record;
  v_caller_id uuid;
  v_new_code_exists boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Not authenticated');
  END IF;

  -- Get the active partnership (only if the caller is a member)
  SELECT * INTO v_partnership
  FROM partnerships
  WHERE id = p_partnership_id
    AND status = 'active'
    AND (user1_id = v_caller_id OR user2_id = v_caller_id);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Partnership not found or inactive');
  END IF;

  -- Check if either partner has generated a new unused code AFTER
  -- the partnership was created. This signals intent to re-pair.
  SELECT EXISTS (
    SELECT 1 FROM partner_codes
    WHERE user_id IN (v_partnership.user1_id, v_partnership.user2_id)
      AND created_at > v_partnership.created_at
      AND used_at IS NULL
  ) INTO v_new_code_exists;

  IF v_new_code_exists THEN
    -- End the partnership
    UPDATE partnerships
    SET status = 'ended', updated_at = now()
    WHERE id = p_partnership_id
      AND status = 'active';

    -- Clear partner_id on both profiles
    UPDATE profiles
    SET partner_id = NULL, updated_at = now()
    WHERE id IN (v_partnership.user1_id, v_partnership.user2_id)
      AND partner_id IS NOT NULL;

    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'A partner regenerated their code. Partnership has been disconnected.'
    );
  END IF;

  RETURN jsonb_build_object('valid', true);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_partnership_code_validity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_partnership_code_validity(uuid) TO authenticated;
