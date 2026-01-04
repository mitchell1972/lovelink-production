// src/services/iapService.js
// Real In-App Purchase service using react-native-iap v14+

import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  getSubscriptions,
  requestSubscription,
  getAvailablePurchases,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  acknowledgePurchaseAndroid,
} from 'react-native-iap';
import { supabase } from '../config/supabase';

// Product IDs - matching App Store Connect
export const PRODUCT_IDS = {
  MONTHLY: 'lovelink.premium.monthly',
  YEARLY: 'lovelink.premium.yearly',
};

// All subscription product IDs
const subscriptionSkus = Platform.select({
  ios: [PRODUCT_IDS.MONTHLY, PRODUCT_IDS.YEARLY],
  android: [PRODUCT_IDS.MONTHLY, PRODUCT_IDS.YEARLY],
});

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
      const result = await initConnection();
      console.log('IAP Connection initialized:', result);

      // Note: clearTransactionIOS removed in v14 - handled automatically

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

      // Get subscriptions - use getSubscriptions for subscription products
      const products = await getSubscriptions({ skus: subscriptionSkus });
      console.log('Available subscriptions:', products);

      this.products = products;
      return products;
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      return [];
    }
  }

  /**
   * Purchase a subscription
   * @param {string} productId - The product ID to purchase
   * @returns {Promise<{success: boolean, error?: string, purchase?: object}>}
   */
  async purchaseSubscription(productId) {
    try {
      await this.initialize();

      console.log('Requesting subscription:', productId);

      // Request the subscription - this shows the Apple payment sheet
      const purchase = await requestSubscription({
        sku: productId,
        andDangerouslyFinishTransactionAutomaticallyIOS: false,
      });

      console.log('Purchase result:', JSON.stringify(purchase, null, 2));

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
          await finishTransaction({ purchase, isConsumable: false });
          console.log('Transaction finished successfully');
        } catch (finishError) {
          console.error('Error finishing transaction:', finishError);
          // Still return success if purchase was made
        }
      }

      return { success: true, purchase };
    } catch (error) {
      console.error('Purchase error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      // Handle user cancellation
      if (error.code === 'E_USER_CANCELLED') {
        return { success: false, error: 'Purchase cancelled', cancelled: true };
      }

      // Handle other known error codes
      if (error.code === 'E_UNKNOWN' || error.code === 'E_SERVICE_ERROR') {
        return { success: false, error: 'App Store service error. Please try again.' };
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

      const purchases = await getAvailablePurchases();
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
        if (subscriptionSkus.includes(purchase.productId)) {
          // Verify the receipt is valid and not expired
          // In production, you should verify this server-side
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
   * Save purchase to Supabase for server-side tracking
   */
  async savePurchaseToDatabase(userId, purchase, plan) {
    try {
      // Calculate expiry date
      const now = new Date();
      let expiresAt;
      if (plan === 'yearly') {
        expiresAt = new Date(now.setFullYear(now.getFullYear() + 1));
      } else {
        expiresAt = new Date(now.setMonth(now.getMonth() + 1));
      }

      // Update user's premium status in database
      const { data, error } = await supabase
        .from('profiles')
        .update({
          is_premium: true,
          premium_plan: plan,
          premium_since: new Date().toISOString(),
          premium_expires: expiresAt.toISOString(),
          iap_transaction_id: purchase.transactionId,
          iap_product_id: purchase.productId,
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

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
    this.purchaseUpdateSubscription = purchaseUpdatedListener(
      async (purchase) => {
        console.log('Purchase updated:', purchase);

        const receipt = purchase.transactionReceipt;
        if (receipt) {
          // Finish the transaction
          try {
            if (Platform.OS === 'ios') {
              await finishTransaction({ purchase, isConsumable: false });
            } else {
              await acknowledgePurchaseAndroid({
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

    // Listen for purchase errors
    this.purchaseErrorSubscription = purchaseErrorListener((error) => {
      console.error('Purchase error listener:', error);
      if (onPurchaseError) {
        onPurchaseError(error);
      }
    });
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
    await endConnection();
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
