// src/services/iapService.js
// Real In-App Purchase service using react-native-iap v14+

import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import { supabase } from '../config/supabase';
import { log, error } from '../utils/logger';

// Product IDs - MUST match App Store Connect and Google Play exactly
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
const validPlans = new Set(['monthly', 'yearly']);
const GOOGLE_PLAY_VERIFY_FUNCTION = 'verify-google-play-subscription';
const APP_STORE_VERIFY_FUNCTION = 'verify-app-store-subscription';
const PURCHASE_RESULT_TIMEOUT_MS = 120000;

const isSupportedSubscriptionProductId = (productId) =>
  typeof productId === 'string' &&
  (subscriptionSkusList.includes(productId) || legacySubscriptionSkus.includes(productId));

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

const findPurchaseForProduct = (result, productId) => {
  const purchases = Array.isArray(result) ? result : (result ? [result] : []);
  return purchases.find((purchase) => purchase?.productId === productId) || null;
};

const createPurchaseTimeoutError = () => Object.assign(
  new Error('The store did not confirm the purchase. If you approved it, use Restore Purchases.'),
  { code: 'E_PURCHASE_RESULT_TIMEOUT' }
);

const isPendingPurchase = (purchase) =>
  purchase?.purchaseState === 'pending' || Number(purchase?.purchaseStateAndroid) === 2;

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

// Google Play subscriptions use purchaseToken as their canonical transaction
// reference. transactionId is optional on Android in react-native-iap v14.
const getStorePurchaseReference = (purchase) =>
  purchase?.transactionId ||
  purchase?.purchaseToken ||
  purchase?.transactionReceipt ||
  null;

const getSignedAppleTransaction = (purchase) => [
  purchase?.purchaseToken,
  purchase?.transactionReceipt,
].find((candidate) =>
  typeof candidate === 'string' && candidate.split('.').length === 3
) || null;

