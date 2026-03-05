import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../config/supabase';
import { log } from '../utils/logger';

const FEATURE_KEYS = ['session', 'moments', 'pulse', 'plan'];

const unreadStorageKey = (userId) => `lovelink:inapp-unread:${userId}`;
const vibrationStorageKey = (userId) => `lovelink:inapp-vibration:${userId}`;

const defaultUnread = () => ({
  session: false,
  moments: false,
  pulse: false,
  plan: false,
});

const normalizeUnread = (value) => {
  const next = defaultUnread();
  if (!value || typeof value !== 'object') {
    return next;
  }

  FEATURE_KEYS.forEach((key) => {
    next[key] = !!value[key];
  });

  return next;
};

export const inAppAlertsService = {
  async getUnreadState(userId) {
    if (!userId) {
      return defaultUnread();
    }

    try {
      const raw = await AsyncStorage.getItem(unreadStorageKey(userId));
      if (!raw) {
        return defaultUnread();
      }
      return normalizeUnread(JSON.parse(raw));
    } catch (err) {
      log('[IN-APP ALERTS] getUnreadState error:', err?.message || err);
      return defaultUnread();
    }
  },

  async setUnreadState(userId, unreadState) {
    if (!userId) {
      return;
    }
    const normalized = normalizeUnread(unreadState);
    await AsyncStorage.setItem(unreadStorageKey(userId), JSON.stringify(normalized));
  },

  async markUnread(userId, feature) {
    if (!FEATURE_KEYS.includes(feature)) {
      return defaultUnread();
    }
    const current = await this.getUnreadState(userId);
    const next = { ...current, [feature]: true };
    await this.setUnreadState(userId, next);
    return next;
  },

  async markSeen(userId, feature) {
    if (!FEATURE_KEYS.includes(feature)) {
      return defaultUnread();
    }
    const current = await this.getUnreadState(userId);
    const next = { ...current, [feature]: false };
    await this.setUnreadState(userId, next);
    return next;
  },

  async getVibrationEnabled(userId) {
    if (!userId) {
      return true;
    }

    try {
      const raw = await AsyncStorage.getItem(vibrationStorageKey(userId));
      if (raw === null) {
        return true;
      }
      return raw === 'true';
    } catch (err) {
      log('[IN-APP ALERTS] getVibrationEnabled error:', err?.message || err);
      return true;
    }
  },

  async setVibrationEnabled(userId, enabled) {
    if (!userId) {
      return;
    }
    await AsyncStorage.setItem(vibrationStorageKey(userId), enabled ? 'true' : 'false');
  },

  subscribeToIncoming({ partnershipId, userId, onIncoming }) {
    if (!partnershipId || !userId || typeof onIncoming !== 'function') {
      return { unsubscribe: () => {} };
    }

    const handleIncoming = (feature, senderField) => (payload) => {
      const senderId = payload?.new?.[senderField];
      if (!senderId || senderId === userId) {
        return;
      }
      onIncoming(feature, payload);
    };

    return supabase
      .channel(`in-app-alerts:${partnershipId}:${userId}:${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sessions',
          filter: `partnership_id=eq.${partnershipId}`,
        },
        handleIncoming('session', 'user_id')
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'moments',
          filter: `partnership_id=eq.${partnershipId}`,
        },
        handleIncoming('moments', 'user_id')
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pulses',
          filter: `partnership_id=eq.${partnershipId}`,
        },
        handleIncoming('pulse', 'sender_id')
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'plans',
          filter: `partnership_id=eq.${partnershipId}`,
        },
        handleIncoming('plan', 'created_by')
      )
      .subscribe();
  },
};

export const IN_APP_ALERT_FEATURES = FEATURE_KEYS;
