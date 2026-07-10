// src/services/iapService.js
// Real In-App Purchase service using react-native-iap v14+

import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import { supabase } from '../config/supabase';
import { log, error } from '../utils/logger';

// Product IDs - MUST match App Store Connect exactly
export const PRODUCT_IDS = {
  MONTHLY: 'com.lovelinkcouples.premium.monthly',
  YEARLY: 'com.lovelinkcouples.premium.yearly',
};

// All subscription product IDs
const subscriptionSkus = Platform.select({
  ios: [PRODUCT_IDS.MONTHLY, PRODUCT_IDS.YEARLY],
  android: [PRODUCT_IDS.MONTHLY, PRODUCT_IDS.YEARLY],
});

// Normalize to an array (Platform.select can return undefined in edge cases)
const subscriptionSkusList = Array.isArray(subscriptionSkus) ? subscriptionSkus : [];
const legacySubscriptionSkus = [
  'com.lovelink.premium.monthly',
  'com.lovelink.premium.yearly',
  'lovelink.premium.monthly',
];
const rpcMissingFunctionCodes = new Set(['PGRST202', '42883']);
const validPlans = new Set(['monthly', 'yearly']);

const isSupportedSubscriptionProductId = (productId) =>
  typeof productId === 'string' &&
  (subscriptionSkusList.includes(productId) || legacySubscriptionSkus.includes(productId));

const isMissingPurchaseRequestConfigError = (error) => {
  const code = error?.code;
  const message = (error?.message || '').toLowerCase();
  return (
    code === 'E_MISSING_PURCHASE_REQUEST' ||
    message.includes('missing purchase request configuration')
  );
};

const isUserCancelledPurchaseError = (purchaseError) => {
  try {
    if (typeof RNIap.isUserCancelledError === 'function' &&
        RNIap.isUserCancelledError(purchaseError)) {
      return true;
    }
  } catch (_) {
    // Fall through to the cross-version code check below.
  }

  return [
    'E_USER_CANCELLED',
    'E_USER_CANCELED',
    'user-cancelled',
    'user-canceled',
  ].includes(purchaseError?.code);
};

const normalizePurchaseResult = (result) => {
  if (Array.isArray(result)) {
    return result.find(Boolean) || null;
  }
  return result || null;
};

const normalizeStoreProduct = (product) => {
  if (!product) return null;
  return {
    ...product,
    // react-native-iap v14's Nitro bridge currently returns `id` on iOS,
    // while Android and older native builds return `productId`.
    productId: product.productId || product.id,
  };
};

const getIosSubscriptionGroupId = (product) => {
  const directGroupId = product?.subscriptionInfoIOS?.subscriptionGroupId;
  if (directGroupId) return directGroupId;

  // Current StoreKit/Nitro builds include the group in jsonRepresentationIOS
  // even when subscriptionInfoIOS is undefined.
  try {
    const representation = typeof product?.jsonRepresentationIOS === 'string'
      ? JSON.parse(product.jsonRepresentationIOS)
      : product?.jsonRepresentationIOS;
    return representation?.attributes?.subscriptionFamilyId ||
      representation?.attributes?.subscriptionGroupId ||
      null;
  } catch (err) {
    error('Unable to read the StoreKit subscription group:', err);
    return null;
  }
};

const getPlanForProductId = (productId) => {
  if (productId === PRODUCT_IDS.YEARLY || productId === 'com.lovelink.premium.yearly') {
    return 'yearly';
  }
  if (productId === PRODUCT_IDS.MONTHLY || productId === 'com.lovelink.premium.monthly' || productId === 'lovelink.premium.monthly') {
    return 'monthly';
  }
  return null;
};

const hasPurchaseProof = (purchase) => Boolean(
  purchase?.transactionId ||
  purchase?.purchaseToken ||
  purchase?.transactionReceipt
);

const isSevenDayFreeTrialPhase = (phase) =>
  phase?.billingPeriod === 'P7D' && Number(phase?.priceAmountMicros) === 0;

const getAndroidTrialOffer = (product) => {
  const offers = product?.subscriptionOfferDetailsAndroid || product?.subscriptionOfferDetails || [];
  return offers.find((offer) =>
    (offer?.pricingPhases?.pricingPhaseList || []).some(isSevenDayFreeTrialPhase)
  ) || null;
};

