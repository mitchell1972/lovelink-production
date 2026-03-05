import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, StatusBar, Text, Alert, Vibration } from 'react-native';
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
import { getTrialAccessStatus, TRIAL_GATED_FEATURES } from './src/services/premiumService';
import { inAppAlertsService } from './src/services/inAppAlertsService';

// Screens that handle their own scrolling (have FlatList or ScrollView)
const SELF_SCROLLING_SCREENS = ['moments', 'home', 'pulse', 'premium', 'settings', 'session', 'plan'];
const FEATURE_SCREEN_IDS = ['session', 'moments', 'pulse', 'plan'];
const EMPTY_UNREAD = {
  session: false,
  moments: false,
  pulse: false,
  plan: false,
};

// Main app content with navigation
const AppContent = () => {
  const { user, partnership, loading, isAuthenticated, isPaired, refreshPartnership } = useAuth();
  const [authScreen, setAuthScreen] = useState('signup');
  const [currentScreen, setCurrentScreen] = useState('home');
  const [unreadIndicators, setUnreadIndicators] = useState(EMPTY_UNREAD);

  const handleNavigate = useCallback(
    async (screen) => {
      if (FEATURE_SCREEN_IDS.includes(screen) && user?.id) {
        const latestPartnership = await refreshPartnership();
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
    [refreshPartnership, user?.id]
  );

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
      if (!TRIAL_GATED_FEATURES.includes(currentScreen)) return;

      const status = await getTrialAccessStatus(user.id);
      if (!isActive) return;

      if (!status.hasAccess) {
        Alert.alert(
          'Subscription Required',
          'Your 7-day free trial has ended. Subscribe to keep using Daily Session, Moments, Pulse, and Plans.',
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
        return <PremiumScreen onNavigate={handleNavigate} />;
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
