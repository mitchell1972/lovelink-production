// src/screens/PremiumScreen.js
// Premium subscription screen with REAL Apple In-App Purchases

import React, { useState, useEffect } from 'react';
import { log, error as logError } from '../utils/logger';
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
  getSubscriptionAccessStatus,
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
  finishPurchaseTransaction,
  savePurchaseToDatabase,
  hasSevenDayFreeTrial,
  isEligibleForSevenDayFreeTrial,
} from '../services/iapService';

// Helper: normalize iOS product shapes
const normalizeProducts = (list) => (Array.isArray(list) ? list.filter(Boolean) : (list ? [list] : []));

const getPlanTypeForProductId = (productId) => {
  if (productId === PRODUCT_IDS.YEARLY) return 'yearly';
  if (productId === PRODUCT_IDS.MONTHLY) return 'monthly';
  // If IDs are misconfigured, fall back on heuristic.
  return productId?.toLowerCase().includes('year') ? 'yearly' : 'monthly';
};

const LEGACY_PRODUCT_IDS = [
  'com.lovelink.premium.monthly',
  'com.lovelink.premium.yearly',
  'lovelink.premium.monthly',
];
const isKnownSubscriptionProduct = (productId) =>
  productId === PRODUCT_IDS.MONTHLY ||
  productId === PRODUCT_IDS.YEARLY ||
  LEGACY_PRODUCT_IDS.includes(productId);