// supabase-js reports every non-2xx Edge Function response as the unhelpful
// "Edge Function returned a non-2xx status code"; the server's actual reason
// is in the response body it carries.
const getFunctionErrorMessage = async (invokeError, fallback) => {
  try {
    const response = invokeError?.context;
    const body = typeof response?.clone === 'function'
      ? await response.clone().json()
      : (typeof response?.json === 'function' ? await response.json() : null);
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch (_) {
    // Body was not JSON or was already consumed; fall through.
  }
  return invokeError?.message || fallback;
};

const isSevenDayFreeTrialPhase = (phase) =>
  phase?.billingPeriod === 'P7D' && Number(phase?.priceAmountMicros) === 0;

const getAndroidOfferPhases = (offer) => {
  const phases = offer?.pricingPhases?.pricingPhaseList || offer?.pricingPhases || [];
  return Array.isArray(phases) ? phases : [];
};

const getAndroidSubscriptionOffers = (product) => {
  const modernOffers = Array.isArray(product?.subscriptionOfferDetailsAndroid)
    ? product.subscriptionOfferDetailsAndroid
    : [];
  const legacyOffers = Array.isArray(product?.subscriptionOfferDetails)
    ? product.subscriptionOfferDetails
    : [];

  // Some staged native builds expose an empty modern field alongside the
  // populated legacy field. Merge both shapes and de-duplicate by token.
  return [...modernOffers, ...legacyOffers].filter((offer, index, offers) =>
    typeof offer?.offerToken === 'string' &&
    offer.offerToken.length > 0 &&
    offers.findIndex((candidate) => candidate?.offerToken === offer.offerToken) === index
  );
};

const getAndroidTrialOffer = (product) =>
  getAndroidSubscriptionOffers(product).find((offer) =>
    getAndroidOfferPhases(offer).some(isSevenDayFreeTrialPhase)
  ) || null;

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

class IAPService {
  constructor() {
    this.products = [];
    this.purchaseUpdateSubscription = null;
    this.purchaseErrorSubscription = null;
    this.pendingPurchaseRequest = null;
    this.onPurchaseSuccess = null;
    this.onPurchaseError = null;
    this.isInitialized = false;
  }

  /**
   * Keep exactly one native listener pair alive for the IAP connection.
   * Older react-native-iap iOS bridges remove every native subscriber when a
   * single subscription is removed, which can otherwise lose a paid purchase
   * while the paywall is navigating or re-rendering.
   */
  ensurePurchaseListeners() {
    if (!this.purchaseUpdateSubscription &&
        typeof RNIap.purchaseUpdatedListener === 'function') {
      this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener((purchase) => {
        log('Purchase updated:', purchase);

        const pending = this.pendingPurchaseRequest;
        const matchingPurchase = pending
          ? findPurchaseForProduct(purchase, pending.productId)
          : null;
        if (pending && matchingPurchase) {
          this.settlePendingPurchase(pending, 'resolve', matchingPurchase);
          return;
        }

        // This can be a StoreKit transaction delivered after app startup. Its
        // owner must verify and persist it before finishing the transaction.
        if (hasPurchaseProof(purchase) && this.onPurchaseSuccess) {
          this.onPurchaseSuccess(purchase);
        }
      });
    }

    if (!this.purchaseErrorSubscription &&
        typeof RNIap.purchaseErrorListener === 'function') {
      this.purchaseErrorSubscription = RNIap.purchaseErrorListener((purchaseErr) => {
        error('Purchase error listener:', purchaseErr);

        const pending = this.pendingPurchaseRequest;
        if (pending) {
          this.settlePendingPurchase(pending, 'reject', purchaseErr);
          return;
        }

        if (this.onPurchaseError) {
          this.onPurchaseError(purchaseErr);
        }
      });
    }
  }

  settlePendingPurchase(pending, outcome, value) {
    if (!pending || this.pendingPurchaseRequest !== pending) return false;

    if (pending.resultTimeout) clearTimeout(pending.resultTimeout);
    this.pendingPurchaseRequest = null;
    pending[outcome](value);
    return true;
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
      // Trial availability changes the paywall copy, not the right to buy.
      // An account that already consumed its one-time introductory offer is
      // charged immediately, and the store's payment sheet shows those terms.
      if (!hasSevenDayFreeTrialOffer(product)) {
        log('Store product has no 7-day trial offer; continuing with a standard purchase.');
      } else if (!await isEligibleForSevenDayFreeTrialOffer(product)) {
        log('Store account already used the introductory offer; the store will charge immediately.');
      }
      log('Product details:', JSON.stringify(product, null, 2));

      if (typeof RNIap.requestPurchase !== 'function') {
        throw new Error('No purchase method available in react-native-iap');
      }

      // Google Play may return a paid base plan plus several offers. Prefer
      // the explicit seven-day, zero-price offer; Play only returns offers the
      // account is eligible for, so otherwise fall back to the base plan.
      const androidOffer = getAndroidTrialOffer(product) || getAndroidSubscriptionOffers(product)[0] || null;
      const offerToken = androidOffer?.offerToken || '';
      if ((Platform.OS === 'android' || product?.platform === 'android') && !offerToken) {
        // Google Play subscriptions cannot be purchased without an offer token.
        return {
          success: false,
          error: 'This subscription offer is not currently available from Google Play. Please try again later.',
        };
      }
      const modernRequest = {
        request: {
          apple: {
            sku: productId,
            // Entitlement is granted by the verified Supabase response first.
            // StoreKit must not finish the transaction before that succeeds.
            andDangerouslyFinishTransactionAutomatically: false,
            ...(appAccountToken ? { appAccountToken } : {}),
          },
          google: {
            skus: [productId],
            // react-native-iap 14.7 renamed this OpenIAP field. The backend
            // checks it to prevent one Play purchase being claimed by another
            // LoveLink account.
            ...(appAccountToken ? { obfuscatedAccountId: appAccountToken } : {}),
            ...(offerToken ? { subscriptionOffers: [{ sku: productId, offerToken }] } : {}),
          },
        },
        type: 'subs',
      };

      if (this.pendingPurchaseRequest) {
        return {
          success: false,
          error: 'A purchase is already in progress. Please wait for the store to finish.',
        };
      }

      // v14 normally delivers the result through listeners rather than the
      // request promise. Register the singleton listeners before checkout so
      // neither a fast StoreKit nor Google Play response can be lost.
      this.ensurePurchaseListeners();

      const purchase = await new Promise((resolve, reject) => {
        const pending = {
          productId,
          resolve,
          reject,
          resultTimeout: null,
        };
        this.pendingPurchaseRequest = pending;

        const handlePurchase = (candidate) => {
          const matchingPurchase = findPurchaseForProduct(candidate, productId);
          if (!matchingPurchase) return;
          this.settlePendingPurchase(pending, 'resolve', matchingPurchase);
        };

        // The native API is deliberately event-based and normally resolves
        // requestPurchase with an empty array. If a device drops the listener
        // event, reconcile once with the store before reporting a failure.
        pending.resultTimeout = setTimeout(async () => {
          try {
            const restored = await this.restorePurchases();
            const recoveredPurchase = findPurchaseForProduct(restored, productId);
            if (recoveredPurchase) {
              this.settlePendingPurchase(pending, 'resolve', recoveredPurchase);
              return;
            }
          } catch (restoreError) {
            error('Purchase recovery failed:', restoreError);
          }
          this.settlePendingPurchase(pending, 'reject', createPurchaseTimeoutError());
        }, PURCHASE_RESULT_TIMEOUT_MS);

        // Never fall back to the legacy SKU-only request. On Google Play that
        // request omits the required trial offer token and can select a paid
        // base plan instead of the promised seven-day free trial.
        // Start from an already-resolved promise so a synchronous native
        // bridge exception follows the same cleanup path as an async reject.
        Promise.resolve()
          .then(() => RNIap.requestPurchase(modernRequest))
          .then(handlePurchase)
          .catch((purchaseError) => {
            this.settlePendingPurchase(pending, 'reject', purchaseError);
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

      if (isPendingPurchase(purchase)) {
        return {
          success: false,
          pending: true,
          error: 'Your purchase is pending approval. Premium will unlock automatically when the store confirms it.',
        };
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
        return { success: false, error: 'Store service error. Please try again.' };
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
   * Reconcile the native store with the server before trusting cached premium.
   * Google and Apple verification endpoints write only store-provided state. A
   * refresh without a local purchase handles renewals, expiry, and revocation.
   */
  async syncSubscriptionEntitlement(userId) {
    if (!['android', 'ios'].includes(Platform.OS) || !userId) {
      return { success: true, skipped: true };
    }

    try {
      const purchases = await this.restorePurchases();
      const purchase = purchases
        .filter((candidate) => isSupportedSubscriptionProductId(candidate?.productId))
        .sort((a, b) => (b.transactionDate || 0) - (a.transactionDate || 0))[0];

      const hasPlatformProof = Platform.OS === 'android'
        ? Boolean(purchase?.purchaseToken)
        : Boolean(purchase?.transactionId || getSignedAppleTransaction(purchase));
      if (purchase && hasPlatformProof) {
        const plan = getPlanForProductId(purchase.productId);
        return await this.savePurchaseToDatabase(userId, purchase, plan);
      }

      const verificationFunction = Platform.OS === 'android'
        ? GOOGLE_PLAY_VERIFY_FUNCTION
        : APP_STORE_VERIFY_FUNCTION;
      const { data, error: invokeError } = await supabase.functions.invoke(
        verificationFunction,
        { body: { action: 'refresh' } }
      );

      if (invokeError) {
        return {
          success: false,
          error: await getFunctionErrorMessage(invokeError, 'Unable to refresh subscription'),
        };
      }
      if (data?.success === false) {
        return { success: false, error: data.error || 'Unable to refresh subscription' };
      }

      return { success: true, data };
    } catch (err) {
      // A store/network outage must not manufacture access or erase an
      // entitlement. The normal database expiry check remains fail-closed.
      error('Subscription reconciliation error:', err);
      return { success: false, error: err.message || 'Unable to refresh subscription' };
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
   * Verify a purchase on the server and persist its entitlement.
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

      const purchaseReference = getStorePurchaseReference(purchase);

      if (!purchaseReference) {
        return { success: false, error: 'Missing purchase transaction reference' };
      }

      if (Platform.OS === 'android') {
        if (!purchase.purchaseToken) {
          return { success: false, error: 'Missing Google Play purchase token' };
        }

        const { data, error: invokeError } = await supabase.functions.invoke(
          GOOGLE_PLAY_VERIFY_FUNCTION,
          {
            body: {
              action: 'verify',
              productId: purchase.productId,
              purchaseToken: purchase.purchaseToken,
            },
          }
        );

        if (invokeError) {
          return {
            success: false,
            error: await getFunctionErrorMessage(invokeError, 'Google Play could not verify this subscription'),
          };
        }
        if (!data?.success) {
          return {
            success: false,
            error: data?.error || 'Google Play could not verify this subscription',
          };
        }

        return { success: true, data };
      }

      const signedTransaction = getSignedAppleTransaction(purchase);
      if (!purchase.transactionId && !signedTransaction) {
        return { success: false, error: 'Missing App Store transaction proof' };
      }

      const { data, error: invokeError } = await supabase.functions.invoke(
        APP_STORE_VERIFY_FUNCTION,
        {
          body: {
            action: 'verify',
            productId: purchase.productId,
            transactionId: purchase.transactionId || null,
            signedTransaction,
          },
        }
      );

      if (invokeError) {
        return {
          success: false,
          error: await getFunctionErrorMessage(invokeError, 'The App Store could not verify this subscription'),
        };
      }
      if (!data?.success || !data?.active) {
        return {
          success: false,
          error: data?.error || 'The App Store could not verify an active subscription',
        };
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
    this.onPurchaseSuccess = onPurchaseSuccess || null;
    this.onPurchaseError = onPurchaseError || null;
    this.ensurePurchaseListeners();
  }

  /**
   * Remove purchase listeners
   */
  removeListeners() {
    const pending = this.pendingPurchaseRequest;
    if (pending) {
      this.settlePendingPurchase(
        pending,
        'reject',
        Object.assign(new Error('The store connection was closed.'), {
          code: 'E_IAP_CONNECTION_CLOSED',
        })
      );
    }
    if (this.purchaseUpdateSubscription) {
      this.purchaseUpdateSubscription.remove();
      this.purchaseUpdateSubscription = null;
    }
    if (this.purchaseErrorSubscription) {
      this.purchaseErrorSubscription.remove();
      this.purchaseErrorSubscription = null;
    }
    this.onPurchaseSuccess = null;
    this.onPurchaseError = null;
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
    return productId.includes('yearly') ? '£39.99' : '£4.79';
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
