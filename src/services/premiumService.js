// src/services/premiumService.js
// Premium subscription management service

import { supabase } from '../config/supabase';
import { error } from '../utils/logger';

export const TRIAL_DAYS = 7;
export const SUBSCRIPTION_GATED_FEATURES = ['session', 'moments', 'pulse', 'plan'];
// Backward-compatible name for older callers.
export const TRIAL_GATED_FEATURES = SUBSCRIPTION_GATED_FEATURES;
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

/**
 * Check if premium fields represent a valid (non-expired) subscription
 */
const isPremiumValid = (profile) =>
  profile.is_premium &&
  !profile.premium_granted_by &&
  Boolean(profile.premium_expires) &&
  new Date(profile.premium_expires) > new Date();

/**
 * Resolve the partner id only from an active partnership.
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
      .select('is_premium, premium_since, premium_expires, premium_plan, premium_granted_by')
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

    // A cached profile.partner_id can outlive a partnership. Only the active
    // partnership relation is authoritative for shared subscription access.
    const partnerId = await getPartnerIdFromActivePartnership(userId);
    if (partnerId) {
      const { data: partner, error: partnerError } = await supabase
        .from('profiles')
        .select('is_premium, premium_since, premium_expires, premium_plan, premium_granted_by, name')
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
  } catch (err) {
    error('Error getting premium status:', err);
    return { isPremium: false, source: null, plan: null, since: null, expires: null };
  }
};

/**
 * Determine whether the user can access the core app.
 *
 * A free trial is an introductory period of an auto-renewing store
 * subscription—not an account-age entitlement. A user must first start a
 * subscription in the App Store or Google Play. During its store-provided
 * seven-day trial the subscription is active, so it grants access before a
 * charge is made.
 */
export const getSubscriptionAccessStatus = async (userId) => {
  try {
    const premiumStatus = await getPremiumStatus(userId);

    if (premiumStatus.isPremium) {
      return {
        hasAccess: true,
        isPremium: true,
        isInTrial: false,
        daysRemaining: null,
        trialEndsAt: null,
        reason: 'subscription',
      };
    }

    return {
      hasAccess: false,
      isPremium: false,
      isInTrial: false,
      daysRemaining: 0,
      trialEndsAt: null,
      reason: 'subscription_required',
    };
  } catch (err) {
    error('Error getting subscription access status:', err);
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

// Backward-compatible export while callers migrate to the clearer name.
export const getTrialAccessStatus = getSubscriptionAccessStatus;

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
  } catch (err) {
    error('Error checking moments limit:', err);
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
  getSubscriptionAccessStatus,
  getTrialAccessStatus,
  getFeatureLimits,
  checkFeatureAccess,
  checkMomentsLimit,
  getAvailablePulsePatterns,
  formatPremiumExpiry,
  TRIAL_DAYS,
  SUBSCRIPTION_GATED_FEATURES,
  TRIAL_GATED_FEATURES,
  TRIAL_BYPASS_COLUMN,
  FEATURE_LIMITS,
  PREMIUM_FEATURES,
};
