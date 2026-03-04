const mockSupabase = {
  from: jest.fn(),
};

jest.mock('../../config/supabase', () => ({
  supabase: mockSupabase,
}));

const { pulseService } = require('../pulseService');

describe('pulseService.getReceivedPulses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads partner pulses with descending order and a limit', async () => {
    const limit = jest.fn(async () => ({
      data: [{ id: 'pulse-1' }],
      error: null,
    }));
    const order = jest.fn(() => ({ limit }));
    const neq = jest.fn(() => ({ order }));
    const eq = jest.fn(() => ({ neq }));
    const select = jest.fn(() => ({ eq }));

    mockSupabase.from.mockReturnValue({ select });

    const result = await pulseService.getReceivedPulses('partnership-1', 'user-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('pulses');
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('partnership_id', 'partnership-1');
    expect(neq).toHaveBeenCalledWith('sender_id', 'user-1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(10);
    expect(result).toEqual([{ id: 'pulse-1' }]);
  });

  it('throws when Supabase returns an error', async () => {
    const limit = jest.fn(async () => ({
      data: null,
      error: { message: 'permission denied' },
    }));
    const order = jest.fn(() => ({ limit }));
    const neq = jest.fn(() => ({ order }));
    const eq = jest.fn(() => ({ neq }));
    const select = jest.fn(() => ({ eq }));

    mockSupabase.from.mockReturnValue({ select });

    await expect(
      pulseService.getReceivedPulses('partnership-1', 'user-1')
    ).rejects.toMatchObject({ message: 'permission denied' });
  });
});
