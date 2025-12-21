// src/screens/PremiumScreen.js
// Premium subscription screen with actual status checking

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { 
  getPremiumStatus, 
  PREMIUM_FEATURES,
  formatPremiumExpiry,
  togglePremium,
} from '../services/premiumService';

export default function PremiumScreen({ onNavigate }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [premiumStatus, setPremiumStatus] = useState(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    loadPremiumStatus();
  }, []);

  const loadPremiumStatus = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const status = await getPremiumStatus(user.id);
      setPremiumStatus(status);
    } catch (error) {
      console.error('Error loading premium status:', error);
      // If columns don't exist yet, show as free user
      setPremiumStatus({ isPremium: false, plan: null, since: null, expires: null });
    }
    setLoading(false);
  };

  const handleSubscribe = () => {
    Alert.alert(
      '🧪 Testing Mode',
      'Premium payments require Apple/Google developer accounts.\n\nFor testing, would you like to enable Premium now?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Enable Monthly ($4.99)', 
          onPress: () => enableTestPremium('monthly')
        },
        { 
          text: 'Enable Yearly ($39.99)', 
          onPress: () => enableTestPremium('yearly')
        },
      ]
    );
  };

  const enableTestPremium = async (plan) => {
    setToggling(true);
    try {
      const result = await togglePremium(user.id, true, plan);
      if (result.success) {
        await loadPremiumStatus();
        Alert.alert('✅ Premium Enabled!', `You now have Premium (${plan}) for testing.\n\nAll features are now unlocked!`);
      } else {
        Alert.alert(
          '⚠️ Database Setup Required',
          'Please run the database-premium.sql script in your Supabase SQL Editor first.\n\nThis adds the premium columns and functions.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to enable premium. Make sure to run database-premium.sql first.');
    }
    setToggling(false);
  };

  const handleCancelPremium = () => {
    Alert.alert(
      'Cancel Premium',
      'Are you sure you want to cancel your Premium subscription?',
      [
        { text: 'Keep Premium', style: 'cancel' },
        { 
          text: 'Cancel Subscription', 
          style: 'destructive',
          onPress: async () => {
            setToggling(true);
            try {
              await togglePremium(user.id, false);
              await loadPremiumStatus();
              Alert.alert('Premium Cancelled', 'You are now on the Free plan.');
            } catch (error) {
              Alert.alert('Error', 'Failed to cancel premium.');
            }
            setToggling(false);
          }
        },
      ]
    );
  };

  const handleBack = () => {
    onNavigate('home');
  };

  const renderFeatureCard = (feature) => {
    const isPremium = premiumStatus?.isPremium;
    
    return (
      <View key={feature.id} style={styles.featureCard}>
        <Text style={styles.featureIcon}>{feature.icon}</Text>
        <View style={styles.featureContent}>
          <Text style={styles.featureTitle}>{feature.title}</Text>
          <Text style={styles.featureDescription}>{feature.description}</Text>
          <View style={styles.featureComparison}>
            <Text style={[
              styles.featureValue,
              !isPremium && styles.featureValueActive
            ]}>
              Free: {feature.freeValue}
            </Text>
            <Text style={[
              styles.featureValue,
              styles.featureValuePremium,
              isPremium && styles.featureValueActive
            ]}>
              Premium: {feature.premiumValue}
            </Text>
          </View>
        </View>
        {isPremium && (
          <Text style={styles.unlockedBadge}>✓</Text>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6C63FF" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const isPremium = premiumStatus?.isPremium;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Premium Status Banner */}
      {isPremium ? (
        <View style={styles.premiumBanner}>
          <Text style={styles.premiumBannerIcon}>💎</Text>
          <Text style={styles.premiumBannerTitle}>Premium Active</Text>
          <Text style={styles.premiumBannerPlan}>
            {premiumStatus.plan === 'yearly' ? 'Yearly Plan' : 'Monthly Plan'}
          </Text>
          <Text style={styles.premiumBannerExpiry}>
            {formatPremiumExpiry(premiumStatus.expires)}
          </Text>
        </View>
      ) : (
        <View style={styles.freeBanner}>
          <Text style={styles.freeBannerIcon}>🆓</Text>
          <Text style={styles.freeBannerTitle}>Free Plan</Text>
          <Text style={styles.freeBannerSubtitle}>
            Upgrade to unlock all features
          </Text>
        </View>
      )}

      {/* Features List */}
      <View style={styles.featuresContainer}>
        {PREMIUM_FEATURES.map((feature) => renderFeatureCard(feature))}
      </View>

      {/* Pricing */}
      {!isPremium && (
        <View style={styles.pricingCard}>
          <Text style={styles.pricingTitle}>LoveLink Premium</Text>
          <Text style={styles.pricingPrice}>$4.99/month</Text>
          <Text style={styles.pricingAnnual}>or $39.99/year (save 33%)</Text>
        </View>
      )}

      {/* Action Button */}
      {isPremium ? (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleCancelPremium}
          disabled={toggling}
        >
          {toggling ? (
            <ActivityIndicator color="#666" />
          ) : (
            <Text style={styles.cancelButtonText}>Manage Subscription</Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.subscribeButton}
          onPress={handleSubscribe}
          disabled={toggling}
        >
          {toggling ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.subscribeButtonIcon}>💎</Text>
              <Text style={styles.subscribeButtonText}>Subscribe to Premium</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      <Text style={styles.disclaimer}>
        {isPremium 
          ? 'Thank you for supporting LoveLink!'
          : 'Cancel anytime. Subscription auto-renews.'}
      </Text>

      {/* Testing Info */}
      <View style={styles.testingInfo}>
        <Text style={styles.testingInfoTitle}>🧪 Testing Mode</Text>
        <Text style={styles.testingInfoText}>
          Real payments require App Store setup. Use the button above to test Premium features.
        </Text>
      </View>

      {/* Back Button */}
      <TouchableOpacity style={styles.backButton} onPress={handleBack}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>
      
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    color: '#fff',
    marginTop: 10,
    fontSize: 16,
  },
  
  // Premium Status Banners
  premiumBanner: {
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  premiumBannerIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  premiumBannerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFD700',
  },
  premiumBannerPlan: {
    fontSize: 16,
    color: '#fff',
    marginTop: 4,
  },
  premiumBannerExpiry: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  
  freeBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  freeBannerIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  freeBannerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  freeBannerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },

  // Features
  featuresContainer: {
    marginBottom: 20,
  },
  featureCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  featureDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  featureComparison: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 12,
  },
  featureValue: {
    fontSize: 11,
    color: '#999',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  featureValuePremium: {
    backgroundColor: '#f0e6ff',
    color: '#7c3aed',
  },
  featureValueActive: {
    fontWeight: '600',
    borderWidth: 1,
    borderColor: '#7c3aed',
  },
  unlockedBadge: {
    fontSize: 20,
    color: '#22c55e',
    fontWeight: 'bold',
  },

  // Pricing
  pricingCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  pricingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  pricingPrice: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#6C63FF',
    marginTop: 8,
  },
  pricingAnnual: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },

  // Buttons
  subscribeButton: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  subscribeButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  subscribeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  disclaimer: {
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    marginBottom: 20,
  },

  // Testing Info
  testingInfo: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  testingInfoTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 4,
  },
  testingInfoText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    lineHeight: 18,
  },

  // Back Button
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
});
