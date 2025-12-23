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
  SettingsScreen,
} from './src/screens';
import { isSupabaseConfigured } from './src/config/supabase';

// Screens that handle their own scrolling (have FlatList or ScrollView)
const SELF_SCROLLING_SCREENS = ['moments', 'home', 'pulse', 'premium', 'settings', 'session', 'plan'];

// Main app content with navigation
const AppContent = () => {
  const { user, partnership, loading, isAuthenticated, isPaired } = useAuth();
  const [authScreen, setAuthScreen] = useState('signup');
  const [currentScreen, setCurrentScreen] = useState('home');

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
        <ScrollView contentContainerStyle={styles.scrollContent}>
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
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <LinkPartnerScreen />
        </ScrollView>
      </GradientBackground>
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'home':
        return <HomeScreen onNavigate={setCurrentScreen} />;
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
      case 'settings':
        return <SettingsScreen onNavigate={setCurrentScreen} />;
      default:
        return <HomeScreen onNavigate={setCurrentScreen} />;
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
        <ScrollView contentContainerStyle={styles.scrollContent}>
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
