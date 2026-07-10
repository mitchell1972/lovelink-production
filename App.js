import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, StatusBar, Text, Alert, Vibration, AppState, Platform } from 'react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import {
  GradientBackground,
  Header,
  LoadingScreen,
  colors,
} from './src/components/ui';
import {
  SignUpScreen,
  LoginScreen,
  LinkPartnerScreen,
  HomeScreen,
  SessionScreen,
  MomentsScreen,
  PulseScreen,
  PlanScreen,
  PremiumScreen,
  SettingsScreen,
} from './src/screens';
import { isSupabaseConfigured } from './src/config/supabase';
import { getSubscriptionAccessStatus, SUBSCRIPTION_GATED_FEATURES } from './src/services/premiumService';
import { inAppAlertsService } from './src/services/inAppAlertsService';
import { iapService } from './src/services/iapService';

// Screens that handle their own scrolling (have FlatList or ScrollView)
const SELF_SCROLLING_SCREENS = ['moments', 'home', 'pulse', 'premium', 'settings', 'session', 'plan'];
const FEATURE_SCREEN_IDS = ['session', 'moments', 'pulse', 'plan'];
const isNativeStorePlatform = ['ios', 'android'].includes(Platform.OS);
const EMPTY_UNREAD = {
  session: false,
  moments: false,
  pulse: false,
  plan: false,
};

