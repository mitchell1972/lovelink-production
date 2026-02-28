const mockSupabase = {
  from: jest.fn(),
};

jest.mock('../../config/supabase', () => ({
  supabase: mockSupabase,
}));

const {
  checkMomentsLimit,
  formatPremiumExpiry,
  getPremiumStatus,
  getTrialAccessStatus,
  TRIAL_DAYS,
} = require('../premiumService');

const buildNonPremiumProfile = (overrides = {}) => ({
  is_premium: false,
  premium_since: null,
  premium_expires: null,
  premium_plan: null,
  partner_id: null,
  ...overrides,
});

const buildTrialProfile = (overrides = {}) => ({
  created_at: '2026-02-27T00:00:00.000Z',
  trial_access_bypass: false,
  ...overrides,
});

const setupSupabase = ({
  userId = 'user-1',
  userProfile,
  partnerId = 'user-2',
  partnerProfile = null,
  partnershipRows = [],
  momentsCount = 0,
  trialProfile,
  failTrialSelectWithMissingColumn = false,
  trialProfileError = null,
}) => {
  const effectiveUserProfile = userProfile || buildNonPremiumProfile();
  const effectiveTrialProfile = trialProfile || buildTrialProfile();

  mockSupabase.from.mockImplementation((table) => {
    if (table === 'profiles') {
      return {
        select: (columns = '*') => ({
          eq: (_column, value) => ({
            single: async () => {
              if (value !== userId && (!partnerProfile || value !== partnerId)) {
                return { data: null, error: { code: 'PGRST116' } };
              }

              if (value === partnerId && partnerProfile) {
                return { data: partnerProfile, error: null };
              }

              const selected = String(columns || '');
              const isTrialSelectWithBypass =
                selected.includes('created_at') && selected.includes('trial_access_bypass');
              const isTrialSelectFallback = selected.trim() === 'created_at';

              if (isTrialSelectWithBypass) {
                if (failTrialSelectWithMissingColumn) {
                  return {
                    data: null,
                    error: {
                      code: '42703',
                      message: 'column profiles.trial_access_bypass does not exist',
                    },
                  };
                }
                if (trialProfileError) {
                  return { data: null, error: trialProfileError };
                }
                return { data: effectiveTrialProfile, error: null };
              }

              if (isTrialSelectFallback) {
                if (trialProfileError) {
                  return { data: null, error: trialProfileError };
                }
                return { data: { created_at: effectiveTrialProfile.created_at }, error: null };
              }

              return { data: effectiveUserProfile, error: null };
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
              order: () => ({
                limit: async () => ({
                  data: partnershipRows,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }

    if (table === 'moments') {
      return {
        select: () => ({
          eq: async () => ({ count: momentsCount, error: null }),
        }),
      };
    }

    throw new Error(`Unexpected table mock request: ${table}`);
  });
};

const setupSupabaseForMomentsLimit = ({ isPremium = false, momentsCount = 0 }) => {
  setupSupabase({
    userProfile: buildNonPremiumProfile({
      is_premium: isPremium,
      premium_expires: isPremium ? '2099-01-01T00:00:00.000Z' : null,
      premium_plan: isPremium ? 'monthly' : null,
    }),
    partnershipRows: [{ id: 'partnership-1' }],
    momentsCount,
  });
};

describe('premiumService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('formatPremiumExpiry', () => {
    it('returns "Never" when expiry is missing', () => {
      expect(formatPremiumExpiry(null)).toBe('Never');
    });

    it('returns relative expiry labels for common cases', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-22T00:00:00.000Z'));

      expect(formatPremiumExpiry('2026-02-21T00:00:00.000Z')).toBe('Expired');
      expect(formatPremiumExpiry('2026-02-22T00:00:00.000Z')).toBe('Expires today');
      expect(formatPremiumExpiry('2026-02-23T00:00:00.000Z')).toBe('Expires tomorrow');
      expect(formatPremiumExpiry('2026-02-25T00:00:00.000Z')).toBe('Expires in 3 days');
    });
  });

  describe('checkMomentsLimit', () => {
    it('blocks free users once they hit the moments limit', async () => {
      setupSupabaseForMomentsLimit({ isPremium: false, momentsCount: 10 });

      const result = await checkMomentsLimit('user-1', 'partnership-1');

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.limit).toBe(10);
      expect(result.isPremium).toBe(false);
    });

    it('allows premium users regardless of moments count', async () => {
      setupSupabaseForMomentsLimit({ isPremium: true, momentsCount: 250 });

      const result = await checkMomentsLimit('user-1', 'partnership-1');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(250);
      expect(result.isPremium).toBe(true);
    });
  });

  describe('getPremiumStatus', () => {
    it('returns partner premium using active partnership when profile partner_id is missing', async () => {
      setupSupabase({
        userId: 'user-1',
        partnerId: 'user-2',
        userProfile: buildNonPremiumProfile(),
        partnerProfile: {
          is_premium: true,
          premium_since: '2026-01-01T00:00:00.000Z',
          premium_expires: '2099-01-01T00:00:00.000Z',
          premium_plan: 'yearly',
          name: 'Alex',
        },
        partnershipRows: [{ user1_id: 'user-1', user2_id: 'user-2' }],
      });

      const result = await getPremiumStatus('user-1');

      expect(result.isPremium).toBe(true);
      expect(result.source).toBe('partner');
      expect(result.partnerName).toBe('Alex');
      expect(result.plan).toBe('yearly');
    });

    it('returns non-premium when neither self nor partner has active premium', async () => {
      setupSupabase({
        userId: 'user-1',
        partnerId: 'user-2',
        userProfile: buildNonPremiumProfile(),
        partnerProfile: {
          is_premium: false,
          premium_since: null,
          premium_expires: null,
          premium_plan: null,
          name: 'Alex',
        },
        partnershipRows: [{ user1_id: 'user-1', user2_id: 'user-2' }],
      });

      const result = await getPremiumStatus('user-1');

      expect(result.isPremium).toBe(false);
      expect(result.source).toBe(null);
    });
  });

  describe('getTrialAccessStatus', () => {
    it('returns premium access when premium is active', async () => {
      setupSupabase({
        userProfile: buildNonPremiumProfile({
          is_premium: true,
          premium_expires: '2099-01-01T00:00:00.000Z',
          premium_plan: 'monthly',
        }),
        trialProfile: buildTrialProfile({
          created_at: '2026-01-01T00:00:00.000Z',
          trial_access_bypass: false,
        }),
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result).toMatchObject({
        hasAccess: true,
        isPremium: true,
        isInTrial: false,
        reason: 'premium',
      });
    });

    it('grants access during trial and reports remaining days', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-28T12:00:00.000Z'));
      setupSupabase({
        userProfile: buildNonPremiumProfile(),
        trialProfile: buildTrialProfile({
          created_at: '2026-02-24T10:00:00.000Z',
          trial_access_bypass: false,
        }),
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result.hasAccess).toBe(true);
      expect(result.isInTrial).toBe(true);
      expect(result.daysRemaining).toBe(3);
      expect(result.reason).toBe('trial');
    });

    it('denies access when trial is expired', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-28T12:00:00.000Z'));
      setupSupabase({
        userProfile: buildNonPremiumProfile(),
        trialProfile: buildTrialProfile({
          created_at: '2026-02-10T00:00:00.000Z',
          trial_access_bypass: false,
        }),
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result).toMatchObject({
        hasAccess: false,
        isPremium: false,
        isInTrial: false,
        daysRemaining: 0,
        reason: 'expired',
      });
    });

    it('bypasses trial lock when trial_access_bypass is enabled', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-28T12:00:00.000Z'));
      setupSupabase({
        userProfile: buildNonPremiumProfile(),
        trialProfile: buildTrialProfile({
          created_at: '2026-01-01T00:00:00.000Z',
          trial_access_bypass: true,
        }),
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result).toMatchObject({
        hasAccess: true,
        isPremium: false,
        isInTrial: false,
        reason: 'bypass',
      });
    });

    it('falls back when bypass column is missing in older DB schema', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-28T00:00:00.000Z'));
      setupSupabase({
        userProfile: buildNonPremiumProfile(),
        trialProfile: buildTrialProfile({
          created_at: '2026-02-27T00:00:00.000Z',
        }),
        failTrialSelectWithMissingColumn: true,
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result.hasAccess).toBe(true);
      expect(result.isInTrial).toBe(true);
      expect(result.daysRemaining).toBe(TRIAL_DAYS - 1);
      expect(result.reason).toBe('trial');
    });

    it('fails closed when trial profile query errors', async () => {
      setupSupabase({
        userProfile: buildNonPremiumProfile(),
        trialProfileError: { code: 'PGRST999', message: 'db unavailable' },
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result).toMatchObject({
        hasAccess: false,
        isPremium: false,
        isInTrial: false,
        daysRemaining: 0,
        reason: 'error',
      });
    });

    it('treats missing created_at as a fresh trial start', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-28T00:00:00.000Z'));
      setupSupabase({
        userProfile: buildNonPremiumProfile(),
        trialProfile: buildTrialProfile({
          created_at: null,
          trial_access_bypass: false,
        }),
      });

      const result = await getTrialAccessStatus('user-1');

      expect(result.hasAccess).toBe(true);
      expect(result.isInTrial).toBe(true);
      expect(result.daysRemaining).toBe(TRIAL_DAYS);
      expect(result.reason).toBe('trial');
    });
  });
});
