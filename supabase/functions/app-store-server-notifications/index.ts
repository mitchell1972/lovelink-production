import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  fetchAppleSubscription,
  verifyNotificationForAnyEnvironment,
  verifyTransactionForAnyEnvironment,
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

    const { environment, notification } = await verifyNotificationForAnyEnvironment(signedPayload);
    const notificationData = notification.data;
    const signedTransactionInfo = notificationData?.signedTransactionInfo;

    // Apple's test notification is valid but intentionally has no transaction.
    if (notification.notificationType === 'TEST' && !signedTransactionInfo) {
      return json({ success: true, test: true });
    }
    if (typeof signedTransactionInfo !== 'string') {
      return json({ success: true, ignored: true, reason: 'no_transaction' });
    }

    const verifiedTransaction = await verifyTransactionForAnyEnvironment(signedTransactionInfo);
    if (verifiedTransaction.environment !== environment) {
      return json({ success: false, error: 'Notification environment mismatch' }, 400);
    }

    const transaction = verifiedTransaction.transaction;
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

    const appAccountToken = transaction.appAccountToken ? String(transaction.appAccountToken) : null;
    if (existing?.user_id && appAccountToken && existing.user_id !== appAccountToken) {
      throw new Error('App Store notification ownership mismatch');
    }
    const userId = appAccountToken || existing?.user_id;
    if (!userId) {
      // Purchases made by old builds may not have an appAccountToken. Ignore
      // unmapped events rather than assigning them to an arbitrary user.
      return json({ success: true, ignored: true, reason: 'unmapped_transaction' });
    }

    // Re-query Apple instead of deriving access from notification type alone.
    // This makes duplicate and out-of-order notifications idempotent.
    const subscription = await fetchAppleSubscription(originalTransactionId, environment);
    if (subscription.appAccountToken && subscription.appAccountToken !== userId) {
      throw new Error('Current App Store ownership does not match the notification');
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
    console.error(
      'App Store notification processing failed:',
      error instanceof Error ? error.message : String(error)
    );
    // A 500 response causes Apple to retry transient processing failures.
    return json({ success: false, error: 'Notification processing failed' }, 500);
  }
});