// Main app content with navigation
const AppContent = () => {
  const { user, partnership, loading, isAuthenticated, isPaired, refreshPartnership, verifyPartnership } = useAuth();
  const [authScreen, setAuthScreen] = useState('signup');
  const [currentScreen, setCurrentScreen] = useState('home');
  const [unreadIndicators, setUnreadIndicators] = useState(EMPTY_UNREAD);
  const [subscriptionAccess, setSubscriptionAccess] = useState(null);

  const handleNavigate = useCallback(
    async (screen) => {
      if (FEATURE_SCREEN_IDS.includes(screen) && user?.id) {
        if (!subscriptionAccess?.hasAccess) {
          Alert.alert(
            'Start your free trial',
            'Start a subscription to unlock LoveLink. You will not be charged for the first 7 days.',
            [{ text: 'Choose a plan', onPress: () => setCurrentScreen('premium') }]
          );
          return;
        }
        // Verify code validity before entering any feature screen.
        const latestPartnership = await verifyPartnership();
        if (!latestPartnership?.id) {
          Alert.alert(
            'Partner Changed',
            'Your previous connection is no longer active. Enter a partner code to reconnect.'
          );
          return;
        }
      }

      setCurrentScreen(screen);

      if (FEATURE_SCREEN_IDS.includes(screen) && user?.id) {
        setUnreadIndicators((prev) => ({ ...prev, [screen]: false }));
        inAppAlertsService.markSeen(user.id, screen).catch((error) => {
          console.log('[APP] markSeen failed:', error?.message || error);
        });
      }
    },
    [verifyPartnership, user?.id, subscriptionAccess?.hasAccess]
  );

  useEffect(() => {
    let isActive = true;

    const loadSubscriptionAccess = async () => {
      if (!user?.id) {
        if (isActive) setSubscriptionAccess(null);
        return;
      }

      setSubscriptionAccess(null);
      if (isNativeStorePlatform) {
        await iapService.syncSubscriptionEntitlement(user.id);
      }
      const status = await getSubscriptionAccessStatus(user.id);
      if (!isActive) return;

      setSubscriptionAccess(status);
      // Every authenticated user must subscribe before partner linking or use.
      if (!status.hasAccess) setCurrentScreen('premium');
    };

    loadSubscriptionAccess();
    return () => { isActive = false; };
  }, [user?.id, isPaired]);

  // Reconcile cancellations, trial expiry, renewals, refunds, and revocations
  // whenever either native app returns to the foreground.
  useEffect(() => {
    if (!isNativeStorePlatform || !user?.id) return undefined;

    let refreshing = false;
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active' || refreshing) return;

      refreshing = true;
      try {
        await iapService.syncSubscriptionEntitlement(user.id);
        const status = await getSubscriptionAccessStatus(user.id);
        setSubscriptionAccess(status);
        if (!status.hasAccess) setCurrentScreen('premium');
      } finally {
        refreshing = false;
      }
    });

    return () => subscription.remove();
  }, [user?.id]);

  // Expose navigation for automated testing (dev only)
  useEffect(() => {
    if (__DEV__) {
      global.__testNavigate = (screen) => handleNavigate(screen);
      global.__testGetScreen = () => currentScreen;
      return () => { delete global.__testNavigate; delete global.__testGetScreen; };
    }
  }, [currentScreen, handleNavigate]);

  useEffect(() => {
    let isActive = true;

    const enforceTrialGate = async () => {
      if (!user?.id || !isPaired) return;
      if (!SUBSCRIPTION_GATED_FEATURES.includes(currentScreen)) return;

      if (isNativeStorePlatform) {
        await iapService.syncSubscriptionEntitlement(user.id);
      }
      const status = await getSubscriptionAccessStatus(user.id);
      if (!isActive) return;

      setSubscriptionAccess(status);

      if (!status.hasAccess) {
        Alert.alert(
          'Subscription Required',
          'Start a subscription to unlock LoveLink. You will not be charged for the first 7 days.',
          [{ text: 'OK', onPress: () => setCurrentScreen('premium') }]
        );
      }
    };

    enforceTrialGate();

    return () => {
      isActive = false;
    };
  }, [currentScreen, user?.id, isPaired]);

  useEffect(() => {
    let isMounted = true;

    const loadAlertState = async () => {
      if (!user?.id) {
        if (isMounted) {
          setUnreadIndicators(EMPTY_UNREAD);
        }
        return;
      }

      const unread = await inAppAlertsService.getUnreadState(user.id);

      if (!isMounted) {
        return;
      }

      setUnreadIndicators(unread);
    };

    loadAlertState();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !isPaired || !user?.id || !partnership?.id) {
      return undefined;
    }

    const subscription = inAppAlertsService.subscribeToIncoming({
      partnershipId: partnership.id,
      userId: user.id,
      onIncoming: async (feature) => {
        setUnreadIndicators((prev) => ({ ...prev, [feature]: true }));
        await inAppAlertsService.markUnread(user.id, feature);

        const shouldVibrate = await inAppAlertsService.getVibrationEnabled(user.id);
        if (shouldVibrate) {
          Vibration.vibrate(220);
        }
      },
    });

    return () => subscription?.unsubscribe();
  }, [isAuthenticated, isPaired, user?.id, partnership?.id]);

  if (loading) {
    return <LoadingScreen message="Loading LoveLink..." />;
  }

  if (!isSupabaseConfigured()) {
    return (
      <GradientBackground>
        <Header />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠️ Configuration Required</Text>
            <Text style={styles.errorText}>
              Please configure your Supabase credentials in src/config/supabase.js
            </Text>
          </View>
        </ScrollView>
      </GradientBackground>
    );
  }

  if (!isAuthenticated) {
    return (
      <GradientBackground>
        <StatusBar barStyle="light-content" />
        <Header />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {authScreen === 'signup' ? (
            <SignUpScreen onSwitchToLogin={() => setAuthScreen('login')} onNavigate={setAuthScreen} />
          ) : (
            <LoginScreen onNavigate={setAuthScreen} />
          )}
        </ScrollView>
      </GradientBackground>
    );
  }

  if (subscriptionAccess === null) {
    return <LoadingScreen message="Checking subscription..." />;
  }

  if (!subscriptionAccess.hasAccess) {
    return (
      <GradientBackground>
        <StatusBar barStyle="light-content" />
        <Header />
        <View style={styles.screenContainer}>
          <PremiumScreen
            subscriptionRequired
            onNavigate={handleNavigate}
            onSubscriptionActivated={(status) => {
              setSubscriptionAccess(status);
              setCurrentScreen('home');
            }}
          />
        </View>
      </GradientBackground>
    );
  }

  if (!isPaired) {
    return (
      <GradientBackground>
        <StatusBar barStyle="light-content" />
        <Header />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <LinkPartnerScreen />
        </ScrollView>
      </GradientBackground>
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'home':
        return <HomeScreen onNavigate={handleNavigate} unreadIndicators={unreadIndicators} />;
      case 'session':
        return <SessionScreen onNavigate={handleNavigate} />;
      case 'moments':
        return <MomentsScreen onNavigate={handleNavigate} />;
      case 'pulse':
        return <PulseScreen onNavigate={handleNavigate} />;
      case 'plan':
        return <PlanScreen onNavigate={handleNavigate} />;
      case 'premium':
        return <PremiumScreen
          onNavigate={handleNavigate}
          onSubscriptionActivated={(status) => {
            setSubscriptionAccess(status);
            setCurrentScreen('home');
          }}
        />;
      case 'settings':
        return <SettingsScreen onNavigate={handleNavigate} />;
      default:
        return <HomeScreen onNavigate={handleNavigate} unreadIndicators={unreadIndicators} />;
    }
  };

  const isSelfScrolling = SELF_SCROLLING_SCREENS.includes(currentScreen);

  return (
    <GradientBackground>
      <StatusBar barStyle="light-content" />
      <Header />
      {isSelfScrolling ? (
        <View style={styles.screenContainer}>
          {renderScreen()}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {renderScreen()}
        </ScrollView>
      )}
    </GradientBackground>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  screenContainer: {
    flex: 1,
  },
  errorCard: {
    backgroundColor: 'white',
    margin: 20,
    padding: 20,
    borderRadius: 15,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});
