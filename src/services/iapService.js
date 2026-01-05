// src/services/iapService.js
// Real In-App Purchase service using react-native-iap v14+

import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import { supabase } from '../config/supabase';

// Product IDs - matching App Store Connect
// NOTE: The yearly product was created with ID ending in "monthly" by mistake
export const PRODUCT_IDS = {
  MONTHLY: 'lovelink.premium.monthly',
  YEARLY: 'com.lovelink.premium.monthly',  // This is actually the yearly product in ASC
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

      console.log('Fetching subscriptions for SKUs:', subscriptionSkus);

      // Get subscriptions - use getSubscriptions for subscription products
      const products = await RNIap.getSubscriptions({ skus: subscriptionSkus });
      console.log('Available subscriptions count:', products.length);
      console.log('Available subscriptions:', JSON.stringify(products, null, 2));

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

      // Find the product to ensure it exists
      const product = this.products.find(p => p.productId === productId);
      console.log('Product found:', product ? 'YES' : 'NO');
      
      if (!product) {
        console.error('Product not found in App Store. ProductId:', productId);
        console.error('Available products:', this.products.map(p => p.productId).join(', '));
        return { 
          success: false, 
          error: `Product "${productId}" not found. Please ensure products are configured in App Store Connect.` 
        };
      }

      console.log('Product details:', JSON.stringify(product, null, 2));

      let purchase;

      // iOS-specific purchase flow
      if (Platform.OS === 'ios') {
        console.log('Platform: iOS');
        
        // Try requestSubscription first (the correct method for subscriptions)
        if (typeof RNIap.requestSubscription === 'function') {
          console.log('Calling RNIap.requestSubscription with sku:', productId);
          
          try {
            // For iOS StoreKit 2, just pass the sku
            purchase = await RNIap.requestSubscription({
              sku: productId,
            });
            console.log('requestSubscription returned:', JSON.stringify(purchase, null, 2));
          } catch (subError) {
            console.error('requestSubscription error:', subError);
            console.error('Error code:', subError.code);
            console.error('Error message:', subError.message);
            
            // If requestSubscription fails, try requestPurchase as fallback
            if (subError.message?.includes('Missing purchase') || subError.code === 'E_MISSING_PURCHASE_REQUEST') {
              console.log('Trying requestPurchase as fallback...');
              
              if (typeof RNIap.requestPurchase === 'function') {
                purchase = await RNIap.requestPurchase({
                  sku: productId,
                });
                console.log('requestPurchase fallback returned:', JSON.stringify(purchase, null, 2));
              } else {
                throw subError;
              }
            } else {
              throw subError;
            }
          }
        } else if (typeof RNIap.requestPurchase === 'function') {
          console.log('requestSubscription not available, using requestPurchase');
          purchase = await RNIap.requestPurchase({
            sku: productId,
          });
          console.log('requestPurchase returned:', JSON.stringify(purchase, null, 2));
        } else {
          throw new Error('No purchase method available in react-native-iap');
        }
      } else {
        // Android
        console.log('Platform: Android');
        if (typeof RNIap.requestSubscription === 'function') {
          // Android needs subscriptionOffers
          const offerToken = product?.subscriptionOfferDetails?.[0]?.offerToken || '';
          purchase = await RNIap.requestSubscription({
            sku: productId,
            subscriptionOffers: [{
              sku: productId,
              offerToken: offerToken,
            }],
          });
        } else {
          purchase = await RNIap.requestPurchase({ sku: productId });
        }
      }

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
        if (subscriptionSkus.includes(purchase.productId)) {
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
