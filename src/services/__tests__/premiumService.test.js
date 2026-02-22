const mockSupabase = {
  from: jest.fn(),
};

jest.mock('../../config/supabase', () => ({
  supabase: mockSupabase,
}));

const { checkMomentsLimit, formatPremiumExpiry, getPremiumStatus } = require('../premiumService');

const setupSupabase = ({
  userId = 'user-1',
  userProfile,
  partnerId = 'user-2',
  partnerProfile = null,
  partnershipRows = [],
  momentsCount = 0,
}) => {
  const effectiveUserProfile = userProfile || {
    is_premium: false,
    premium_since: null,
    premium_expires: null,
    premium_plan: null,
    partner_id: null,
  };

  mockSupabase.from.mockImplementation((table) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_column, value) => ({
            single: async () => {
              if (value === userId) {
                return { data: effectiveUserProfile, error: null };
              }
              if (partnerProfile && value === partnerId) {
                return { data: partnerProfile, error: null };
              }
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
    userProfile: {
      is_premium: isPremium,
      premium_since: null,
      premium_expires: isPremium ? '2099-01-01T00:00:00.000Z' : null,
      premium_plan: isPremium ? 'monthly' : null,
      partner_id: null,
    },
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
        userProfile: {
          is_premium: false,
          premium_since: null,
          premium_expires: null,
          premium_plan: null,
          partner_id: null,
        },
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
        userProfile: {
          is_premium: false,
          premium_since: null,
          premium_expires: null,
          premium_plan: null,
          partner_id: null,
        },
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
});
