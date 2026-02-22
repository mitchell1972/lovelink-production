jest.mock('../../config/supabase', () => ({
  supabase: {},
}));

const { sessionService, SESSION_TYPES } = require('../sessionService');

describe('sessionService', () => {
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
});

