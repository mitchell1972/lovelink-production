import { SignJWT, decodeJwt, importPKCS8 } from 'npm:jose@5.9.6';
import { Buffer } from 'node:buffer';

// TRUST MODEL
//
// Supabase Edge Functions run on Deno, whose node:crypto lacks the pieces
// @apple/app-store-server-library needs (jsonwebtoken rejects P-256 keys it
// reports as "p256", and X509Certificate is unimplemented), so Apple's JWS
// certificate-chain verification cannot run on this runtime.
//
// Instead of hand-rolling PKI, entitlement decisions are anchored elsewhere:
// every grant or revocation is computed ONLY from a subscription-status
// response fetched directly from Apple's App Store Server API over TLS
// (fetchAppleSubscription below). Signed payloads received from devices or
// webhooks are DECODED WITHOUT SIGNATURE VERIFICATION and used purely as
// lookup hints (transaction ids, environment) and fast-fail UX checks.
// Nothing decoded from an unverified payload may decide ownership or access.

export const APPLE_BUNDLE_ID = 'com.mitchellagoma.lovelink';
export const APPLE_SUPPORTED_PRODUCTS = new Set([
  'com.lovelinkcouples.premium.monthly',
  'com.lovelinkcouples.premium.yearly',
]);

export const Environment = {
  PRODUCTION: 'Production',
  SANDBOX: 'Sandbox',
} as const;
export type Environment = typeof Environment[keyof typeof Environment];

const requiredEnvironmentValue = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const getSigningKey = () => Buffer.from(
  requiredEnvironmentValue('APP_STORE_PRIVATE_KEY_BASE64'),
  'base64'
).toString('utf8');

export class AppStoreApiError extends Error {
  readonly httpStatusCode: number;
  readonly apiError: number | null;

  constructor(httpStatusCode: number, apiError: number | null) {
    super(`App Store Server API request failed (HTTP ${httpStatusCode}${
      apiError == null ? '' : `, Apple error ${apiError}`})`);
    this.httpStatusCode = httpStatusCode;
    this.apiError = apiError;
  }
}

export const describeAppleError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'httpStatusCode' in error) {
    const httpStatusCode = Number((error as { httpStatusCode?: unknown }).httpStatusCode);
    const apiError = (error as { apiError?: unknown }).apiError;
    return `App Store Server API request failed (HTTP ${httpStatusCode}${
      apiError == null ? '' : `, Apple error ${apiError}`})`;
  }
  return error instanceof Error ? error.constructor.name : String(error);
};

/** True when Apple rejected our App Store Server API credentials (key/issuer). */
export const isAppleCredentialError = (error: unknown): boolean =>
  error instanceof AppStoreApiError && error.httpStatusCode === 401;

const API_BASE_URLS: Record<Environment, string> = {
  [Environment.PRODUCTION]: 'https://api.storekit.itunes.apple.com',
  [Environment.SANDBOX]: 'https://api.storekit-sandbox.itunes.apple.com',
};

const environments: Environment[] = [Environment.PRODUCTION, Environment.SANDBOX];

const mintAppStoreApiToken = async () => {
  const privateKey = await importPKCS8(getSigningKey(), 'ES256');
  const issuedAt = Math.floor(Date.now() / 1000);
  return await new SignJWT({ bid: APPLE_BUNDLE_ID })
    .setProtectedHeader({
      alg: 'ES256',
      kid: requiredEnvironmentValue('APP_STORE_KEY_ID'),
      typ: 'JWT',
    })
    .setIssuer(requiredEnvironmentValue('APP_STORE_ISSUER_ID'))
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .setAudience('appstoreconnect-v1')
    .sign(privateKey);
};

const getAllSubscriptionStatuses = async (
  transactionId: string,
  environment: Environment
): Promise<Record<string, unknown>> => {
  const response = await fetch(
    `${API_BASE_URLS[environment]}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${await mintAppStoreApiToken()}` } }
  );
  if (!response.ok) {
    let errorCode: number | null = null;
    try {
      const body = await response.json();
      errorCode = Number.isFinite(Number(body?.errorCode)) ? Number(body.errorCode) : null;
    } catch (_) {
      // Non-JSON error body; the HTTP status is still meaningful.
    }
    throw new AppStoreApiError(response.status, errorCode);
  }
  return await response.json();
};