const hasIosSevenDayFreeTrial = (product) => {
  const offer = product?.subscriptionInfoIOS?.introductoryOffer;
  const modernOfferMatches = offer?.period?.value === 1 &&
    offer?.period?.unit === 'week' &&
    Number(offer?.price) === 0;

  // Keep support for StoreKit product fields returned by earlier native builds.
  const legacyOfferMatches = product?.introductoryPricePaymentModeIOS === 'free-trial' &&
    product?.introductoryPriceSubscriptionPeriodIOS === 'week' &&
    Number(product?.introductoryPriceNumberOfPeriodsIOS) === 1 &&
    Number(product?.introductoryPriceAsAmountIOS) === 0;

  return modernOfferMatches || legacyOfferMatches;
};

/** True only when the store has returned an eligible seven-day free trial. */
const hasSevenDayFreeTrialOffer = (product) => {
  if (Platform.OS === 'android' || product?.platform === 'android') {
    return Boolean(getAndroidTrialOffer(product));
  }
  return hasIosSevenDayFreeTrial(product);
};

/**
 * Verify that this store account can actually receive the free period.
 * StoreKit exposes introductory-offer metadata even after an Apple ID has
 * consumed its one-time eligibility, so checking the product shape alone can
 * otherwise lead to an immediate charge.
 */
const isEligibleForSevenDayFreeTrialOffer = async (product) => {
  if (!hasSevenDayFreeTrialOffer(product)) return false;

  // Google Play only returns offer tokens available to the current account.
  if (Platform.OS === 'android' || product?.platform === 'android') return true;

  const groupId = getIosSubscriptionGroupId(product);
  if (!groupId || typeof RNIap.isEligibleForIntroOfferIOS !== 'function') {
    return false;
  }

  try {
    return Boolean(await RNIap.isEligibleForIntroOfferIOS(groupId));
  } catch (err) {
    error('Unable to verify introductory-offer eligibility:', err);
    return false;
  }
};

const calculatePremiumExpiry = (plan) => {
  const now = new Date();
  if (plan === 'yearly') {
    return new Date(now.setFullYear(now.getFullYear() + 1));
  }
  return new Date(now.setMonth(now.getMonth() + 1));
};

const getPartnerIdFromActivePartnership = async (userId) => {
  const { data: partnerships, error } = await supabase
    .from('partnerships')
    .select('user1_id, user2_id')
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  const rows = Array.isArray(partnerships) ? partnerships : (partnerships ? [partnerships] : []);
  const latest = rows[0];
  if (!latest) return null;

  return latest.user1_id === userId ? latest.user2_id : latest.user1_id;
};

class IAPService {
  constructor() {
    this.products = [];
    this.purchaseUpdateSubscription = null;
    this.purchaseErrorSubscription = null;
    this.isInitialized = false;
  }

  /**
   * Initialize IAP connection
   */
  async initialize() {
    if (this.isInitialized) return true;

    try {
      // Initialize connection to store
      const result = await RNIap.initConnection();
      log('IAP Connection initialized:', result);

      // Log available functions for debugging
      const availableFunctions = Object.keys(RNIap).filter(k => typeof RNIap[k] === 'function');
      log('RNIap available functions:', availableFunctions.join(', '));

      this.isInitialized = true;
      return true;
    } catch (err) {
      error('IAP initialization error:', err);
      return false;
    }
  }

  /**
   * Get available subscription products from the store
   */
  async getProducts() {
    try {
      const initialized = await this.initialize();
      if (!initialized) return [];

      log('Fetching subscriptions for SKUs:', subscriptionSkusList);

      // fetchProducts is the v14 API. Keep getSubscriptions as a compatibility
      // fallback for an older native binary during a staged app update.
      const products = typeof RNIap.fetchProducts === 'function'
        ? await RNIap.fetchProducts({ skus: subscriptionSkusList, type: 'subs' })
        : await RNIap.getSubscriptions({ skus: subscriptionSkusList });
      // Some versions of react-native-iap can return a single object or include nulls
      const normalized = (Array.isArray(products) ? products : (products ? [products] : []))
        .map(normalizeStoreProduct)
        .filter((product) => product?.productId);
      log('Available subscriptions count:', Array.isArray(products) ? products.length : (products ? 1 : 0));
      log('Available subscriptions:', JSON.stringify(products, null, 2));

      this.products = normalized;
      return normalized;
    } catch (err) {
      error('Error fetching subscriptions:', err);
      return [];
    }
  }

  /** Return the store product for the selected plan, without changing plans. */
  getProductForPlan(plan) {
    const preferredSku = plan === 'yearly' ? PRODUCT_IDS.YEARLY : PRODUCT_IDS.MONTHLY;
    return this.products.find((p) => p?.productId === preferredSku) || null;
  }

