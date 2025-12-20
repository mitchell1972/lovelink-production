import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, StatusBar, Text } from 'react-native';
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
} from './src/screens';
import { isSupabaseConfigured } from './src/config/supabase';

// Main app content with navigation
const AppContent = () => {
  const { user, partnership, loading, isAuthenticated, isPaired } = useAuth();
  const [authScreen, setAuthScreen] = useState('signup'); // 'signup' or 'login'
  const [currentScreen, setCurrentScreen] = useState('home');

  // Show loading screen while checking auth
  if (loading) {
    return <LoadingScreen message="Loading LoveLink..." />;
  }

  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    return (
      <GradientBackground>
        <Header />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.configCard}>
            <Text style={styles.configTitle}>⚙️ Setup Required</Text>
            <Text style={styles.configText}>
              Please configure your Supabase credentials in:{'\n\n'}
              src/config/supabase.js
              {'\n\n'}
              1. Create a project at supabase.com{'\n'}
              2. Run the SQL schema (supabase-schema.sql){'\n'}
              3. Copy your project URL and anon key{'\n'}
              4. Paste them in the config file
            </Text>
          </View>
        </ScrollView>
      </GradientBackground>
    );
  }

  // Not authenticated - show login/signup
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
            <SignUpScreen onSwitchToLogin={() => setAuthScreen('login')} />
          ) : (
            <LoginScreen onSwitchToSignUp={() => setAuthScreen('signup')} />
          )}
        </ScrollView>
      </GradientBackground>
    );
  }

  // Authenticated but not paired - show link partner screen
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

  // Fully authenticated and paired - show main app
  const renderScreen = () => {
    switch (currentScreen) {
      case 'session':
        return <SessionScreen onNavigate={setCurrentScreen} />;
      case 'moments':
        return <MomentsScreen onNavigate={setCurrentScreen} />;
      case 'pulse':
        return <PulseScreen onNavigate={setCurrentScreen} />;
      case 'plan':
        return <PlanScreen onNavigate={setCurrentScreen} />;
      case 'premium':
        return <PremiumScreen onNavigate={setCurrentScreen} />;
      default:
        return <HomeScreen onNavigate={setCurrentScreen} />;
    }
  };

  return (
    <GradientBackground>
      <StatusBar barStyle="light-content" />
      <Header />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {renderScreen()}
      </ScrollView>
    </GradientBackground>
  );
};

// Root App with providers
const App = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  configCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    width: '90%',
    padding: 20,
  },
  configTitle: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 15,
    textAlign: 'center',
  },
  configText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textLight,
  },
});

export default App;
