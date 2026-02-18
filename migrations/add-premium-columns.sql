-- Migration: Add Premium Subscription Columns to profiles table
-- Run this in your Supabase SQL Editor if you already have the database set up
-- Date: 2026-01-03

-- Add premium columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS premium_plan TEXT CHECK (premium_plan IS NULL OR premium_plan IN ('monthly', 'yearly')),
ADD COLUMN IF NOT EXISTS premium_since TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS premium_expires TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS iap_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS iap_product_id TEXT,
ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Create index for premium queries
CREATE INDEX IF NOT EXISTS idx_profiles_premium ON public.profiles(is_premium) WHERE is_premium = TRUE;

-- Comment explaining the columns
COMMENT ON COLUMN public.profiles.is_premium IS 'Whether user has active premium subscription';
COMMENT ON COLUMN public.profiles.premium_plan IS 'Current subscription plan: monthly or yearly';
COMMENT ON COLUMN public.profiles.premium_since IS 'When premium was first activated';
COMMENT ON COLUMN public.profiles.premium_expires IS 'When current subscription period expires';
COMMENT ON COLUMN public.profiles.iap_transaction_id IS 'Apple/Google transaction ID for the purchase';
COMMENT ON COLUMN public.profiles.iap_product_id IS 'Product ID from App Store/Play Store';
COMMENT ON COLUMN public.profiles.push_token IS 'Expo push notification token';

-- NOTE: Premium status is ONLY managed through real IAP purchases
-- There are no admin/testing functions to manually enable premium
