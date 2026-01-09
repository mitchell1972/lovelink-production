// src/screens/PremiumScreen.js
// Premium subscription screen with REAL Apple In-App Purchases

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { 
  getPremiumStatus, 
  PREMIUM_FEATURES,
  formatPremiumExpiry,
} from '../services/premiumService';
import {
  iapService,
  PRODUCT_IDS,
  initializeIAP,
  getProducts,
  purchaseSubscription,
  restorePurchases,
  savePurchaseToDatabase,
} from '../services/iapService';

// Helper: normalize iOS product shapes
const normalizeProducts = (list) => (Array.isArray(list) ? list.filter(Boolean) : (list ? [list] : []));

const getPlanTypeForProductId = (productId) => {
  if (productId === PRODUCT_IDS.YEARLY) return 'yearly';
  if (productId === PRODUCT_IDS.MONTHLY) return 'monthly';
  // If IDs are misconfigured, fall back on heuristic.
  return productId?.toLowerCase().includes('year') ? 'yearly' : 'monthly';
};

export default function PremiumScreen({ onNavigate }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [premiumStatus, setPremiumStatus] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [products, setProducts] = useState([]);
  const [iapUnavailableReason, setIapUnavailableReason] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('monthly');
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    initializeScreen();
    
    // Cleanup on unmount
    return () => {
      iapService.removeListeners();
    };
  }, []);

  const initializeScreen = async () => {
    setLoading(true);
    try {
      // Load premium status from database
      if (user) {
        const status = await getPremiumStatus(user.id);
        setPremiumStatus(status);
      }

      // Initialize IAP and fetch products
      await initializeIAP();
      const availableProductsRaw = await getProducts();
      const availableProducts = normalizeProducts(availableProductsRaw);
      setProducts(availableProducts);

      // If no products are returned, still allow the user to attempt a purchase.
      // Apple may return 0 products while subscriptions are "Waiting for Review".
      if (!availableProducts || availableProducts.length === 0) {
        const msg = Platform.OS === 'ios'
          ? 'Store did not return subscription products yet. You can still try subscribing; if Apple blocks it, you will see the real StoreKit error. (Common causes: subscriptions still "Waiting for Review", Paid Apps agreement not active, or testing without a Sandbox tester.)'
          : 'Store did not return subscription products yet. Please try again later.';
        setIapUnavailableReason(msg);
      } else {
        setIapUnavailableReason(null);
        // Ensure selected plan matches an available product (avoid "Product not found" after selecting)
        const hasMonthly = availableProducts.some(p => p.productId === PRODUCT_IDS.MONTHLY);
        const hasYearly = availableProducts.some(p => p.productId === PRODUCT_IDS.YEARLY);
        if (selectedPlan === 'monthly' && !hasMonthly && hasYearly) setSelectedPlan('yearly');
        if (selectedPlan === 'yearly' && !hasYearly && hasMonthly) setSelectedPlan('monthly');
      }
      
      console.log('Products loaded:', availableProducts);
    } catch (error) {
      console.error('Error initializing premium screen:', error);
      setPremiumStatus({ isPremium: false, plan: null, since: null, expires: null });

      const msg = Platform.OS === 'ios'
        ? 'Subscriptions are temporarily unavailable (store connection error). Please try again later.'
        : 'Subscriptions are temporarily unavailable (store connection error). Please try again later.';
      setIapUnavailableReason(msg);
    }
    setLoading(false);
  };

  const handleSubscribe = async () => {
    if (purchasing) return;

    // Prefer the product returned by Apple, but fall back to our known SKU.
    // This keeps the button working when Apple returns 0 products.
    const chosen = iapService.getProductForPlan(selectedPlan);
    const productId = chosen?.productId || (selectedPlan === 'yearly' ? PRODUCT_IDS.YEARLY : PRODUCT_IDS.MONTHLY);

    setPurchasing(true);

    try {
      // This triggers the Apple payment sheet
      const result = await purchaseSubscription(productId);

      if (result.success) {
        // Save to database
        // Persist the plan that corresponds to the purchased product
        const planType = getPlanTypeForProductId(productId);
        await savePurchaseToDatabase(user.id, result.purchase, planType);
        
        // Refresh status
        const status = await getPremiumStatus(user.id);
        setPremiumStatus(status);

        Alert.alert(
          '🎉 Welcome to Premium!',
          'Thank you for subscribing! All premium features are now unlocked.',
          [{ text: 'Awesome!' }]
        );
      } else if (result.cancelled) {
        // User cancelled - do nothing
        console.log('Purchase cancelled by user');
      } else {
        Alert.alert('Purchase Failed', result.error || 'Unable to complete purchase. Please try again.');
      }
    } catch (error) {
      console.error('Purchase error:', error);
      Alert.alert('Error', 'An error occurred during purchase. Please try again.');
    }

    setPurchasing(false);
  };

  const handleRestorePurchases = async () => {
    // Safety: restoring can also fail when store products are not available.
    if (iapUnavailableReason) {
      Alert.alert('Restore Unavailable', iapUnavailableReason);
      return;
    }

    setRestoring(true);

    try {
      const purchases = await restorePurchases();

      if (purchases && purchases.length > 0) {
        // Find the most recent subscription
        const subscription = purchases.find(p => 
          p.productId === PRODUCT_IDS.MONTHLY || p.productId === PRODUCT_IDS.YEARLY
        );

        if (subscription) {
          const plan = subscription.productId === PRODUCT_IDS.YEARLY ? 'yearly' : 'monthly';
          await savePurchaseToDatabase(user.id, subscription, plan);
          
          const status = await getPremiumStatus(user.id);
          setPremiumStatus(status);

          Alert.alert('Restored!', 'Your Premium subscription has been restored.');
        } else {
          Alert.alert('No Subscription Found', 'No active subscription found to restore.');
        }
      } else {
        Alert.alert('No Purchases Found', 'No previous purchases found to restore.');
      }
    } catch (error) {
      console.error('Restore error:', error);
      Alert.alert('Error', 'Unable to restore purchases. Please try again.');
    }

    setRestoring(false);
  };

  const handleManageSubscription = () => {
    // Open device subscription settings
    if (Platform.OS === 'ios') {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    } else {
      Linking.openURL('https://play.google.com/store/account/subscriptions');
    }
  };

  const handleBack = () => {
    onNavigate('home');
  };

  const getDisplayPrice = (type) => {
    const preferred = type === 'yearly' ? PRODUCT_IDS.YEARLY : PRODUCT_IDS.MONTHLY;
    const fallback = type === 'yearly' ? PRODUCT_IDS.MONTHLY : PRODUCT_IDS.YEARLY;
    const product = products.find(p => p.productId === preferred) || products.find(p => p.productId === fallback);
    if (product) {
      return product.localizedPrice || product.price || product.priceString;
    }
    // Fallback prices
    return type === 'yearly' ? '£39.99/year' : '£3.99/month';
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
  const canPurchase = !isPremium;

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

      {/* Subscription Options */}
      {canPurchase && (
        <View style={styles.subscriptionOptions}>
          <Text style={styles.subscriptionTitle}>Choose Your Plan</Text>
          
          {/* Monthly Option */}
          <TouchableOpacity
            style={[
              styles.planOption,
              selectedPlan === 'monthly' && styles.planOptionSelected
            ]}
            onPress={() => setSelectedPlan('monthly')}
          >
            <View style={styles.planInfo}>
              <Text style={styles.planName}>Monthly</Text>
              <Text style={styles.planPrice}>{getDisplayPrice('monthly')}</Text>
            </View>
            <View style={[
              styles.planRadio,
              selectedPlan === 'monthly' && styles.planRadioSelected
            ]}>
              {selectedPlan === 'monthly' && <View style={styles.planRadioInner} />}
            </View>
          </TouchableOpacity>

          {/* Yearly Option */}
          <TouchableOpacity
            style={[
              styles.planOption,
              selectedPlan === 'yearly' && styles.planOptionSelected
            ]}
            onPress={() => setSelectedPlan('yearly')}
          >
            <View style={styles.planInfo}>
              <Text style={styles.planName}>Yearly</Text>
              <Text style={styles.planPrice}>{getDisplayPrice('yearly')}</Text>
              <Text style={styles.planSavings}>Save 33%</Text>
            </View>
            <View style={[
              styles.planRadio,
              selectedPlan === 'yearly' && styles.planRadioSelected
            ]}>
              {selectedPlan === 'yearly' && <View style={styles.planRadioInner} />}
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* If store didn't return products, show info but keep purchase button enabled */}
      {!isPremium && !!iapUnavailableReason && (
        <View style={styles.iapUnavailableCard}>
          <Text style={styles.iapUnavailableTitle}>Subscription Setup Pending</Text>
          <Text style={styles.iapUnavailableText}>{iapUnavailableReason}</Text>
        </View>
      )}

      {/* Action Buttons */}
      {isPremium ? (
        <TouchableOpacity
          style={styles.manageButton}
          onPress={handleManageSubscription}
        >
          <Text style={styles.manageButtonText}>Manage Subscription</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            style={[
              styles.subscribeButton,
              (purchasing || restoring) && styles.buttonDisabled,
            ]}
            onPress={handleSubscribe}
            disabled={purchasing || restoring}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.subscribeButtonIcon}>💎</Text>
                <Text style={styles.subscribeButtonText}>
                  Subscribe Now
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.restoreButton,
              (restoring || purchasing) && styles.buttonDisabled,
            ]}
            onPress={handleRestorePurchases}
            disabled={purchasing || restoring}
          >
            {restoring ? (
              <ActivityIndicator color="#6C63FF" />
            ) : (
              <Text style={styles.restoreButtonText}>Restore Purchases</Text>
            )}
          </TouchableOpacity>
        </>
      )}

      {/* Legal Text */}
      <View style={styles.legalContainer}>
        <Text style={styles.legalText}>
          {isPremium 
            ? 'Thank you for supporting LoveLink!'
            : `Payment will be charged to your ${Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'} account at confirmation of purchase. Subscription automatically renews unless auto-renew is turned off at least 24-hours before the end of the current period.`
          }
        </Text>
        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => Linking.openURL('https://mitchell1972.github.io/lovelink-web/privacy.html')}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>•</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://mitchell1972.github.io/lovelink-web/terms.html')}>
            <Text style={styles.legalLink}>Terms of Use</Text>
          </TouchableOpacity>
        </View>
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

  // Subscription Options
  subscriptionOptions: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  subscriptionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  planOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    marginBottom: 12,
  },
  planOptionSelected: {
    borderColor: '#6C63FF',
    backgroundColor: 'rgba(108, 99, 255, 0.05)',
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  planPrice: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#6C63FF',
    marginTop: 4,
  },
  planSavings: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '600',
    marginTop: 2,
  },
  planRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planRadioSelected: {
    borderColor: '#6C63FF',
  },
  planRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#6C63FF',
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

  iapUnavailableCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  iapUnavailableTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
    textAlign: 'center',
  },
  iapUnavailableText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
    textAlign: 'center',
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
  buttonDisabled: {
    opacity: 0.7,
  },
  restoreButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  restoreButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  manageButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  manageButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },

  // Legal
  legalContainer: {
    marginBottom: 20,
  },
  legalText: {
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalLink: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  legalSeparator: {
    color: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: 8,
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
