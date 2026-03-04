// Web stub for react-native-iap (native-only module)

export const PRODUCT_IDS = {
  MONTHLY: 'com.lovelinkcouples.premium.monthly',
  YEARLY: 'com.lovelinkcouples.premium.yearly',
};

class IAPServiceWeb {
  constructor() {
    this.products = [];
    this.isInitialized = false;
  }
  async initialize() { return false; }
  async getProducts() { return []; }
  getProductForPlan() { return null; }
  async purchaseSubscription() { return { success: false, error: 'IAP not available on web' }; }
  async restorePurchases() { return []; }
  async checkActiveSubscription() { return { isActive: false }; }
  async savePurchaseToDatabase() { return { success: false, error: 'IAP not available on web' }; }
  setupListeners() {}
  removeListeners() {}
  async endConnection() {}
  getProductPrice(productId) {
    return productId?.includes('yearly') ? '£39.99' : '£3.99';
  }
  getProduct() { return null; }
}

export const iapService = new IAPServiceWeb();
export const initializeIAP = () => iapService.initialize();
export const getProducts = () => iapService.getProducts();
export const purchaseSubscription = (productId) => iapService.purchaseSubscription(productId);
export const restorePurchases = () => iapService.restorePurchases();
export const checkActiveSubscription = () => iapService.checkActiveSubscription();
export const savePurchaseToDatabase = (userId, purchase, plan) =>
  iapService.savePurchaseToDatabase(userId, purchase, plan);
