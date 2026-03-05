const mockSupabase = {
  from: jest.fn(),
};

jest.mock('../../config/supabase', () => ({
  supabase: mockSupabase,
}));

jest.mock('../serviceTimeout', () => ({
  withServiceTimeout: (promise) => promise,
}));

const { plansService } = require('../plansService');

describe('plansService partnership guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks completing a plan from an old partnership', async () => {
    const updateSingle = jest.fn();

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'plans') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'plan-1', partnership_id: 'old-partnership' },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: updateSingle,
              }),
            }),
          }),
        };
      }

      if (table === 'partnerships') {
        const orderChain = {
          order: () => orderChain,
          limit: async () => ({
            data: [{ id: 'new-partnership' }],
            error: null,
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

      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(plansService.completePlan('plan-1', 'user-1')).rejects.toMatchObject({
      code: 'OLD_PARTNERSHIP_PLAN',
    });
    expect(updateSingle).not.toHaveBeenCalled();
  });

  it('allows completing a plan from the current active partnership', async () => {
    const updateSingle = jest.fn().mockResolvedValue({
      data: { id: 'plan-1', status: 'completed' },
      error: null,
    });

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'plans') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'plan-1', partnership_id: 'active-partnership' },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: updateSingle,
              }),
            }),
          }),
        };
      }

      if (table === 'partnerships') {
        const orderChain = {
          order: () => orderChain,
          limit: async () => ({
            data: [{ id: 'active-partnership' }],
            error: null,
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

      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await plansService.completePlan('plan-1', 'user-1');
    expect(result).toEqual({ id: 'plan-1', status: 'completed' });
    expect(updateSingle).toHaveBeenCalled();
  });

  it('blocks creating a plan when caller is no longer in that active partnership', async () => {
    const insertSingle = jest.fn();

    mockSupabase.from.mockImplementation((table) => {
      if (table === 'partnerships') {
        const orderChain = {
          order: () => orderChain,
          limit: async () => ({
            data: [{ id: 'different-partnership' }],
            error: null,
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

      if (table === 'plans') {
        return {
          insert: () => ({
            select: () => ({
              single: insertSingle,
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      plansService.createPlan('stale-partnership', 'user-1', {
        title: 'Dinner',
        scheduledDate: null,
        budget: 'Low',
        vibe: 'Casual',
      })
    ).rejects.toMatchObject({
      code: 'PARTNERSHIP_DISCONNECTED',
    });

    expect(insertSingle).not.toHaveBeenCalled();
  });
});
