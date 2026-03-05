import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../config/supabase';
import { log, error } from '../utils/logger';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const notificationService = {
  // Register for push notifications and get token
  async registerForPushNotifications(userId) {
    log('[NOTIFICATIONS] Registering...');
    
    if (!Device.isDevice) {
      log('[NOTIFICATIONS] Must use physical device');
      return null;
    }

    try {
      // Check existing permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      // Request permissions if not granted
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        log('[NOTIFICATIONS] Permission not granted');
        return null;
      }

      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        Constants?.easConfig?.projectId;

      if (!projectId) {
        log('[NOTIFICATIONS] Missing Expo projectId in app config');
        return null;
      }

      // Get push token
      const token = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      log('[NOTIFICATIONS] Token:', token.data);

      // Save token to database
      await this.savePushToken(userId, token.data);

      // Configure for Android
      if (Platform.OS === 'android') {
        Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6C63FF',
        });
      }

      return token.data;
    } catch (err) {
      error('[NOTIFICATIONS] Registration error:', err);
      return null;
    }
  },

  // Save push token to database
  async savePushToken(userId, token) {
    log('[NOTIFICATIONS] Saving token for user:', userId);
    
    const { error: saveErr } = await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', userId);

    if (saveErr) {
      error('[NOTIFICATIONS] Save token error:', saveErr);
    }
  },

  // Send notification to partner
  async sendToPartner(partnerUserId, title, body, data = {}) {
    log('[NOTIFICATIONS] Sending to partner:', partnerUserId);

    try {
      // Get partner's push token
      const { data: profile, error: fetchErr } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', partnerUserId)
        .single();

      if (fetchErr || !profile?.push_token) {
        log('[NOTIFICATIONS] No push token for partner');
        return;
      }

      // Send via Expo's push service
      const message = {
        to: profile.push_token,
        sound: 'default',
        title,
        body,
        data,
      };

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      log('[NOTIFICATIONS] Sent successfully');
    } catch (err) {
      error('[NOTIFICATIONS] Send error:', err);
    }
  },

  // Predefined notification types
  async notifyPartnerSessionComplete(partnerUserId, userName) {
    await this.sendToPartner(
      partnerUserId,
      '💕 Session Complete!',
      `${userName} completed today's session. See what they said!`,
      { screen: 'session' }
    );
  },

  async notifyPartnerNewMoment(partnerUserId, userName) {
    await this.sendToPartner(
      partnerUserId,
      '📸 New Moment!',
      `${userName} shared a new photo with you!`,
      { screen: 'moments' }
    );
  },

  async notifyPartnerNewPlan(partnerUserId, userName, planTitle) {
    await this.sendToPartner(
      partnerUserId,
      '📅 New Plan!',
      `${userName} wants to plan: ${planTitle}`,
      { screen: 'plans' }
    );
  },

  async notifyPartnerPlanConfirmed(partnerUserId, userName, planTitle) {
    await this.sendToPartner(
      partnerUserId,
      '✅ Plan Confirmed!',
      `${userName} confirmed: ${planTitle}`,
      { screen: 'plans' }
    );
  },

  async notifyPartnerPulse(partnerUserId, userName) {
    await this.sendToPartner(
      partnerUserId,
      '💓 Pulse!',
      `${userName} is thinking of you!`,
      { screen: 'pulse' }
    );
  },

  // Add notification listeners
  addNotificationListeners(onNotification, onNotificationResponse) {
    const notificationListener = Notifications.addNotificationReceivedListener(
      onNotification
    );

    const responseListener = Notifications.addNotificationResponseReceivedListener(
      onNotificationResponse
    );

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  },

  // Schedule local notification
  async scheduleLocalNotification(title, body, seconds = 1) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
      },
      trigger: { seconds },
    });
  },
};
