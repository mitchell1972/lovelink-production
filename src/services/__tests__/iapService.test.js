const mockRNIap = {
  initConnection: jest.fn(),
  fetchProducts: jest.fn(),
  requestPurchase: jest.fn(),
  purchaseUpdatedListener: jest.fn(),
  purchaseErrorListener: jest.fn(),
  getActiveSubscriptions: jest.fn(),
  getAvailablePurchases: jest.fn(),
  finishTransaction: jest.fn(),
  isEligibleForIntroOfferIOS: jest.fn(),
  isUserCancelledError: jest.fn(),
};

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: (values) => values.ios,
  },
}));

jest.mock('react-native-iap', () => mockRNIap);
jest.mock('../../config/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const { Platform } = require('react-native');

const {
  iapService,
  PRODUCT_IDS,
} = require('../iapService');

const TEST_ACCOUNT_TOKEN = 'test-account-token';

const subscription = (productId) => ({
  productId,
  transactionId: 'transaction-1',
  purchaseToken: 'signed-purchase-token',
});

describe('iapService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    iapService.products = [];
    iapService.isInitialized = false;
    mockRNIap.initConnection.mockResolvedValue(true);
    mockRNIap.purchaseUpdatedListener.mockReturnValue({ remove: jest.fn() });
    mockRNIap.purchaseErrorListener.mockReturnValue({ remove: jest.fn() });
    mockRNIap.isEligibleForIntroOfferIOS.mockResolvedValue(true);
    mockRNIap.isUserCancelledError.mockReturnValue(false);
  });

  it('never substitutes a different plan when the selected product is unavailable', () => {
    iapService.products = [{ productId: PRODUCT_IDS.MONTHLY }];

    expect(iapService.getProductForPlan('yearly')).toBeNull();
    expect(iapService.getProductForPlan('monthly')).toEqual({ productId: PRODUCT_IDS.MONTHLY });
  });

  it('normalizes the v14 iOS product id and reads its subscription group for eligibility', async () => {
    mockRNIap.fetchProducts.mockResolvedValue([{
      id: PRODUCT_IDS.MONTHLY,
      introductoryPricePaymentModeIOS: 'free-trial',
      introductoryPriceSubscriptionPeriodIOS: 'week',
      introductoryPriceNumberOfPeriodsIOS: '1',
      introductoryPriceAsAmountIOS: '0',
      jsonRepresentationIOS: JSON.stringify({
        attributes: { subscriptionFamilyId: '21868415' },
      }),
    }]);

    const products = await iapService.getProducts();
    const eligible = await iapService.isEligibleForSevenDayFreeTrial(products[0]);

    expect(products[0].productId).toBe(PRODUCT_IDS.MONTHLY);
    expect(eligible).toBe(true);
    expect(mockRNIap.isEligibleForIntroOfferIOS).toHaveBeenCalledWith('21868415');
  });

  it('waits for a v14 purchase response and leaves its transaction open for entitlement delivery', async () => {
    const purchase = subscription(PRODUCT_IDS.MONTHLY);
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      subscriptionInfoIOS: {
        subscriptionGroupId: '21868415',
        introductoryOffer: { price: 0, period: { value: 1, unit: 'week' } },
      },
    }];
    mockRNIap.requestPurchase.mockResolvedValue(purchase);

    const result = await iapService.purchaseSubscription(
      PRODUCT_IDS.MONTHLY,
      TEST_ACCOUNT_TOKEN
    );

    expect(result).toEqual({ success: true, purchase });
    expect(mockRNIap.requestPurchase).toHaveBeenCalledWith({
      request: {
        apple: {
          sku: PRODUCT_IDS.MONTHLY,
          appAccountToken: TEST_ACCOUNT_TOKEN,
        },
        google: {
          skus: [PRODUCT_IDS.MONTHLY],
          obfuscatedAccountIdAndroid: TEST_ACCOUNT_TOKEN,
        },
      },
      type: 'subs',
    });
    expect(mockRNIap.finishTransaction).not.toHaveBeenCalled();
    expect(mockRNIap.isEligibleForIntroOfferIOS).toHaveBeenCalledWith('21868415');
  });

  it('refuses to purchase when the Apple account has already used its intro eligibility', async () => {
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      subscriptionInfoIOS: {
        subscriptionGroupId: '21868415',
        introductoryOffer: { price: 0, period: { value: 1, unit: 'week' } },
      },
    }];
    mockRNIap.isEligibleForIntroOfferIOS.mockResolvedValue(false);

    const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(result.error).toMatch(/could charge immediately/i);
    expect(mockRNIap.requestPurchase).not.toHaveBeenCalled();
  });

  it('refuses a paid subscription offer when the 7-day free trial is unavailable', async () => {
    iapService.products = [{ productId: PRODUCT_IDS.MONTHLY }];

    const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(result.error).toMatch(/7-day free trial/i);
    expect(mockRNIap.requestPurchase).not.toHaveBeenCalled();
  });

  it('treats the v14 user-cancelled code as a quiet cancellation', async () => {
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      subscriptionInfoIOS: {
        subscriptionGroupId: '21868415',
        introductoryOffer: { price: 0, period: { value: 1, unit: 'week' } },
      },
    }];
    mockRNIap.requestPurchase.mockRejectedValue({
      code: 'user-cancelled',
      message: 'User cancelled the purchase flow',
    });

    const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(result).toEqual({
      success: false,
      error: 'Purchase cancelled',
      cancelled: true,
    });
  });

  it('recognizes the StoreKit free-trial fields returned by earlier native builds', () => {
    expect(iapService.hasSevenDayFreeTrial({
      productId: PRODUCT_IDS.MONTHLY,
      introductoryPricePaymentModeIOS: 'free-trial',
      introductoryPriceSubscriptionPeriodIOS: 'week',
      introductoryPriceNumberOfPeriodsIOS: '1',
      introductoryPriceAsAmountIOS: '0',
    })).toBe(true);
  });

  it('selects the seven-day free Android offer instead of the first paid offer', async () => {
    const purchase = subscription(PRODUCT_IDS.MONTHLY);
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      platform: 'android',
      subscriptionOfferDetailsAndroid: [
        {
          offerToken: 'paid-base-plan',
          pricingPhases: { pricingPhaseList: [{ billingPeriod: 'P1M', priceAmountMicros: '3990000' }] },
        },
        {
          offerToken: 'seven-day-trial',
          pricingPhases: {
            pricingPhaseList: [
              { billingPeriod: 'P7D', priceAmountMicros: '0' },
              { billingPeriod: 'P1M', priceAmountMicros: '3990000' },
            ],
          },
        },
      ],
    }];
    mockRNIap.requestPurchase.mockResolvedValue(purchase);

    await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(mockRNIap.requestPurchase).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        google: expect.objectContaining({
          obfuscatedAccountIdAndroid: 'user-1',
          subscriptionOffers: [{ sku: PRODUCT_IDS.MONTHLY, offerToken: 'seven-day-trial' }],
        }),
      }),
    }));
  });

  it('uses a legacy Android offer response when the modern offer field is empty', async () => {
    const purchase = subscription(PRODUCT_IDS.MONTHLY);
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      platform: 'android',
      subscriptionOfferDetailsAndroid: [],
      subscriptionOfferDetails: [{
        offerToken: 'legacy-seven-day-trial',
        pricingPhases: [
          { billingPeriod: 'P7D', priceAmountMicros: '0' },
          { billingPeriod: 'P1M', priceAmountMicros: '3990000' },
        ],
      }],
    }];
    mockRNIap.requestPurchase.mockResolvedValue(purchase);

    const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(result).toEqual({ success: true, purchase });
    expect(mockRNIap.requestPurchase).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        google: expect.objectContaining({
          subscriptionOffers: [{
            sku: PRODUCT_IDS.MONTHLY,
            offerToken: 'legacy-seven-day-trial',
          }],
        }),
      }),
    }));
  });

  it('refuses an Android free-trial phase that has no offer token', async () => {
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      platform: 'android',
      subscriptionOfferDetailsAndroid: [{
        pricingPhases: {
          pricingPhaseList: [{ billingPeriod: 'P7D', priceAmountMicros: '0' }],
        },
      }],
    }];

    const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(result.error).toMatch(/7-day free trial/i);
    expect(mockRNIap.requestPurchase).not.toHaveBeenCalled();
  });

  it('does not retry a failed modern request without the Google Play offer token', async () => {
    iapService.products = [{
      productId: PRODUCT_IDS.MONTHLY,
      platform: 'android',
      subscriptionOfferDetailsAndroid: [{
        offerToken: 'seven-day-trial',
        pricingPhases: {
          pricingPhaseList: [{ billingPeriod: 'P7D', priceAmountMicros: '0' }],
        },
      }],
    }];
    mockRNIap.requestPurchase.mockRejectedValue({
      code: 'E_MISSING_PURCHASE_REQUEST',
      message: 'Missing purchase request configuration',
    });

    const result = await iapService.purchaseSubscription(PRODUCT_IDS.MONTHLY, 'user-1');

    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(mockRNIap.requestPurchase).toHaveBeenCalledTimes(1);
  });

  it('restores only active subscription entitlements', async () => {
    mockRNIap.getActiveSubscriptions.mockResolvedValue([
      { ...subscription(PRODUCT_IDS.MONTHLY), isActive: true },
      { ...subscription(PRODUCT_IDS.YEARLY), isActive: false },
      { ...subscription('unrelated.product'), isActive: true },
    ]);

    const purchases = await iapService.restorePurchases();

    expect(purchases).toEqual([
      expect.objectContaining({ productId: PRODUCT_IDS.MONTHLY }),
    ]);
    expect(mockRNIap.getActiveSubscriptions).toHaveBeenCalledWith([
      PRODUCT_IDS.MONTHLY,
      PRODUCT_IDS.YEARLY,
    ]);
  });

  it('rejects a database grant whose plan does not match the purchased product', async () => {
    const result = await iapService.savePurchaseToDatabase(
      TEST_ACCOUNT_TOKEN,
      subscription(PRODUCT_IDS.MONTHLY),
      'yearly'
    );

    expect(result).toEqual({
      success: false,
      error: 'Subscription plan does not match the purchased product',
    });
  });

  it('sends Android purchase tokens to the server verifier instead of the legacy grant RPC', async () => {
    const { supabase } = require('../../config/supabase');
    Platform.OS = 'android';
    supabase.functions.invoke.mockResolvedValue({
      data: { success: true, active: true, expiresAt: '2099-01-01T00:00:00Z' },
      error: null,
    });

    const result = await iapService.savePurchaseToDatabase(
      TEST_ACCOUNT_TOKEN,
      {
        productId: PRODUCT_IDS.MONTHLY,
        transactionId: null,
        purchaseToken: 'google-play-purchase-token',
      },
      'monthly'
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'verify-google-play-subscription',
      {
        body: {
          action: 'verify',
          productId: PRODUCT_IDS.MONTHLY,
          purchaseToken: 'google-play-purchase-token',
        },
      }
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('does not grant Android premium without a Google Play purchase token', async () => {
    const { supabase } = require('../../config/supabase');
    Platform.OS = 'android';

    const result = await iapService.savePurchaseToDatabase(
      TEST_ACCOUNT_TOKEN,
      {
        productId: PRODUCT_IDS.MONTHLY,
        transactionId: 'GPA.1234',
      },
      'monthly'
    );

    expect(result).toEqual({ success: false, error: 'Missing Google Play purchase token' });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('asks the backend to refresh entitlement when Play returns no local subscription', async () => {
    const { supabase } = require('../../config/supabase');
    Platform.OS = 'android';
    mockRNIap.getActiveSubscriptions.mockResolvedValue([]);
    supabase.functions.invoke.mockResolvedValue({
      data: { success: true, active: false, reason: 'no_entitlement' },
      error: null,
    });

    const result = await iapService.syncSubscriptionEntitlement('user-1');

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'verify-google-play-subscription',
      { body: { action: 'refresh' } }
    );
  });

  it('sends iOS transactions to the Apple server verifier and never calls the legacy grant RPC', async () => {
    const { supabase } = require('../../config/supabase');
    supabase.functions.invoke.mockResolvedValue({
      data: { success: true, active: true, expiresAt: '2099-01-01T00:00:00Z' },
      error: null,
    });

    const result = await iapService.savePurchaseToDatabase(
      TEST_ACCOUNT_TOKEN,
      subscription(PRODUCT_IDS.MONTHLY),
      'monthly'
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'verify-app-store-subscription',
      {
        body: {
          action: 'verify',
          productId: PRODUCT_IDS.MONTHLY,
          transactionId: 'transaction-1',
          signedTransaction: null,
        },
      }
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('asks the backend to refresh an iOS entitlement when StoreKit returns no local subscription', async () => {
    const { supabase } = require('../../config/supabase');
    mockRNIap.getActiveSubscriptions.mockResolvedValue([]);
    supabase.functions.invoke.mockResolvedValue({
      data: { success: true, active: false, reason: 'no_entitlement' },
      error: null,
    });

    const result = await iapService.syncSubscriptionEntitlement('user-1');

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'verify-app-store-subscription',
      { body: { action: 'refresh' } }
    );
  });

  it('does not finish listener transactions before the entitlement callback verifies them', async () => {
    const onPurchaseSuccess = jest.fn();
    let listener;
    mockRNIap.purchaseUpdatedListener.mockImplementation((callback) => {
      listener = callback;
      return { remove: jest.fn() };
    });

    iapService.setupListeners(onPurchaseSuccess, jest.fn());
    await listener(subscription(PRODUCT_IDS.MONTHLY));

    expect(onPurchaseSuccess).toHaveBeenCalledWith(subscription(PRODUCT_IDS.MONTHLY));
    expect(mockRNIap.finishTransaction).not.toHaveBeenCalled();
  });
});
