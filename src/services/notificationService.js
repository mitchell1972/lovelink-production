import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../config/supabase';

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
    console.log('[NOTIFICATIONS] Registering...');
    
    if (!Device.isDevice) {
      console.log('[NOTIFICATIONS] Must use physical device');
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
        console.log('[NOTIFICATIONS] Permission not granted');
        return null;
      }

      // Get push token
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: 'your-project-id', // Replace with your Expo project ID from app.json
      });

      console.log('[NOTIFICATIONS] Token:', token.data);

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
    } catch (error) {
      console.error('[NOTIFICATIONS] Registration error:', error);
      return null;
    }
  },

  // Save push token to database
  async savePushToken(userId, token) {
    console.log('[NOTIFICATIONS] Saving token for user:', userId);
    
    const { error } = await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', userId);

    if (error) {
      console.error('[NOTIFICATIONS] Save token error:', error);
    }
  },

  // Send notification to partner
  async sendToPartner(partnerUserId, title, body, data = {}) {
    console.log('[NOTIFICATIONS] Sending to partner:', partnerUserId);

    try {
      // Get partner's push token
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', partnerUserId)
        .single();

      if (error || !profile?.push_token) {
        console.log('[NOTIFICATIONS] No push token for partner');
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

      console.log('[NOTIFICATIONS] Sent successfully');
    } catch (error) {
      console.error('[NOTIFICATIONS] Send error:', error);
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
