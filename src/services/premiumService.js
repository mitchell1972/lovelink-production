// src/services/premiumService.js
// Premium subscription management service

import { supabase } from '../config/supabase';

// Feature limits for free vs premium users
export const FEATURE_LIMITS = {
  free: {
    momentsLimit: 10,           // Max photos in gallery
    sessionsHistoryDays: 7,     // Days of session history
    pulsePatterns: ['heartbeat'], // Only basic pulse
    planTemplates: false,       // No premium templates
    bonusSessionPacks: false,   // No bonus sessions
    extendedMoments: false,     // No filters/unlimited
    customPulsePatterns: false, // No custom patterns
  },
  premium: {
    momentsLimit: Infinity,     // Unlimited photos
    sessionsHistoryDays: 365,   // Full year of history
    pulsePatterns: ['heartbeat', 'flutter', 'steady', 'excited', 'calm'],
    planTemplates: true,        // Premium date templates
    bonusSessionPacks: true,    // Extra session types
    extendedMoments: true,      // Filters & unlimited
    customPulsePatterns: true,  // Custom patterns
  }
};

// Premium features list for display
export const PREMIUM_FEATURES = [
  {
    id: 'bonus_sessions',
    icon: '🎯',
    title: 'Bonus Session Packs',
    description: 'Gratitude, reflection, adventure, and more',
    freeValue: '1 pack',
    premiumValue: 'All 8 packs',
  },
  {
    id: 'plan_templates',
    icon: '📅',
    title: 'Premium Plan Templates',
    description: 'Date ideas with reminders',
    freeValue: 'Basic only',
    premiumValue: '50+ templates',
  },
  {
    id: 'extended_moments',
    icon: '🖼️',
    title: 'Extended Moments',
    description: 'Unlimited storage & filters',
    freeValue: '10 photos',
    premiumValue: 'Unlimited',
  },
  {
    id: 'custom_pulse',
    icon: '💕',
    title: 'Custom Pulse Patterns',
    description: 'Unique haptic rhythms',
    freeValue: '1 pattern',
    premiumValue: '5+ patterns',
  },
];

/**
 * Get current user's premium status
 */
export const getPremiumStatus = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_premium, premium_since, premium_expires, premium_plan')
      .eq('id', userId)
      .single();

    if (error) throw error;

    // Check if premium is still valid (not expired)
    const isValid = data.is_premium && 
      (!data.premium_expires || new Date(data.premium_expires) > new Date());

    return {
      isPremium: isValid,
      plan: data.premium_plan,
      since: data.premium_since,
      expires: data.premium_expires,
    };
  } catch (error) {
    console.error('Error getting premium status:', error);
    return { isPremium: false, plan: null, since: null, expires: null };
  }
};

/**
 * Get feature limits based on premium status
 */
export const getFeatureLimits = async (userId) => {
  const { isPremium } = await getPremiumStatus(userId);
  return isPremium ? FEATURE_LIMITS.premium : FEATURE_LIMITS.free;
};

/**
 * Check if a specific feature is available
 */
export const checkFeatureAccess = async (userId, featureName) => {
  const limits = await getFeatureLimits(userId);
  return limits[featureName] || false;
};

/**
 * Check moments limit
 */
export const checkMomentsLimit = async (userId) => {
  try {
    const limits = await getFeatureLimits(userId);
    
    // Get current moments count
    const { data: profile } = await supabase
      .from('profiles')
      .select('partner_id')
      .eq('id', userId)
      .single();

    if (!profile?.partner_id) {
      return { allowed: true, current: 0, limit: limits.momentsLimit };
    }

    const { count } = await supabase
      .from('moments')
      .select('*', { count: 'exact', head: true })
      .or(`user_id.eq.${userId},user_id.eq.${profile.partner_id}`);

    const currentCount = count || 0;
    const canAdd = limits.momentsLimit === Infinity || currentCount < limits.momentsLimit;

    return {
      allowed: canAdd,
      current: currentCount,
      limit: limits.momentsLimit,
      isPremium: limits.momentsLimit === Infinity,
    };
  } catch (error) {
    console.error('Error checking moments limit:', error);
    return { allowed: true, current: 0, limit: 10 };
  }
};

/**
 * Get available pulse patterns for user
 */
export const getAvailablePulsePatterns = async (userId) => {
  const limits = await getFeatureLimits(userId);
  return limits.pulsePatterns;
};

// NOTE: togglePremium testing function removed for production
// Premium status is now only managed through real IAP purchases via iapService.js

/**
 * Format premium expiry date for display
 */
export const formatPremiumExpiry = (expiresDate) => {
  if (!expiresDate) return 'Never';
  
  const date = new Date(expiresDate);
  const now = new Date();
  const daysLeft = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  
  if (daysLeft < 0) return 'Expired';
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return 'Expires tomorrow';
  if (daysLeft <= 7) return `Expires in ${daysLeft} days`;
  
  return `Expires ${date.toLocaleDateString()}`;
};

export default {
  getPremiumStatus,
  getFeatureLimits,
  checkFeatureAccess,
  checkMomentsLimit,
  getAvailablePulsePatterns,
  formatPremiumExpiry,
  FEATURE_LIMITS,
  PREMIUM_FEATURES,
};
