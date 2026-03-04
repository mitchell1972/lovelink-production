const mockSupabase = {
  from: jest.fn(),
};

jest.mock('../../config/supabase', () => ({
  supabase: mockSupabase,
}));

const { sessionService, SESSION_TYPES } = require('../sessionService');

const mockSessionLookup = ({
  strictRows = [],
  relaxedRows = [],
  strictError = null,
  relaxedError = null,
}) => {
  mockSupabase.from.mockImplementation((table) => {
    if (table !== 'sessions') {
      throw new Error(`Unexpected table: ${table}`);
    }

    const filters = {};
    const query = {
      select: () => query,
      eq: (field, value) => {
        filters[field] = value;
        return query;
      },
      order: () => query,
      limit: async () => {
        const hasPartnershipFilter = Object.prototype.hasOwnProperty.call(filters, 'partnership_id');
        if (hasPartnershipFilter) {
          return { data: strictRows, error: strictError };
        }
        return { data: relaxedRows, error: relaxedError };
      },
    };

    return query;
  });
};

describe('sessionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a deterministic daily session type for the same day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-22T10:00:00Z'));

    const first = sessionService.getTodaySessionType();
    const second = sessionService.getTodaySessionType();
    const validTypes = Object.values(SESSION_TYPES).map((item) => item.type);

    expect(first).toEqual(second);
    expect(validTypes).toContain(first.type);
  });

  it('getRandomSessionType always returns one of the configured session types', () => {
    const validTypes = new Set(Object.values(SESSION_TYPES).map((item) => item.type));

    for (let i = 0; i < 25; i += 1) {
      const randomSession = sessionService.getRandomSessionType();
      expect(validTypes.has(randomSession.type)).toBe(true);
    }
  });

  it('returns strict partnership match when available', async () => {
    mockSessionLookup({
      strictRows: [
        { id: 'strict-1', answer: 'Hello from strict', partnership_id: 'partnership-1' },
      ],
      relaxedRows: [
        { id: 'relaxed-1', answer: 'Hello from relaxed', partnership_id: 'partnership-legacy' },
      ],
    });

    const result = await sessionService.getPartnerSessionByDate(
      'partnership-1',
      'partner-1',
      'microPlan',
      '2026-03-04'
    );

    expect(result).toEqual({ id: 'strict-1', answer: 'Hello from strict', partnership_id: 'partnership-1' });
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('falls back without partnership filter when strict lookup is empty', async () => {
    mockSessionLookup({
      strictRows: [],
      relaxedRows: [
        { id: 'relaxed-1', answer: 'Fallback row', partnership_id: 'partnership-legacy' },
      ],
    });

    const result = await sessionService.getPartnerSessionByDate(
      'partnership-1',
      'partner-1',
      'microPlan',
      '2026-03-04'
    );

    expect(result).toEqual({ id: 'relaxed-1', answer: 'Fallback row', partnership_id: 'partnership-legacy' });
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });

  it('getUserSessionByDate can fetch by date without session_type filter', async () => {
    mockSessionLookup({
      strictRows: [
        { id: 'strict-any-type', answer: 'Any type row', session_type: 'wins' },
      ],
    });

    const result = await sessionService.getUserSessionByDate(
      'partnership-1',
      'user-1',
      '2026-03-04'
    );

    expect(result).toEqual({ id: 'strict-any-type', answer: 'Any type row', session_type: 'wins' });
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('throws when strict query fails', async () => {
    mockSessionLookup({
      strictRows: [],
      strictError: { code: 'PGRST000', message: 'query failed' },
    });

    await expect(
      sessionService.getPartnerSessionByDate(
        'partnership-1',
        'partner-1',
        'microPlan',
        '2026-03-04'
      )
    ).rejects.toEqual({ code: 'PGRST000', message: 'query failed' });
  });

  it('submitSession blocks a second submission on the same day', async () => {
    mockSessionLookup({
      strictRows: [
        { id: 'existing-today', answer: 'Already answered today' },
      ],
    });

    await expect(
      sessionService.submitSession(
        'partnership-1',
        'user-1',
        'microPlan',
        'Second answer'
      )
    ).rejects.toMatchObject({
      code: 'SESSION_ALREADY_SUBMITTED',
      message: 'You already submitted your Daily Session for today.',
    });
  });
});
