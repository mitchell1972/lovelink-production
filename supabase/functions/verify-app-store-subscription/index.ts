import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  APPLE_SUPPORTED_PRODUCTS,
  Environment,
  decodeAppleTransaction,
  describeAppleError,
  fetchAppleSubscription,
  isAppleCredentialError,
} from '../_shared/appStore.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const getServiceRoleKey = () => {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;

  const configured = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  const candidate = configured.service_role || configured.default || Object.values(configured)[0];
  if (typeof candidate !== 'string' || !candidate) {
    throw new Error('Supabase service key is not configured');
  }
  return candidate;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const authorization = req.headers.get('Authorization') || '';
    const accessToken = authorization.replace(/^Bearer\s+/i, '');
    if (!accessToken) return json({ success: false, error: 'Authentication required' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) throw new Error('Supabase URL is not configured');
    const admin = createClient(supabaseUrl, getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    const user = userData?.user;
    if (userError || !user) return json({ success: false, error: 'Invalid session' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action === 'refresh' ? 'refresh' : 'verify';
    const requestedProductId = typeof body.productId === 'string' ? body.productId : '';
    let transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
    const signedTransaction = typeof body.signedTransaction === 'string'
      ? body.signedTransaction.trim()
      : '';
    let environmentHint: Environment | undefined;
    let storedOriginalTransactionId = '';

    if (action === 'refresh') {
      const { data: entitlement, error: entitlementError } = await admin
        .from('app_store_entitlements')
        .select('original_transaction_id, environment')
        .eq('user_id', user.id)
        .maybeSingle();
      if (entitlementError) throw entitlementError;
      if (!entitlement) return json({ success: true, active: false, reason: 'no_entitlement' });

      storedOriginalTransactionId = entitlement.original_transaction_id;
      transactionId = entitlement.original_transaction_id;
      environmentHint = entitlement.environment === Environment.SANDBOX
        ? Environment.SANDBOX
        : Environment.PRODUCTION;
    } else {
      if (!APPLE_SUPPORTED_PRODUCTS.has(requestedProductId)) {
        return json({ success: false, error: 'Unsupported App Store subscription product' }, 400);
      }

      if (signedTransaction) {
        if (signedTransaction.length > 32768) {
          return json({ success: false, error: 'App Store transaction is too large' }, 400);
        }
        // Decoded without signature verification — used for fast-fail checks
        // and hints only. Ownership and entitlement are decided further down
        // against Apple's own subscription-status response.
        const decodedDeviceTransaction = decodeAppleTransaction(signedTransaction);
        environmentHint = decodedDeviceTransaction.environment;
        const decoded = decodedDeviceTransaction.transaction;

        if (!APPLE_SUPPORTED_PRODUCTS.has(String(decoded.productId || '')) ||
            decoded.productId !== requestedProductId) {
          return json({ success: false, error: 'Verified App Store product does not match the selected plan' }, 400);
        }
        if (decoded.appAccountToken && decoded.appAccountToken !== user.id) {
          return json({ success: false, error: 'This App Store purchase belongs to a different LoveLink account' }, 403);
        }

        const signedTransactionId = String(decoded.transactionId || '');
        if (transactionId && signedTransactionId && transactionId !== signedTransactionId) {
          return json({ success: false, error: 'App Store transaction identifiers do not match' }, 400);
        }
        transactionId = signedTransactionId || transactionId;
      }

      if (!transactionId || transactionId.length > 256) {
        return json({ success: false, error: 'A valid App Store transaction is required' }, 400);
      }
    }

    const subscription = await fetchAppleSubscription(transactionId, environmentHint);
    if (action === 'verify' && subscription.productId !== requestedProductId) {
      return json({ success: false, error: 'Verified App Store subscription does not match the selected plan' }, 400);
    }

    // New purchases are cryptographically bound to the authenticated user
    // through StoreKit's appAccountToken. Purchases made by builds that did
    // not pass a token cannot be, so for those, possession of the store
    // transaction on this device is the proof — unless another LoveLink
    // account has already claimed the same subscription.
    if (action === 'verify' && subscription.appAccountToken && subscription.appAccountToken !== user.id) {
      return json({ success: false, error: 'This App Store purchase belongs to a different LoveLink account' }, 403);
    }
    if (action === 'verify' && !subscription.appAccountToken) {
      const { data: existingOwner, error: ownerError } = await admin
        .from('app_store_entitlements')
        .select('user_id')
        .eq('original_transaction_id', subscription.originalTransactionId)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (existingOwner && existingOwner.user_id !== user.id) {
        return json({ success: false, error: 'This App Store purchase belongs to a different LoveLink account' }, 403);
      }
    }
    if (action === 'refresh' && subscription.appAccountToken && subscription.appAccountToken !== user.id) {
      return json({ success: false, error: 'Stored App Store ownership no longer matches this account' }, 403);
    }

    if (!subscription.active) {
      const { error: revokeError } = await admin.rpc('revoke_app_store_entitlement', {
        p_user_id: user.id,
        p_original_transaction_id: subscription.originalTransactionId || storedOriginalTransactionId,
        p_subscription_status: subscription.status,
        p_expires_at: subscription.expiresAt,
      });
      if (revokeError) throw revokeError;
      return json({
        success: true,
        active: false,
        reason: 'not_active',
        subscriptionStatus: subscription.status,
      });
    }

    const { data: grantData, error: grantError } = await admin.rpc(
      'apply_verified_app_store_entitlement',
      {
        p_user_id: user.id,
        p_product_id: subscription.productId,
        p_transaction_id: subscription.transactionId,
        p_original_transaction_id: subscription.originalTransactionId,
        p_app_account_token: subscription.appAccountToken || user.id,
        p_subscription_status: subscription.status,
        p_expires_at: subscription.expiresAt,
        p_environment: subscription.environment,
        p_auto_renew_status: subscription.autoRenewStatus,
      }
    );
    if (grantError) throw grantError;
    if (grantData?.success === false) {
      return json({ success: false, error: grantData.error || 'Entitlement could not be saved' }, 409);
    }

    return json({
      success: true,
      active: true,
      productId: subscription.productId,
      expiresAt: subscription.expiresAt,
      subscriptionStatus: subscription.status,
      environment: subscription.environment,
    });
  } catch (error) {
    const message = describeAppleError(error);
    console.error('App Store verification failed:', message);
    // Misconfigured secrets and Apple credential rejections are LoveLink's
    // fault, not the customer's; report them distinctly so the alert is actionable.
    const notConfigured =
      /APP_STORE_(PRIVATE_KEY_BASE64|KEY_ID|ISSUER_ID) is not configured/.test(message) ||
      isAppleCredentialError(error);
    return json({
      success: false,
      error: notConfigured
        ? 'App Store verification is not configured. Please contact LoveLink support.'
        : 'Subscription verification failed. Please try again.',
    }, notConfigured ? 503 : 500);
  }
});
