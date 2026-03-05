-- Migration: Add missing DELETE policy for plans table
-- Without this, RLS silently blocks plan deletion.

DROP POLICY IF EXISTS "Users can delete partnership plans" ON public.plans;
CREATE POLICY "Users can delete partnership plans" ON public.plans
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = plans.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );
