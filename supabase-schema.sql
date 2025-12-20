-- LoveLink Production Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE (extends Supabase auth.users)
-- =============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  partner_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- PARTNER CODES TABLE
-- =============================================
CREATE TABLE public.partner_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT code_format CHECK (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$')
);

-- Index for fast code lookups
CREATE INDEX idx_partner_codes_code ON public.partner_codes(code) WHERE used_at IS NULL;
CREATE INDEX idx_partner_codes_user ON public.partner_codes(user_id);

-- =============================================
-- PARTNERSHIPS TABLE
-- =============================================
CREATE TABLE public.partnerships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT different_users CHECK (user1_id != user2_id),
  CONSTRAINT unique_partnership UNIQUE (user1_id, user2_id)
);

-- =============================================
-- DAILY SESSIONS TABLE
-- =============================================
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL CHECK (session_type IN ('mood', 'appreciation', 'microPlan', 'wins')),
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  session_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching today's sessions
CREATE INDEX idx_sessions_date ON public.sessions(partnership_id, session_date);

-- =============================================
-- MOMENTS (PHOTOS) TABLE
-- =============================================
CREATE TABLE public.moments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_moments_partnership ON public.moments(partnership_id, created_at DESC);

-- =============================================
-- PLANS TABLE
-- =============================================
CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scheduled_date TIMESTAMPTZ,
  budget TEXT CHECK (budget IN ('Low', 'Medium', 'High')),
  vibe TEXT CHECK (vibe IN ('Casual', 'Romantic', 'Adventurous', 'Relaxing')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'rejected', 'completed')),
  confirmed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plans_partnership ON public.plans(partnership_id, status);

-- =============================================
-- PULSES TABLE (for the heartbeat feature)
-- =============================================
CREATE TABLE public.pulses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pulses_partnership ON public.pulses(partnership_id, created_at DESC);

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulses ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can view partner profile" ON public.profiles
  FOR SELECT USING (
    id IN (
      SELECT user1_id FROM public.partnerships WHERE user2_id = auth.uid()
      UNION
      SELECT user2_id FROM public.partnerships WHERE user1_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Partner codes policies
CREATE POLICY "Users can view own codes" ON public.partner_codes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own codes" ON public.partner_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can validate codes" ON public.partner_codes
  FOR SELECT USING (used_at IS NULL AND expires_at > NOW());

CREATE POLICY "Users can use codes" ON public.partner_codes
  FOR UPDATE USING (used_at IS NULL AND expires_at > NOW());

-- Partnerships policies
CREATE POLICY "Users can view own partnerships" ON public.partnerships
  FOR SELECT USING (auth.uid() IN (user1_id, user2_id));

CREATE POLICY "Users can create partnerships" ON public.partnerships
  FOR INSERT WITH CHECK (auth.uid() IN (user1_id, user2_id));

-- Sessions policies
CREATE POLICY "Users can view partnership sessions" ON public.sessions
  FOR SELECT USING (
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can create own sessions" ON public.sessions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

-- Moments policies
CREATE POLICY "Users can view partnership moments" ON public.moments
  FOR SELECT USING (
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can create moments" ON public.moments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can delete own moments" ON public.moments
  FOR DELETE USING (auth.uid() = user_id);

-- Plans policies
CREATE POLICY "Users can view partnership plans" ON public.plans
  FOR SELECT USING (
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can create plans" ON public.plans
  FOR INSERT WITH CHECK (
    auth.uid() = created_by AND
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can update partnership plans" ON public.plans
  FOR UPDATE USING (
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

-- Pulses policies
CREATE POLICY "Users can view partnership pulses" ON public.pulses
  FOR SELECT USING (
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can send pulses" ON public.pulses
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

CREATE POLICY "Users can update pulse received status" ON public.pulses
  FOR UPDATE USING (
    partnership_id IN (
      SELECT id FROM public.partnerships WHERE auth.uid() IN (user1_id, user2_id)
    )
  );

-- =============================================
-- FUNCTIONS
-- =============================================

-- Function to generate unique partner code
CREATE OR REPLACE FUNCTION generate_partner_code()
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate code: timestamp part + random part
    new_code := UPPER(
      SUBSTRING(TO_HEX(EXTRACT(EPOCH FROM NOW())::BIGINT) FROM 1 FOR 4) || '-' ||
      SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 4)
    );
    
    -- Check if code exists
    SELECT EXISTS(
      SELECT 1 FROM public.partner_codes WHERE code = new_code
    ) INTO code_exists;
    
    EXIT WHEN NOT code_exists;
  END LOOP;
  
  RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Function to link partners
CREATE OR REPLACE FUNCTION link_partners(p_code TEXT)
RETURNS JSON AS $$
DECLARE
  v_code_record RECORD;
  v_partnership_id UUID;
BEGIN
  -- Get the code record
  SELECT * INTO v_code_record
  FROM public.partner_codes
  WHERE code = p_code
    AND used_at IS NULL
    AND expires_at > NOW();
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid or expired code');
  END IF;
  
  IF v_code_record.user_id = auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Cannot use your own code');
  END IF;
  
  -- Create partnership
  INSERT INTO public.partnerships (user1_id, user2_id)
  VALUES (v_code_record.user_id, auth.uid())
  RETURNING id INTO v_partnership_id;
  
  -- Mark code as used
  UPDATE public.partner_codes
  SET used_at = NOW(), used_by = auth.uid()
  WHERE id = v_code_record.id;
  
  -- Update both profiles with partner_id
  UPDATE public.profiles SET partner_id = auth.uid() WHERE id = v_code_record.user_id;
  UPDATE public.profiles SET partner_id = v_code_record.user_id WHERE id = auth.uid();
  
  RETURN json_build_object(
    'success', true,
    'partnership_id', v_partnership_id,
    'partner_id', v_code_record.user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on signup
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- REALTIME SUBSCRIPTIONS
-- =============================================
-- Enable realtime for tables that need live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.moments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pulses;
