import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  decodeAppleNotification,
  decodeAppleTransaction,
  describeAppleError,
  fetchAppleSubscription,
} from '../_shared/appStore.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
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
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const signedPayload = typeof body.signedPayload === 'string' ? body.signedPayload.trim() : '';
    if (!signedPayload || signedPayload.length > 131072) {
      return json({ success: false, error: 'A signed App Store notification is required' }, 400);
    }

    // Decoded without signature verification. The payload only supplies a
    // transaction id to look up; every entitlement decision below is made
    // from Apple's own subscription-status response fetched over TLS.
    let environment;
    let notification;
    try {
      ({ environment, notification } = decodeAppleNotification(signedPayload));
    } catch (decodeError) {
      console.error('App Store notification rejected:', describeAppleError(decodeError));
      return json({ success: false, error: 'Notification payload could not be decoded' }, 400);
    }
    const notificationData = notification.data;
    const signedTransactionInfo = notificationData?.signedTransactionInfo;

    // Apple's test notification is valid but intentionally has no transaction.
    if (notification.notificationType === 'TEST' && !signedTransactionInfo) {
      return json({ success: true, test: true });
    }
    if (typeof signedTransactionInfo !== 'string') {
      return json({ success: true, ignored: true, reason: 'no_transaction' });
    }

    const decodedTransaction = decodeAppleTransaction(signedTransactionInfo);
    if (decodedTransaction.environment !== environment) {
      return json({ success: false, error: 'Notification environment mismatch' }, 400);
    }

    const transaction = decodedTransaction.transaction;
    const originalTransactionId = String(transaction.originalTransactionId || '');
    if (!originalTransactionId) {
      return json({ success: false, error: 'Notification is missing its original transaction' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) throw new Error('Supabase URL is not configured');
    const admin = createClient(supabaseUrl, getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing, error: existingError } = await admin
      .from('app_store_entitlements')
      .select('user_id')
      .eq('original_transaction_id', originalTransactionId)
      .maybeSingle();
    if (existingError) throw existingError;

    // Re-query Apple instead of deriving anything from the notification body.
    // This makes duplicate and out-of-order notifications idempotent and keeps
    // unverified payload fields out of every decision.
    const subscription = await fetchAppleSubscription(originalTransactionId, environment);

    // Identity: an existing service-role mapping wins; otherwise only Apple's
    // own appAccountToken — never the unverified payload's — may pick a user.
    const userId = existing?.user_id || subscription.appAccountToken;
    if (!userId) {
      // Purchases made by old builds may not have an appAccountToken. Ignore
      // unmapped events rather than assigning them to an arbitrary user.
      return json({ success: true, ignored: true, reason: 'unmapped_transaction' });
    }
    if (subscription.appAccountToken && subscription.appAccountToken !== userId) {
      throw new Error('Current App Store ownership does not match the stored entitlement');
    }

    if (!subscription.active) {
      const { error: revokeError } = await admin.rpc('revoke_app_store_entitlement', {
        p_user_id: userId,
        p_original_transaction_id: subscription.originalTransactionId,
        p_subscription_status: subscription.status,
        p_expires_at: subscription.expiresAt,
      });
      if (revokeError) throw revokeError;
      return json({ success: true, active: false });
    }

    const { data: grantData, error: grantError } = await admin.rpc(
      'apply_verified_app_store_entitlement',
      {
        p_user_id: userId,
        p_product_id: subscription.productId,
        p_transaction_id: subscription.transactionId,
        p_original_transaction_id: subscription.originalTransactionId,
        p_app_account_token: subscription.appAccountToken || userId,
        p_subscription_status: subscription.status,
        p_expires_at: subscription.expiresAt,
        p_environment: subscription.environment,
        p_auto_renew_status: subscription.autoRenewStatus,
      }
    );
    if (grantError) throw grantError;
    if (grantData?.success === false) throw new Error(grantData.error || 'Entitlement update failed');

    return json({ success: true, active: true });
  } catch (error) {
    console.error('App Store notification processing failed:', describeAppleError(error));
    // A 500 response causes Apple to retry, which backfills the entitlement
    // once the underlying fault is fixed.
    return json({ success: false, error: 'Notification processing failed' }, 500);
  }
});