/**
 * Decode a compact Apple JWS payload WITHOUT verifying its signature.
 * See the trust-model note above: outputs are hints, never authorization.
 */
const decodeAppleJws = (jws: string): Record<string, unknown> => {
  try {
    return decodeJwt(jws) as Record<string, unknown>;
  } catch (_) {
    throw new Error('Apple signed payload could not be decoded');
  }
};

const asEnvironment = (value: unknown): Environment =>
  value === Environment.SANDBOX ? Environment.SANDBOX : Environment.PRODUCTION;

/** Decode a signedTransaction from a device or an Apple response (unverified). */
export const decodeAppleTransaction = (signedTransaction: string) => {
  const transaction = decodeAppleJws(signedTransaction);
  if (String(transaction.bundleId || '') !== APPLE_BUNDLE_ID) {
    throw new Error('Apple transaction is for a different app');
  }
  return {
    environment: asEnvironment(transaction.environment),
    transaction,
  };
};

/** Decode an App Store Server Notification signedPayload (unverified). */
export const decodeAppleNotification = (signedPayload: string) => {
  const notification = decodeAppleJws(signedPayload);
  const data = (notification.data ?? notification.summary ?? {}) as Record<string, unknown>;
  const bundleId = data.bundleId;
  if (bundleId !== undefined && String(bundleId) !== APPLE_BUNDLE_ID) {
    throw new Error('Apple notification is for a different app');
  }
  return {
    environment: asEnvironment(data.environment),
    notification,
  };
};

type AppleSubscriptionSnapshot = {
  active: boolean;
  environment: Environment;
  status: number;
  productId: string;
  transactionId: string;
  originalTransactionId: string;
  appAccountToken: string | null;
  expiresAt: string;
  autoRenewStatus: number | null;
};

const readStatusResponse = (
  response: Record<string, unknown>,
  environment: Environment
): AppleSubscriptionSnapshot => {
  const candidates: AppleSubscriptionSnapshot[] = [];
  const groups = Array.isArray(response.data) ? response.data : [];

  for (const group of groups) {
    const transactions = Array.isArray(group?.lastTransactions) ? group.lastTransactions : [];
    for (const item of transactions) {
      if (typeof item?.signedTransactionInfo !== 'string') continue;

      // This JWS arrived inside Apple's own TLS response, which is the trust
      // anchor here; its signature is not re-verified (see trust model note).
      const transaction = decodeAppleJws(item.signedTransactionInfo);
      if (!APPLE_SUPPORTED_PRODUCTS.has(String(transaction.productId || ''))) continue;

      let autoRenewStatus: number | null = null;
      if (typeof item?.signedRenewalInfo === 'string') {
        const renewal = decodeAppleJws(item.signedRenewalInfo);
        autoRenewStatus = Number.isFinite(Number(renewal.autoRenewStatus))
          ? Number(renewal.autoRenewStatus)
          : null;
      }

      const status = Number(item.status);
      const expiresMs = Number(transaction.expiresDate);
      const revoked = Number.isFinite(Number(transaction.revocationDate));
      const active = [1, 4].includes(status) &&
        Number.isFinite(expiresMs) &&
        expiresMs > Date.now() &&
        !revoked;

      candidates.push({
        active,
        environment,
        status,
        productId: String(transaction.productId),
        transactionId: String(transaction.transactionId || ''),
        originalTransactionId: String(transaction.originalTransactionId || ''),
        appAccountToken: transaction.appAccountToken ? String(transaction.appAccountToken) : null,
        expiresAt: new Date(expiresMs).toISOString(),
        autoRenewStatus,
      });
    }
  }

  const selected = candidates.sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return Date.parse(right.expiresAt) - Date.parse(left.expiresAt);
  })[0];

  if (!selected?.transactionId || !selected.originalTransactionId) {
    throw new Error('Apple did not return a supported LoveLink subscription');
  }
  return selected;
};

export const fetchAppleSubscription = async (
  transactionId: string,
  environmentHint?: Environment
): Promise<AppleSubscriptionSnapshot> => {
  const candidates = environmentHint ? [environmentHint] : environments;
  let lastError: unknown;

  for (const environment of candidates) {
    try {
      const response = await getAllSubscriptionStatuses(transactionId, environment);
      return readStatusResponse(response, environment);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Apple subscription status is unavailable');
};