  hasSevenDayFreeTrial(product) {
    return hasSevenDayFreeTrialOffer(product);
  }

  async isEligibleForSevenDayFreeTrial(product) {
    return isEligibleForSevenDayFreeTrialOffer(product);
  }

  /**
   * Purchase a subscription
   * @param {string} productId - The product ID to purchase
   * @returns {Promise<{success: boolean, error?: string, purchase?: object}>}
   */
  async purchaseSubscription(productId, appAccountToken) {
    try {
      if (!isSupportedSubscriptionProductId(productId)) {
        return { success: false, error: 'Invalid subscription product selected.' };
      }

      // ALWAYS ensure initialized
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, error: 'Failed to initialize IAP' };
      }

      log('=== PURCHASE DEBUG START ===');
      log('Requesting subscription for productId:', productId);
      log('Current products in memory:', this.products.length);

      // ALWAYS reload products to ensure fresh data
      if (this.products.length === 0) {
        log('No products in memory, fetching...');
        await this.getProducts();
      }

      // A plan may only charge the product the customer selected. Do not issue a
      // purchase request if the store has not returned that exact subscription.
      const product = this.products.find(p => p?.productId === productId);
      log('Product found in getSubscriptions results:', product ? 'YES' : 'NO');
      if (!product) {
        const available = this.products.map(p => p?.productId).filter(Boolean);
        return {
          success: false,
          error: `The selected subscription is unavailable. Available products: ${available.join(', ') || 'none'}.`,
        };
      }
      if (!hasSevenDayFreeTrialOffer(product)) {
        return {
          success: false,
          error: 'The required 7-day free trial is not available for this plan. Please try again after the store offer is configured.',
        };
      }
      if (!await isEligibleForSevenDayFreeTrialOffer(product)) {
        return {
          success: false,
          error: 'This store account is not eligible for the 7-day free trial, so LoveLink will not start a purchase that could charge immediately.',
        };
      }
      log('Product details:', JSON.stringify(product, null, 2));

      if (typeof RNIap.requestPurchase !== 'function') {
        throw new Error('No purchase method available in react-native-iap');
      }

      // Google Play may return a paid base plan plus several offers. Select the
      // explicit seven-day, zero-price offer—never just the first offer.
      const offerToken = getAndroidTrialOffer(product)?.offerToken || '';
      const modernRequest = {
        request: {
          apple: {
            sku: productId,
            ...(appAccountToken ? { appAccountToken } : {}),
          },
          google: {
            skus: [productId],
            ...(offerToken ? { subscriptionOffers: [{ sku: productId, offerToken }] } : {}),
          },
        },
        type: 'subs',
      };

      const purchase = await new Promise((resolve, reject) => {
        let settled = false;
        let updateListener = null;
        let errorListener = null;
        const cleanup = () => {
          updateListener?.remove?.();
          errorListener?.remove?.();
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          callback(value);
        };
        const handlePurchase = (candidate) => {
          const normalized = normalizePurchaseResult(candidate);
          if (!normalized || normalized.productId !== productId) return;
          settle(resolve, normalized);
        };

        // v14 commonly emits the result through listeners rather than resolving
        // requestPurchase with it. Register first so neither outcome is lost.
        if (typeof RNIap.purchaseUpdatedListener === 'function') {
          updateListener = RNIap.purchaseUpdatedListener(handlePurchase);
        }
        if (typeof RNIap.purchaseErrorListener === 'function') {
          errorListener = RNIap.purchaseErrorListener((purchaseError) => {
            settle(reject, purchaseError);
          });
        }

        Promise.resolve(RNIap.requestPurchase(modernRequest))
          .then(handlePurchase)
          .catch(async (modernError) => {
            if (!isMissingPurchaseRequestConfigError(modernError)) {
              settle(reject, modernError);
              return;
            }
            try {
              handlePurchase(await RNIap.requestPurchase({ sku: productId }));
            } catch (legacyError) {
              settle(reject, legacyError);
            }
          });
      });

      log('=== PURCHASE RESULT ===');
      log('Purchase object:', JSON.stringify(purchase, null, 2));

      // CRITICAL: Verify we actually have a valid purchase with transaction info
      if (!purchase) {
        error('No purchase object returned');
        return { success: false, error: 'No purchase data received' };
      }

      // v14 uses purchaseToken (JWS on iOS, purchase token on Android) as
      // the canonical purchase proof; older binaries may expose a receipt.
      if (!hasPurchaseProof(purchase)) {
        error('Purchase missing transaction ID or purchase token');
        return { success: false, error: 'Invalid purchase - no transaction' };
      }

