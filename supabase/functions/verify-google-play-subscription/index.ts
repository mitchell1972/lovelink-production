import { createClient } from 'npm:@supabase/supabase-js@2';

const PACKAGE_NAME = 'com.mitchellagoma.lovelink.play2026';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SUPPORTED_PRODUCTS = new Set([
  'com.lovelinkcouples.premium.monthly',
  'com.lovelinkcouples.premium.yearly',
]);
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  // A canceled subscription remains entitled until Google's expiryTime.
  'SUBSCRIPTION_STATE_CANCELED',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const base64Url = (value: string | Uint8Array) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const pemToBytes = (pem: string) => {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

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

const createGoogleAccessToken = async () => {
  const rawCredentials = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (!rawCredentials) throw new Error('Google Play service account is not configured');

  const credentials = JSON.parse(rawCredentials);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google Play service account is incomplete');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  ));
  const assertion = `${unsignedToken}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google authorization failed (${response.status})`);
  }
  return payload.access_token as string;
};

const verifyWithGoogle = async (purchaseToken: string) => {
  const accessToken = await createGoogleAccessToken();
  const url = new URL(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`
  );
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const sha256 = async (value: string) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
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
    let purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : '';
    let requestedProductId = typeof body.productId === 'string' ? body.productId : '';

    if (action === 'refresh') {
      const { data: entitlement, error: entitlementError } = await admin
        .from('google_play_entitlements')
        .select('purchase_token, product_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (entitlementError) throw entitlementError;
      if (!entitlement) return json({ success: true, active: false, reason: 'no_entitlement' });
      purchaseToken = entitlement.purchase_token;
      requestedProductId = entitlement.product_id;
    }

    if (!purchaseToken || purchaseToken.length > 4096) {
      return json({ success: false, error: 'A valid Google Play purchase token is required' }, 400);
    }
    if (!SUPPORTED_PRODUCTS.has(requestedProductId)) {
      return json({ success: false, error: 'Unsupported Google Play subscription product' }, 400);
    }

    const { response, payload } = await verifyWithGoogle(purchaseToken);
    if (!response.ok) {
      const permanentlyInvalid = [400, 404, 410].includes(response.status);
      if (action === 'refresh' && permanentlyInvalid) {
        const { error: revokeError } = await admin.rpc('revoke_google_play_entitlement', {
          p_user_id: user.id,
          p_purchase_token: purchaseToken,
          p_subscription_state: `GOOGLE_HTTP_${response.status}`,
        });
        if (revokeError) throw revokeError;
        return json({ success: true, active: false, reason: 'not_active' });
      }
      const status = response.status === 401 || response.status === 403 ? 503 : 400;
      return json({
        success: false,
        error: status === 503
          ? 'Google Play verification is temporarily unavailable'
          : 'Google Play did not recognize this subscription',
      }, status);
    }

    const accountId = payload.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (!accountId || accountId !== user.id) {
      return json({ success: false, error: 'This Google Play purchase belongs to a different LoveLink account' }, 403);
    }

    const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
    const supportedLineItems = lineItems.filter((item: Record<string, unknown>) =>
      SUPPORTED_PRODUCTS.has(String(item.productId || ''))
    );
    const matchingLineItems = action === 'verify'
      ? supportedLineItems.filter((item: Record<string, unknown>) => item.productId === requestedProductId)
      : supportedLineItems;
    const lineItem = matchingLineItems.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      Date.parse(String(b.expiryTime || '')) - Date.parse(String(a.expiryTime || ''))
    )[0];

    if (!lineItem) {
      return json({ success: false, error: 'Verified purchase does not contain the selected LoveLink plan' }, 400);
    }

    const productId = String(lineItem.productId);
    const expiryTime = String(lineItem.expiryTime || '');
    const expiryMs = Date.parse(expiryTime);
    const subscriptionState = String(payload.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED');
    const isEntitled = ENTITLED_STATES.has(subscriptionState) && Number.isFinite(expiryMs) && expiryMs > Date.now();

    if (!isEntitled) {
      const { error: revokeError } = await admin.rpc('revoke_google_play_entitlement', {
        p_user_id: user.id,
        p_purchase_token: purchaseToken,
        p_subscription_state: subscriptionState,
      });
      if (revokeError) throw revokeError;
      return json({ success: true, active: false, reason: 'not_active', subscriptionState });
    }

    const offerDetails = lineItem.offerDetails || {};
    const { data: grantData, error: grantError } = await admin.rpc(
      'apply_verified_google_play_entitlement',
      {
        p_user_id: user.id,
        p_product_id: productId,
        p_purchase_token: purchaseToken,
        p_purchase_token_hash: await sha256(purchaseToken),
        p_linked_purchase_token: payload.linkedPurchaseToken || null,
        p_subscription_state: subscriptionState,
        p_expires_at: expiryTime,
        p_base_plan_id: offerDetails.basePlanId || null,
        p_offer_id: offerDetails.offerId || null,
        p_auto_renewing: Boolean(lineItem.autoRenewingPlan?.autoRenewEnabled),
      }
    );
    if (grantError) throw grantError;
    if (grantData?.success === false) {
      return json({ success: false, error: grantData.error || 'Entitlement could not be saved' }, 409);
    }

    return json({
      success: true,
      active: true,
      productId,
      expiresAt: expiryTime,
      subscriptionState,
      basePlanId: offerDetails.basePlanId || null,
      offerId: offerDetails.offerId || null,
    });
  } catch (error) {
    console.error('Google Play verification failed:', error instanceof Error ? error.message : String(error));
    return json({ success: false, error: 'Subscription verification failed. Please try again.' }, 500);
  }
});
