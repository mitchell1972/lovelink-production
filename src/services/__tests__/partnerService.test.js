const mockSupabase = {
  from: jest.fn(),
  auth: {
    getUser: jest.fn(),
  },
  rpc: jest.fn(),
};

jest.mock('../../config/supabase', () => ({
  supabase: mockSupabase,
}));

const { partnerService } = require('../partnerService');

const mockPartnershipQuery = ({ rows = [], error = null, partnerProfiles = {} }) => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'partnerships') {
      const orderChain = {
        order: () => orderChain,
        limit: async () => ({
          data: rows,
          error,
        }),
      };

      return {
        select: () => ({
          or: () => ({
            eq: () => ({
              order: () => orderChain,
            }),
          }),
        }),
      };
    }

    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (field, value) => ({
            maybeSingle: async () => ({
              data: partnerProfiles[value] || null,
              error: null,
            }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
};

describe('partnerService.getPartnership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when user has no active partnership rows', async () => {
    mockPartnershipQuery({ rows: [] });

    const result = await partnerService.getPartnership('user-1');

    expect(result).toBeNull();
  });

  it('selects the newest active row deterministically and hydrates partner profile if needed', async () => {
    mockPartnershipQuery({
      rows: [
        {
          id: 'partnership-newest-without-profile',
          user1_id: 'user-1',
          user2_id: 'user-2',
          partner1: { id: 'user-1', name: 'Me' },
          partner2: null,
        },
        {
          id: 'partnership-older-with-profile',
          user1_id: 'user-1',
          user2_id: 'user-2',
          partner1: { id: 'user-1', name: 'Me' },
          partner2: { id: 'user-2', name: 'Partner' },
        },
      ],
      partnerProfiles: {
        'user-2': { id: 'user-2', name: 'Partner', avatar_url: null },
      },
    });

    const result = await partnerService.getPartnership('user-1');

    expect(result.id).toBe('partnership-newest-without-profile');
    expect(result.partner).toEqual({ id: 'user-2', name: 'Partner', avatar_url: null });
  });

  it('falls back to the newest row when none include partner profile data', async () => {
    mockPartnershipQuery({
      rows: [
        {
          id: 'partnership-newest',
          user1_id: 'user-1',
          user2_id: 'user-2',
          partner1: { id: 'user-1', name: 'Me' },
          partner2: null,
        },
        {
          id: 'partnership-older',
          user1_id: 'user-1',
          user2_id: 'user-3',
          partner1: { id: 'user-1', name: 'Me' },
          partner2: null,
        },
      ],
      partnerProfiles: {
        'user-2': { id: 'user-2', name: 'Partner', avatar_url: null },
      },
    });

    const result = await partnerService.getPartnership('user-1');

    expect(result.id).toBe('partnership-newest');
    expect(result.partner).toEqual({ id: 'user-2', name: 'Partner', avatar_url: null });
  });
});

describe('partnerService.generateCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses regenerate_partner_code RPC when available and returns its code payload', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: {
        success: true,
        unlinked: true,
        code: {
          id: 'code-1',
          user_id: 'user-1',
          code: 'ABCD-1234',
          expires_at: '2099-01-01T00:00:00.000Z',
        },
      },
      error: null,
    });

    const result = await partnerService.generateCode('user-1');

    expect(mockSupabase.rpc).toHaveBeenCalledWith('regenerate_partner_code');
    expect(result).toEqual({
      id: 'code-1',
      user_id: 'user-1',
      code: 'ABCD-1234',
      expires_at: '2099-01-01T00:00:00.000Z',
      unlinked: true,
    });
  });

  it('falls back to legacy flow when regenerate RPC is unavailable', async () => {
    const inserted = {
      id: 'code-2',
      user_id: 'user-1',
      code: 'EFGH-5678',
      expires_at: '2099-01-01T00:00:00.000Z',
    };

    jest.spyOn(partnerService, 'getPartnership').mockResolvedValue(null);

    const isDelete = jest.fn().mockResolvedValue({ error: null });
    const insertSingle = jest.fn().mockResolvedValue({ data: inserted, error: null });

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'partner_codes') {
        return {
          delete: () => ({
            eq: () => ({
              is: isDelete,
            }),
          }),
          insert: () => ({
            select: () => ({
              single: insertSingle,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Function not found' },
      })
      .mockResolvedValueOnce({
        data: 'EFGH-5678',
        error: null,
      });

    const result = await partnerService.generateCode('user-1');

    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(1, 'regenerate_partner_code');
    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(2, 'generate_partner_code');
    expect(result).toEqual({
      ...inserted,
      unlinked: false,
    });
  });

  it('blocks fallback regeneration when user is still linked', async () => {
    jest.spyOn(partnerService, 'getPartnership').mockResolvedValue({
      id: 'partnership-1',
      user1_id: 'user-1',
      user2_id: 'user-2',
      status: 'active',
      partner: { id: 'user-2', name: 'Partner' },
    });

    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Function not found' },
    });

    await expect(partnerService.generateCode('user-1')).rejects.toThrow(
      'For safety, this environment must install the unlink migration before generating a new code while linked.'
    );

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('regenerate_partner_code');
  });
});

describe('partnerService.linkWithPartner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps active-partnership constraint errors to a user-friendly response', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: 'A user can only be in one active partnership',
      },
    });

    const result = await partnerService.linkWithPartner('69a5-4ae9');

    expect(mockSupabase.rpc).toHaveBeenCalledWith('link_partners', {
      p_code: '69A5-4AE9',
    });
    expect(result).toEqual({
      success: false,
      error:
        'One of you is already linked to another partner. Unlink first before creating a new connection.',
    });
  });
});