      log('Purchase successful with transaction:', purchase.transactionId);
      // The caller must grant the entitlement (after server validation) before
      // completing this transaction, otherwise a paid user can lose Premium.
      return { success: true, purchase };
    } catch (err) {
      // Cancellation is an expected outcome, not an application error.
      if (isUserCancelledPurchaseError(err)) {
        return { success: false, error: 'Purchase cancelled', cancelled: true };
      }

      error('=== PURCHASE ERROR ===');
      error('Error:', err);
      error('Error code:', err.code);
      error('Error message:', err.message);
      error('Error details:', JSON.stringify(err, null, 2));

      // Handle known error codes
      if (err.code === 'E_UNKNOWN' || err.code === 'E_SERVICE_ERROR') {
        return { success: false, error: 'App Store service error. Please try again.' };
      }

      if (err.code === 'E_MISSING_PURCHASE_REQUEST') {
        return { success: false, error: 'Purchase configuration error. Please restart the app and try again.' };
      }

      return { success: false, error: err.message || 'Purchase failed' };
    }
  }

  /**
   * Restore previous purchases
   */
  async restorePurchases() {
    try {
      const initialized = await this.initialize();
      if (!initialized) return [];

      const purchases = typeof RNIap.getActiveSubscriptions === 'function'
        ? await RNIap.getActiveSubscriptions(subscriptionSkusList)
        : await RNIap.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
      log('Restored purchases:', purchases);

      return (Array.isArray(purchases) ? purchases : []).filter((purchase) =>
        isSupportedSubscriptionProductId(purchase?.productId) && purchase?.isActive !== false
      );
    } catch (err) {
      error('Restore error:', err);
      return [];
    }
  }

  /**
   * Check if user has active subscription
   */
  async checkActiveSubscription() {
    try {
      const purchases = await this.restorePurchases();

      // Check for valid subscription
      for (const purchase of purchases) {
        if (isSupportedSubscriptionProductId(purchase.productId)) {
          return {
            isActive: true,
            productId: purchase.productId,
            transactionId: purchase.transactionId,
            purchaseDate: purchase.transactionDate,
          };
        }
      }

      return { isActive: false };
    } catch (err) {
      error('Check subscription error:', err);
      return { isActive: false };
    }
  }

  /** Complete a subscription only after its entitlement has been granted. */
  async finishPurchaseTransaction(purchase) {
    try {
      await RNIap.finishTransaction({ purchase, isConsumable: false });
      log('Transaction finished successfully');
      return { success: true };
    } catch (err) {
      error('Error finishing transaction:', err);
      return { success: false, error: err.message || 'Unable to complete transaction' };
    }
  }

  /**
   * Save purchase to Supabase for server-side tracking.
   * Also syncs premium to the linked partner so both get instant access.
   */
  async savePurchaseToDatabase(userId, purchase, plan) {
    try {
      if (!userId) {
        return { success: false, error: 'Missing user id' };
      }

      if (!purchase?.productId) {
        return { success: false, error: 'Missing purchase product id' };
      }

      if (!isSupportedSubscriptionProductId(purchase.productId)) {
        return { success: false, error: 'Unsupported subscription product id' };
      }

      if (!validPlans.has(plan)) {
        return { success: false, error: 'Invalid premium plan' };
      }

      if (getPlanForProductId(purchase.productId) !== plan) {
        return { success: false, error: 'Subscription plan does not match the purchased product' };
      }

      const premiumSince = new Date().toISOString();
      const premiumExpires = calculatePremiumExpiry(plan).toISOString();

      const premiumFields = {
        is_premium: true,
        premium_plan: plan,
        premium_since: premiumSince,
        premium_expires: premiumExpires,
        iap_transaction_id: purchase.transactionId,
        iap_product_id: purchase.productId,
      };

      // Preferred path: write premium via a server-side RPC.
      // If the RPC is not deployed yet, fall back to the legacy client update path.
      const { data: rpcData, error: rpcError } = await supabase.rpc('grant_premium_from_iap', {
        p_user_id: userId,
        p_product_id: purchase.productId,
        p_transaction_id: purchase.transactionId || null,
        p_plan: plan,
        p_premium_since: premiumSince,
        p_premium_expires: premiumExpires,
      });

      if (!rpcError) {
        if (rpcData && typeof rpcData === 'object' && rpcData.success === false) {
          return { success: false, error: rpcData.error || 'Failed to save purchase' };
        }
        return { success: true, data: rpcData };
      }

      if (!rpcMissingFunctionCodes.has(rpcError.code)) {
        throw rpcError;
      }

      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('id, partner_id, iap_transaction_id')
        .eq('id', userId)
        .single();

      if (currentProfileError) throw currentProfileError;

      if (purchase.transactionId && currentProfile.iap_transaction_id === purchase.transactionId) {
        return { success: true, data: currentProfile };
      }

      const partnerId = currentProfile.partner_id || await getPartnerIdFromActivePartnership(userId);

      // Update subscriber's premium status
      const { data, error } = await supabase
        .from('profiles')
        .update(premiumFields)
        .eq('id', userId)
        .select('id, partner_id, premium_plan, premium_since, premium_expires, iap_transaction_id, iap_product_id')
        .single();

      if (error) throw error;

      // Sync premium to partner (convenience — getPremiumStatus handles correctness)
      if (partnerId) {
        await supabase
          .from('profiles')
          .update({
            is_premium: true,
            premium_plan: plan,
            premium_since: premiumFields.premium_since,
            premium_expires: premiumFields.premium_expires,
            premium_granted_by: userId,
          })
          .eq('id', partnerId);
      }

      return { success: true, data };
    } catch (err) {
      error('Error saving purchase:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Set up purchase listeners for handling transactions
   */
  setupListeners(onPurchaseSuccess, onPurchaseError) {
    // Remove existing listeners
    this.removeListeners();

    // Listen for purchase updates
    if (typeof RNIap.purchaseUpdatedListener === 'function') {
      this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
        async (purchase) => {
          log('Purchase updated:', purchase);

          const receipt = purchase.transactionReceipt;
          if (receipt) {
            // Finish the transaction
            try {
              if (Platform.OS === 'ios') {
                await RNIap.finishTransaction({ purchase, isConsumable: false });
              } else if (typeof RNIap.acknowledgePurchaseAndroid === 'function') {
                await RNIap.acknowledgePurchaseAndroid({
                  token: purchase.purchaseToken,
                });
              }

              if (onPurchaseSuccess) {
                onPurchaseSuccess(purchase);
              }
            } catch (err) {
              error('Error finishing transaction:', err);
            }
          }
        }
      );
    }

    // Listen for purchase errors
    if (typeof RNIap.purchaseErrorListener === 'function') {
      this.purchaseErrorSubscription = RNIap.purchaseErrorListener((purchaseErr) => {
        error('Purchase error listener:', purchaseErr);
        if (onPurchaseError) {
          onPurchaseError(purchaseErr);
        }
      });
    }
  }

  /**
   * Remove purchase listeners
   */
  removeListeners() {
    if (this.purchaseUpdateSubscription) {
      this.purchaseUpdateSubscription.remove();
      this.purchaseUpdateSubscription = null;
    }
    if (this.purchaseErrorSubscription) {
      this.purchaseErrorSubscription.remove();
      this.purchaseErrorSubscription = null;
    }
  }

  /**
   * End IAP connection
   */
  async endConnection() {
    this.removeListeners();
    await RNIap.endConnection();
    this.isInitialized = false;
  }

  /**
   * Get formatted price for a product
   */
  getProductPrice(productId) {
    const product = this.products.find((p) => p.productId === productId);
    if (product) {
      return product.localizedPrice || product.price;
    }
    // Fallback prices
    return productId.includes('yearly') ? '£39.99' : '£3.99';
  }

  /**
   * Get product details
   */
  getProduct(productId) {
    return this.products.find((p) => p.productId === productId);
  }
}

// Export singleton instance
export const iapService = new IAPService();

// Export convenience functions
export const initializeIAP = () => iapService.initialize();
export const getProducts = () => iapService.getProducts();
export const purchaseSubscription = (productId, appAccountToken) =>
  iapService.purchaseSubscription(productId, appAccountToken);
export const restorePurchases = () => iapService.restorePurchases();
export const hasSevenDayFreeTrial = (product) => iapService.hasSevenDayFreeTrial(product);
export const isEligibleForSevenDayFreeTrial = (product) =>
  iapService.isEligibleForSevenDayFreeTrial(product);
export const checkActiveSubscription = () => iapService.checkActiveSubscription();
export const finishPurchaseTransaction = (purchase) =>
  iapService.finishPurchaseTransaction(purchase);
export const savePurchaseToDatabase = (userId, purchase, plan) => 
  iapService.savePurchaseToDatabase(userId, purchase, plan);