export default function PremiumScreen({ onNavigate, onSubscriptionActivated, subscriptionRequired = false }) {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(true);
  const [premiumStatus, setPremiumStatus] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [products, setProducts] = useState([]);
  const [eligibleTrialProductIds, setEligibleTrialProductIds] = useState([]);
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
      const initialized = await initializeIAP();
      if (!initialized) {
        throw new Error('Could not connect to the app store');
      }
      const availableProductsRaw = await getProducts();
      const availableProducts = normalizeProducts(availableProductsRaw);
      setProducts(availableProducts);

      const trialEligibility = await Promise.all(
        availableProducts.map(async (product) => ({
          productId: product?.productId,
          eligible: await isEligibleForSevenDayFreeTrial(product),
        }))
      );
      const eligibleProductIds = trialEligibility
        .filter(({ productId, eligible }) => productId && eligible)
        .map(({ productId }) => productId);
      setEligibleTrialProductIds(eligibleProductIds);

      // Do not send a purchase request until the store returns the exact product.
      // Falling back to another product can charge a customer for the wrong plan.
      if (!availableProducts || availableProducts.length === 0) {
        const msg = 'The app store has not returned any subscription products yet. Please try again later.';
        setIapUnavailableReason(msg);
      } else {
        setIapUnavailableReason(null);
        // Prefer a plan whose store offer starts with the seven-day free
        // trial. Accounts that already used their one-time trial can still
        // subscribe — the paywall copy switches to immediate billing.
        const hasMonthlyTrial = eligibleProductIds.includes(PRODUCT_IDS.MONTHLY);
        const hasYearlyTrial = eligibleProductIds.includes(PRODUCT_IDS.YEARLY);
        if (selectedPlan === 'monthly' && !hasMonthlyTrial && hasYearlyTrial) {
          setSelectedPlan('yearly');
        } else if (selectedPlan === 'yearly' && !hasYearlyTrial && hasMonthlyTrial) {
          setSelectedPlan('monthly');
        }
      }
      
      log('Products loaded:', availableProducts);
    } catch (err) {
      logError('Error initializing premium screen:', err);
      setPremiumStatus({ isPremium: false, plan: null, since: null, expires: null });
      setEligibleTrialProductIds([]);

      const msg = Platform.OS === 'ios'
        ? 'Subscriptions are temporarily unavailable (store connection error). Please try again later.'
        : 'Subscriptions are temporarily unavailable (store connection error). Please try again later.';
      setIapUnavailableReason(msg);
    }
    setLoading(false);
  };

  const handleSubscribe = async () => {
    if (purchasing) return;
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in before subscribing.');
      return;
    }

    // Only charge the product matching the plan the customer chose.
    const chosen = iapService.getProductForPlan(selectedPlan);
    if (!chosen?.productId) {
      Alert.alert('Plan unavailable', 'This subscription plan is not currently available from the app store.');
      return;
    }
    const productId = chosen.productId;
    const startsWithFreeTrial = hasSevenDayFreeTrial(chosen) &&
      eligibleTrialProductIds.includes(productId);

    setPurchasing(true);

    try {
      // This triggers the Apple payment sheet
      const result = await purchaseSubscription(productId, user.id);

      if (result.success) {
        // Grant the entitlement before finishing the StoreKit/Play transaction.
        const planType = getPlanTypeForProductId(productId);
        const saveResult = await savePurchaseToDatabase(user.id, result.purchase, planType);
        if (!saveResult.success) {
          Alert.alert(
            'Purchase needs attention',
            'Your purchase was received but Premium could not be activated. Please use Restore Purchases, or contact support if this continues.'
          );
          return;
        }

        const finishResult = await finishPurchaseTransaction(result.purchase);
        if (!finishResult.success) {
          logError('Purchase was activated, but transaction completion failed:', finishResult.error);
        }
        
        // Refresh status
        const status = await getPremiumStatus(user.id);
        const accessStatus = await getSubscriptionAccessStatus(user.id);
        setPremiumStatus(status);

        Alert.alert(
          '🎉 Subscription active!',
          startsWithFreeTrial
            ? 'LoveLink is now unlocked for both you and your partner. Your 7-day free trial has started and the store will charge only after it ends.'
            : 'LoveLink is now unlocked for both you and your partner.',
          [{ text: 'Continue', onPress: () => onSubscriptionActivated?.(accessStatus) }]
        );
      } else if (result.cancelled) {
        // User cancelled - do nothing
        log('Purchase cancelled by user');
      } else {
        Alert.alert('Purchase Failed', result.error || 'Unable to complete purchase. Please try again.');
      }
    } catch (err) {
      logError('Purchase error:', err);
      Alert.alert('Error', 'An error occurred during purchase. Please try again.');
    }

    setPurchasing(false);
  };

  const handleRestorePurchases = async () => {
    setRestoring(true);

    try {
      const purchases = await restorePurchases();

      if (purchases && purchases.length > 0) {
        // Use the latest active subscription returned by the store.
        const subscription = purchases
          .filter(p => isKnownSubscriptionProduct(p.productId))
          .sort((a, b) =>
            (b.expirationDateIOS || b.transactionDate || 0) -
            (a.expirationDateIOS || a.transactionDate || 0)
          )[0];

        if (subscription) {
          const plan = getPlanTypeForProductId(subscription.productId);
          const saveResult = await savePurchaseToDatabase(user.id, subscription, plan);
          if (!saveResult.success) {
            Alert.alert('Restore needs attention', saveResult.error || 'Premium could not be restored. Please try again later.');
            return;
          }

          const finishResult = await finishPurchaseTransaction(subscription);
          if (!finishResult.success) {
            logError('Restored purchase was verified, but transaction completion failed:', finishResult.error);
          }
          
          const status = await getPremiumStatus(user.id);
          const accessStatus = await getSubscriptionAccessStatus(user.id);
          setPremiumStatus(status);

          Alert.alert('Restored!', 'Your subscription has been restored.', [
            { text: 'Continue', onPress: () => onSubscriptionActivated?.(accessStatus) },
          ]);
        } else {
          Alert.alert('No Subscription Found', 'No active subscription found to restore.');
        }
      } else {
        Alert.alert('No Purchases Found', 'No previous purchases found to restore.');
      }
    } catch (err) {
      logError('Restore error:', err);
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

  const handleLogout = async () => {
    await signOut();
  };

  const getDisplayPrice = (type) => {
    const preferred = type === 'yearly' ? PRODUCT_IDS.YEARLY : PRODUCT_IDS.MONTHLY;
    const product = products.find(p => p.productId === preferred);
    if (product) {
      return product.localizedPrice || product.displayPrice || product.priceString || product.price;
    }
    return 'Unavailable';
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
  const monthlyAvailable = products.some((product) => product?.productId === PRODUCT_IDS.MONTHLY);
  const yearlyAvailable = products.some((product) => product?.productId === PRODUCT_IDS.YEARLY);
  const monthlyProduct = products.find((product) => product?.productId === PRODUCT_IDS.MONTHLY);
  const yearlyProduct = products.find((product) => product?.productId === PRODUCT_IDS.YEARLY);
  const monthlyTrialAvailable = monthlyAvailable &&
    hasSevenDayFreeTrial(monthlyProduct) &&
    eligibleTrialProductIds.includes(PRODUCT_IDS.MONTHLY);
  const yearlyTrialAvailable = yearlyAvailable &&
    hasSevenDayFreeTrial(yearlyProduct) &&
    eligibleTrialProductIds.includes(PRODUCT_IDS.YEARLY);
  // A plan can be bought whenever the store returned it; the trial flags only
  // decide the copy so nobody is promised a free week the store will not give.
  const selectedPlanAvailable = selectedPlan === 'yearly' ? yearlyAvailable : monthlyAvailable;
  const selectedPlanHasTrial = selectedPlan === 'yearly' ? yearlyTrialAvailable : monthlyTrialAvailable;
  const trialUnavailableForAccount = (monthlyAvailable || yearlyAvailable) &&
    !monthlyTrialAvailable && !yearlyTrialAvailable;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Premium Status Banner */}
      {isPremium ? (
        <View style={styles.premiumBanner}>
          <Text style={styles.premiumBannerIcon}>💎</Text>
          <Text style={styles.premiumBannerTitle}>Premium Active</Text>
          {premiumStatus.source === 'partner' ? (
            <>
              <Text style={styles.premiumBannerPlan}>
                Shared via {premiumStatus.partnerName || "your partner"}'s subscription
              </Text>
              <Text style={styles.premiumBannerExpiry}>
                {premiumStatus.plan === 'yearly' ? 'Yearly Plan' : 'Monthly Plan'} — {formatPremiumExpiry(premiumStatus.expires)}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.premiumBannerPlan}>
                {premiumStatus.plan === 'yearly' ? 'Yearly Plan' : 'Monthly Plan'}
              </Text>
              <Text style={styles.premiumBannerExpiry}>
                {formatPremiumExpiry(premiumStatus.expires)}
              </Text>
              <Text style={styles.sharedNote}>
                Your partner also has Premium access
              </Text>
            </>
          )}
        </View>
      ) : (
        <View style={styles.freeBanner}>
          <Text style={styles.freeBannerIcon}>{trialUnavailableForAccount ? '💎' : '🆓'}</Text>
          <Text style={styles.freeBannerTitle}>
            {trialUnavailableForAccount ? 'Unlock LoveLink Premium' : 'Start with 7 days free'}
          </Text>
          <Text style={styles.freeBannerSubtitle}>
            {trialUnavailableForAccount
              ? 'One subscription unlocks LoveLink for you and your partner'
              : 'Start a subscription to unlock LoveLink — no charge today'}
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
          <Text style={styles.subscriptionTitle}>Choose your plan</Text>
          <Text style={styles.sharedPlanNote}>One subscription covers both you and your partner</Text>
          
          {/* Monthly Option */}
          <TouchableOpacity
            style={[
              styles.planOption,
              selectedPlan === 'monthly' && styles.planOptionSelected,
              !monthlyAvailable && styles.buttonDisabled,
            ]}
            onPress={() => setSelectedPlan('monthly')}
            disabled={!monthlyAvailable}
          >
            <View style={styles.planInfo}>
              <Text style={styles.planName}>Monthly</Text>
              <Text style={styles.planPrice}>{getDisplayPrice('monthly')}</Text>
              <Text style={styles.planSavings}>
                {monthlyTrialAvailable ? '7 days free, then renews monthly' : 'Renews monthly'}
              </Text>
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
              selectedPlan === 'yearly' && styles.planOptionSelected,
              !yearlyAvailable && styles.buttonDisabled,
            ]}
            onPress={() => setSelectedPlan('yearly')}
            disabled={!yearlyAvailable}
          >
            <View style={styles.planInfo}>
              <Text style={styles.planName}>Yearly</Text>
              <Text style={styles.planPrice}>{getDisplayPrice('yearly')}</Text>
              <Text style={styles.planSavings}>
                {yearlyTrialAvailable ? '7 days free, then renews yearly • Save 33%' : 'Renews yearly • Save 33%'}
              </Text>
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

      {/* Explain why subscriptions cannot be selected when the store is unavailable. */}
      {!isPremium && !!iapUnavailableReason && (
        <View style={styles.iapUnavailableCard}>
          <Text style={styles.iapUnavailableTitle}>Subscription Setup Pending</Text>
          <Text style={styles.iapUnavailableText}>{iapUnavailableReason}</Text>
        </View>
      )}

      {/* Accounts that already used the one-time trial can still subscribe. */}
      {!isPremium && !iapUnavailableReason && trialUnavailableForAccount && (
        <View style={styles.iapUnavailableCard}>
          <Text style={styles.iapUnavailableTitle}>Free Trial Already Used</Text>
          <Text style={styles.iapUnavailableText}>
            This store account has already used its 7-day free trial, so billing starts as soon as you subscribe.
          </Text>
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
              (purchasing || restoring || !selectedPlanAvailable) && styles.buttonDisabled,
            ]}
            onPress={handleSubscribe}
            disabled={purchasing || restoring || !selectedPlanAvailable}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.subscribeButtonIcon}>💎</Text>
                <Text style={styles.subscribeButtonText}>
                  {selectedPlanHasTrial ? 'Start 7-Day Free Trial' : 'Subscribe Now'}
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
            : `Start your 7-day free trial today. If eligible, your ${Platform.OS === 'ios' ? 'Apple ID' : 'Google Play'} account will be charged only after the trial ends unless you cancel at least 24 hours beforehand. Subscription automatically renews until cancelled. Price and trial eligibility are confirmed by the store before you subscribe.`
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

      {/* Required paywalls cannot be bypassed, but users can still change accounts. */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={subscriptionRequired ? handleLogout : handleBack}
      >
        <Text style={styles.backButtonText}>
          {subscriptionRequired ? 'Log Out' : '← Back'}
        </Text>
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
  
  sharedNote: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 8,
    fontStyle: 'italic',
  },

  sharedPlanNote: {
    fontSize: 13,
    color: '#6C63FF',
    textAlign: 'center',
    marginBottom: 12,
    fontWeight: '500',
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
