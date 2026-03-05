-- Migration: improve pulse partner visibility + plan query performance
-- Run in Supabase SQL editor for existing environments.

-- 1) Ensure plans list query has an index that matches filter + sort.
CREATE INDEX IF NOT EXISTS idx_plans_partnership_created_at
  ON public.plans(partnership_id, created_at DESC);

-- 2) Ensure pulse SELECT policy explicitly allows either partner.
DROP POLICY IF EXISTS "Users can view partnership pulses" ON public.pulses;
CREATE POLICY "Users can view partnership pulses" ON public.pulses
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = pulses.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );
