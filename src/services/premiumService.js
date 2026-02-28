// src/services/premiumService.js
// Premium subscription management service

import { supabase } from '../config/supabase';

export const TRIAL_DAYS = 7;
export const TRIAL_GATED_FEATURES = ['session', 'moments', 'pulse', 'plan'];
export const TRIAL_BYPASS_COLUMN = 'trial_access_bypass';

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_COLUMN_ERROR_CODES = new Set(['42703', 'PGRST204']);

/**
 * Check if premium fields represent a valid (non-expired) subscription
 */
const isPremiumValid = (profile) =>
  profile.is_premium &&
  (!profile.premium_expires || new Date(profile.premium_expires) > new Date());

/**
 * Resolve partner id from active partnerships when profile.partner_id is absent.
 */
const getPartnerIdFromActivePartnership = async (userId) => {
  const { data: partnerships, error } = await supabase
    .from('partnerships')
    .select('user1_id, user2_id')
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  const rows = Array.isArray(partnerships) ? partnerships : (partnerships ? [partnerships] : []);
  const latest = rows[0];

  if (!latest) return null;
  return latest.user1_id === userId ? latest.user2_id : latest.user1_id;
};

/**
 * Get current user's premium status.
 * One subscription covers both partners — if the user's partner is premium,
 * the user is treated as premium too.
 */
export const getPremiumStatus = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_premium, premium_since, premium_expires, premium_plan, partner_id')
      .eq('id', userId)
      .single();

    if (error) throw error;

    // Check user's own premium status first
    if (isPremiumValid(data)) {
      return {
        isPremium: true,
        source: 'self',
        plan: data.premium_plan,
        since: data.premium_since,
        expires: data.premium_expires,
      };
    }

    // If not premium, check partner's premium status.
    // We first try profile.partner_id, then fall back to active partnerships.
    const partnerId = data.partner_id || await getPartnerIdFromActivePartnership(userId);
    if (partnerId) {
      const { data: partner, error: partnerError } = await supabase
        .from('profiles')
        .select('is_premium, premium_since, premium_expires, premium_plan, name')
        .eq('id', partnerId)
        .single();

      if (!partnerError && partner && isPremiumValid(partner)) {
        return {
          isPremium: true,
          source: 'partner',
          partnerName: partner.name,
          plan: partner.premium_plan,
          since: partner.premium_since,
          expires: partner.premium_expires,
        };
      }
    }

    return { isPremium: false, source: null, plan: null, since: null, expires: null };
  } catch (error) {
    console.error('Error getting premium status:', error);
    return { isPremium: false, source: null, plan: null, since: null, expires: null };
  }
};

/**
 * Determine whether the user can access trial-gated core features.
 * Access is granted when:
 * - user has active premium (self or partner), or
 * - user account age is within 7-day trial window.
 */
export const getTrialAccessStatus = async (userId) => {
  try {
    const premiumStatus = await getPremiumStatus(userId);

    if (premiumStatus.isPremium) {
      return {
        hasAccess: true,
        isPremium: true,
        isInTrial: false,
        daysRemaining: null,
        trialEndsAt: null,
        reason: 'premium',
      };
    }

    let profileRow = null;
    let profileError = null;

    // Preferred path: include explicit trial bypass flag.
    const { data, error } = await supabase
      .from('profiles')
      .select(`created_at, ${TRIAL_BYPASS_COLUMN}`)
      .eq('id', userId)
      .single();

    profileRow = data;
    profileError = error;

    // Backward compatibility for environments without the bypass column yet.
    if (MISSING_COLUMN_ERROR_CODES.has(profileError?.code)) {
      const fallbackResult = await supabase
        .from('profiles')
        .select('created_at')
        .eq('id', userId)
        .single();
      profileRow = fallbackResult.data;
      profileError = fallbackResult.error;
    }

    if (profileError) throw profileError;

    if (profileRow?.[TRIAL_BYPASS_COLUMN]) {
      return {
        hasAccess: true,
        isPremium: false,
        isInTrial: false,
        daysRemaining: null,
        trialEndsAt: null,
        reason: 'bypass',
      };
    }

    const createdAt = profileRow?.created_at ? new Date(profileRow.created_at) : new Date();
    const trialEndsAt = new Date(createdAt.getTime() + (TRIAL_DAYS * ONE_DAY_MS));
    const now = new Date();
    const msRemaining = trialEndsAt.getTime() - now.getTime();
    const isInTrial = msRemaining > 0;

    return {
      hasAccess: isInTrial,
      isPremium: false,
      isInTrial,
      daysRemaining: isInTrial ? Math.ceil(msRemaining / ONE_DAY_MS) : 0,
      trialEndsAt: trialEndsAt.toISOString(),
      reason: isInTrial ? 'trial' : 'expired',
    };
  } catch (error) {
    console.error('Error getting trial access status:', error);
    return {
      hasAccess: false,
      isPremium: false,
      isInTrial: false,
      daysRemaining: 0,
      trialEndsAt: null,
      reason: 'error',
    };
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
export const checkMomentsLimit = async (userId, partnershipId = null) => {
  try {
    const limits = await getFeatureLimits(userId);

    let activePartnershipId = partnershipId;
    if (!activePartnershipId) {
      const { data: partnerships, error: partnershipError } = await supabase
        .from('partnerships')
        .select('id')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      if (partnershipError) throw partnershipError;
      activePartnershipId = partnerships?.[0]?.id || null;
    }

    if (!activePartnershipId) {
      return { allowed: true, current: 0, limit: limits.momentsLimit };
    }

    const { count } = await supabase
      .from('moments')
      .select('*', { count: 'exact', head: true })
      .eq('partnership_id', activePartnershipId);

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
  getTrialAccessStatus,
  getFeatureLimits,
  checkFeatureAccess,
  checkMomentsLimit,
  getAvailablePulsePatterns,
  formatPremiumExpiry,
  TRIAL_DAYS,
  TRIAL_GATED_FEATURES,
  TRIAL_BYPASS_COLUMN,
  FEATURE_LIMITS,
  PREMIUM_FEATURES,
};
