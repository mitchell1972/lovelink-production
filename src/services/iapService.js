// src/services/iapService.js
// Real In-App Purchase service using react-native-iap v14+

import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import { supabase } from '../config/supabase';

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

const normalizePurchaseResult = (result) => {
  if (Array.isArray(result)) {
    return result.find(Boolean) || null;
  }
  return result || null;
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
      console.log('IAP Connection initialized:', result);

      // Log available functions for debugging
      const availableFunctions = Object.keys(RNIap).filter(k => typeof RNIap[k] === 'function');
      console.log('RNIap available functions:', availableFunctions.join(', '));

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('IAP initialization error:', error);
      return false;
    }
  }

  /**
   * Get available subscription products from the store
   */
  async getProducts() {
    try {
      await this.initialize();

      console.log('Fetching subscriptions for SKUs:', subscriptionSkusList);

      // Get subscriptions - use getSubscriptions for subscription products
      const products = await RNIap.getSubscriptions({ skus: subscriptionSkusList });
      // Some versions of react-native-iap can return a single object or include nulls
      const normalized = Array.isArray(products)
        ? products.filter(Boolean)
        : (products ? [products] : []);
      console.log('Available subscriptions count:', Array.isArray(products) ? products.length : (products ? 1 : 0));
      console.log('Available subscriptions:', JSON.stringify(products, null, 2));

      this.products = normalized;
      return normalized;
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      return [];
    }
  }

  /**
   * Return the best available product for a plan type.
   * This intentionally falls back to whichever product is available to avoid
   * blocking purchases when Apple returns only one SKU.
   */
  getProductForPlan(plan) {
    const preferredSku = plan === 'yearly' ? PRODUCT_IDS.YEARLY : PRODUCT_IDS.MONTHLY;
    const fallbackSku = plan === 'yearly' ? PRODUCT_IDS.MONTHLY : PRODUCT_IDS.YEARLY;

    return (
      this.products.find((p) => p?.productId === preferredSku) ||
      this.products.find((p) => p?.productId === fallbackSku) ||
      null
    );
  }

  /**
   * Purchase a subscription
   * @param {string} productId - The product ID to purchase
   * @returns {Promise<{success: boolean, error?: string, purchase?: object}>}
   */
  async purchaseSubscription(productId) {
    try {
      if (!isSupportedSubscriptionProductId(productId)) {
        return { success: false, error: 'Invalid subscription product selected.' };
      }

      // ALWAYS ensure initialized
      const initialized = await this.initialize();
      if (!initialized) {
        return { success: false, error: 'Failed to initialize IAP' };
      }

      console.log('=== PURCHASE DEBUG START ===');
      console.log('Requesting subscription for productId:', productId);
      console.log('Current products in memory:', this.products.length);

      // ALWAYS reload products to ensure fresh data
      if (this.products.length === 0) {
        console.log('No products in memory, fetching...');
        await this.getProducts();
      }

      // Try to find the product (useful for price/offer tokens), but do NOT block
      // purchases if Apple returned 0 products (common while IAP is still in review).
      const product = this.products.find(p => p?.productId === productId);
      console.log('Product found in getSubscriptions results:', product ? 'YES' : 'NO');
      if (!product) {
        const available = this.products.map(p => p?.productId).filter(Boolean);
        console.warn(
          'Proceeding with purchase even though product was not returned by getSubscriptions.\n' +
          'Requested productId:',
          productId,
          '\nAvailable products:',
          available.join(', ') || '(none)'
        );
      } else {
        console.log('Product details:', JSON.stringify(product, null, 2));
      }

      let purchaseResult;

      if (typeof RNIap.requestPurchase !== 'function') {
        throw new Error('No purchase method available in react-native-iap');
      }

      // react-native-iap v14+ requires requestPurchase({ request: ..., type: 'subs' }).
      // Keep legacy fallback calls for older installed native binaries.
      if (Platform.OS === 'ios') {
        console.log('Platform: iOS');
        const modernRequest = {
          request: {
            apple: { sku: productId },
          },
          type: 'subs',
        };

        try {
          purchaseResult = await RNIap.requestPurchase(modernRequest);
          console.log('requestPurchase (modern iOS payload) returned:', JSON.stringify(purchaseResult, null, 2));
        } catch (modernError) {
          console.error('requestPurchase modern payload error:', modernError);
          console.error('Error code:', modernError?.code);
          console.error('Error message:', modernError?.message);

          if (!isMissingPurchaseRequestConfigError(modernError)) {
            throw modernError;
          }

          // Legacy fallback (older react-native-iap).
          purchaseResult = await RNIap.requestPurchase({ sku: productId });
          console.log('requestPurchase (legacy iOS payload) returned:', JSON.stringify(purchaseResult, null, 2));
        }
      } else {
        console.log('Platform: Android');
        const offerToken = product?.subscriptionOfferDetails?.[0]?.offerToken || '';
        const modernRequest = {
          request: {
            google: {
              skus: [productId],
              ...(offerToken
                ? {
                    subscriptionOffers: [
                      {
                        sku: productId,
                        offerToken,
                      },
                    ],
                  }
                : {}),
            },
          },
          type: 'subs',
        };

        try {
          purchaseResult = await RNIap.requestPurchase(modernRequest);
          console.log('requestPurchase (modern Android payload) returned:', JSON.stringify(purchaseResult, null, 2));
        } catch (modernError) {
          console.error('requestPurchase modern payload error:', modernError);
          console.error('Error code:', modernError?.code);
          console.error('Error message:', modernError?.message);

          if (!isMissingPurchaseRequestConfigError(modernError)) {
            throw modernError;
          }

          // Legacy fallback (older react-native-iap).
          purchaseResult = await RNIap.requestPurchase({ sku: productId });
          console.log('requestPurchase (legacy Android payload) returned:', JSON.stringify(purchaseResult, null, 2));
        }
      }

      const purchase = normalizePurchaseResult(purchaseResult);

      console.log('=== PURCHASE RESULT ===');
      console.log('Purchase object:', JSON.stringify(purchase, null, 2));

      // CRITICAL: Verify we actually have a valid purchase with transaction info
      if (!purchase) {
        console.error('No purchase object returned');
        return { success: false, error: 'No purchase data received' };
      }

      // Check for valid transaction ID (required for real purchases)
      if (!purchase.transactionId && !purchase.transactionReceipt) {
        console.error('Purchase missing transaction ID or receipt');
        return { success: false, error: 'Invalid purchase - no transaction' };
      }

      console.log('Purchase successful with transaction:', purchase.transactionId);

      // Finish the transaction
      if (Platform.OS === 'ios') {
        try {
          await RNIap.finishTransaction({ purchase, isConsumable: false });
          console.log('Transaction finished successfully');
        } catch (finishError) {
          console.error('Error finishing transaction:', finishError);
          // Still return success if purchase was made
        }
      }

      return { success: true, purchase };
    } catch (error) {
      console.error('=== PURCHASE ERROR ===');
      console.error('Error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Error details:', JSON.stringify(error, null, 2));

      // Handle user cancellation
      if (error.code === 'E_USER_CANCELLED' || error.code === 'E_USER_CANCELED') {
        return { success: false, error: 'Purchase cancelled', cancelled: true };
      }

      // Handle known error codes
      if (error.code === 'E_UNKNOWN' || error.code === 'E_SERVICE_ERROR') {
        return { success: false, error: 'App Store service error. Please try again.' };
      }

      if (error.code === 'E_MISSING_PURCHASE_REQUEST') {
        return { success: false, error: 'Purchase configuration error. Please restart the app and try again.' };
      }

      return { success: false, error: error.message || 'Purchase failed' };
    }
  }

  /**
   * Restore previous purchases
   */
  async restorePurchases() {
    try {
      await this.initialize();

      const purchases = await RNIap.getAvailablePurchases();
      console.log('Restored purchases:', purchases);

      return purchases;
    } catch (error) {
      console.error('Restore error:', error);
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
    } catch (error) {
      console.error('Check subscription error:', error);
      return { isActive: false };
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
    } catch (error) {
      console.error('Error saving purchase:', error);
      return { success: false, error: error.message };
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
          console.log('Purchase updated:', purchase);

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
            } catch (error) {
              console.error('Error finishing transaction:', error);
            }
          }
        }
      );
    }

    // Listen for purchase errors
    if (typeof RNIap.purchaseErrorListener === 'function') {
      this.purchaseErrorSubscription = RNIap.purchaseErrorListener((error) => {
        console.error('Purchase error listener:', error);
        if (onPurchaseError) {
          onPurchaseError(error);
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
export const purchaseSubscription = (productId) => iapService.purchaseSubscription(productId);
export const restorePurchases = () => iapService.restorePurchases();
export const checkActiveSubscription = () => iapService.checkActiveSubscription();
export const savePurchaseToDatabase = (userId, purchase, plan) => 
  iapService.savePurchaseToDatabase(userId, purchase, plan);
