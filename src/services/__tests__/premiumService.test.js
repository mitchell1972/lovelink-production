const mockSupabase = { from: jest.fn() };

jest.mock('../../config/supabase', () => ({ supabase: mockSupabase }));

const {
  checkMomentsLimit,
  formatPremiumExpiry,
  getPremiumStatus,
  getSubscriptionAccessStatus,
} = require('../premiumService');

const buildProfile = (overrides = {}) => ({
  is_premium: false,
  premium_since: null,
  premium_expires: null,
  premium_plan: null,
  premium_granted_by: null,
  partner_id: null,
  ...overrides,
});

const setupSupabase = ({
  userId = 'user-1',
  userProfile = buildProfile(),
  partnerId = 'user-2',
  partnerProfile = null,
  partnershipRows = [],
  momentsCount = 0,
}) => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_column, value) => ({
            single: async () => {
              if (value === userId) return { data: userProfile, error: null };
              if (value === partnerId && partnerProfile) return { data: partnerProfile, error: null };
              return { data: null, error: { code: 'PGRST116' } };
            },
          }),
        }),
      };
    }

    if (table === 'partnerships') {
      return {
        select: () => ({
          or: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: partnershipRows, error: null }) }),
            }),
          }),
        }),
      };
    }

    if (table === 'moments') {
      return { select: () => ({ eq: async () => ({ count: momentsCount, error: null }) }) };
    }

    throw new Error(`Unexpected table mock request: ${table}`);
  });
};

describe('premiumService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('formats premium expiry dates', () => {
    expect(formatPremiumExpiry(null)).toBe('Never');
  });

  it('requires a subscription even for a newly created account', async () => {
    setupSupabase({});

    await expect(getSubscriptionAccessStatus('user-1')).resolves.toMatchObject({
      hasAccess: false,
      isPremium: false,
      reason: 'subscription_required',
    });
  });

  it('grants core access to an active subscription', async () => {
    setupSupabase({
      userProfile: buildProfile({
        is_premium: true,
        premium_expires: '2099-01-01T00:00:00.000Z',
        premium_plan: 'monthly',
      }),
    });

    await expect(getSubscriptionAccessStatus('user-1')).resolves.toMatchObject({
      hasAccess: true,
      isPremium: true,
      reason: 'subscription',
    });
  });

  it('does not treat a premium flag without a verified expiry as permanent access', async () => {
    setupSupabase({
      userProfile: buildProfile({
        is_premium: true,
        premium_expires: null,
        premium_plan: 'yearly',
      }),
    });

    await expect(getSubscriptionAccessStatus('user-1')).resolves.toMatchObject({
      hasAccess: false,
      reason: 'subscription_required',
    });
  });

  it('does not treat a copied partner grant as the user’s own subscription', async () => {
    setupSupabase({
      userProfile: buildProfile({
        is_premium: true,
        premium_expires: '2099-01-01T00:00:00.000Z',
        premium_plan: 'yearly',
        premium_granted_by: 'former-partner',
      }),
    });

    await expect(getSubscriptionAccessStatus('user-1')).resolves.toMatchObject({
      hasAccess: false,
      reason: 'subscription_required',
    });
  });

  it('uses a linked partner’s active subscription', async () => {
    setupSupabase({
      userProfile: buildProfile(),
      partnerProfile: buildProfile({
        is_premium: true,
        premium_expires: '2099-01-01T00:00:00.000Z',
        premium_plan: 'yearly',
        name: 'Alex',
      }),
      partnershipRows: [{ user1_id: 'user-1', user2_id: 'user-2' }],
    });

    await expect(getPremiumStatus('user-1')).resolves.toMatchObject({
      isPremium: true,
      source: 'partner',
      partnerName: 'Alex',
    });
  });

  it('does not use a stale profile partner id after the active partnership ended', async () => {
    setupSupabase({
      userProfile: buildProfile({ partner_id: 'user-2' }),
      partnerProfile: buildProfile({
        is_premium: true,
        premium_expires: '2099-01-01T00:00:00.000Z',
        premium_plan: 'yearly',
        name: 'Former partner',
      }),
      partnershipRows: [],
    });

    await expect(getPremiumStatus('user-1')).resolves.toMatchObject({
      isPremium: false,
      source: null,
    });
  });

  it('enforces the moments limit for a user without a subscription', async () => {
    setupSupabase({
      partnershipRows: [{ id: 'partnership-1' }],
      momentsCount: 10,
    });

    await expect(checkMomentsLimit('user-1', 'partnership-1')).resolves.toMatchObject({
      allowed: false,
      current: 10,
      limit: 10,
      isPremium: false,
    });
  });
});
