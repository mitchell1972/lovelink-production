-- Restrict feature access to active partnerships only.
-- This prevents users from updating old data after disconnecting.

-- Sessions
DROP POLICY IF EXISTS "Users can view partnership sessions" ON public.sessions;
CREATE POLICY "Users can view partnership sessions" ON public.sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = sessions.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

DROP POLICY IF EXISTS "Users can create own sessions" ON public.sessions;
CREATE POLICY "Users can create own sessions" ON public.sessions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = sessions.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

-- Moments
DROP POLICY IF EXISTS "Users can view partnership moments" ON public.moments;
CREATE POLICY "Users can view partnership moments" ON public.moments
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = moments.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

DROP POLICY IF EXISTS "Users can create moments" ON public.moments;
CREATE POLICY "Users can create moments" ON public.moments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = moments.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

-- Plans
DROP POLICY IF EXISTS "Users can view partnership plans" ON public.plans;
CREATE POLICY "Users can view partnership plans" ON public.plans
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = plans.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

DROP POLICY IF EXISTS "Users can create plans" ON public.plans;
CREATE POLICY "Users can create plans" ON public.plans
  FOR INSERT WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = plans.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

DROP POLICY IF EXISTS "Users can update partnership plans" ON public.plans;
CREATE POLICY "Users can update partnership plans" ON public.plans
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = plans.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

-- Pulses
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

DROP POLICY IF EXISTS "Users can send pulses" ON public.pulses;
CREATE POLICY "Users can send pulses" ON public.pulses
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = pulses.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

DROP POLICY IF EXISTS "Users can update pulse received status" ON public.pulses;
CREATE POLICY "Users can update pulse received status" ON public.pulses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = pulses.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );

DROP POLICY IF EXISTS "Users can delete own pulses" ON public.pulses;
CREATE POLICY "Users can delete own pulses" ON public.pulses
  FOR DELETE USING (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1
      FROM public.partnerships p
      WHERE p.id = pulses.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user1_id, p.user2_id)
    )
  );
