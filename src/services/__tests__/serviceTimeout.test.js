const { withServiceTimeout, isServiceTimeoutError } = require('../serviceTimeout');

describe('serviceTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects when an operation exceeds the timeout', async () => {
    jest.useFakeTimers();

    const resultPromise = withServiceTimeout(new Promise(() => {}), 'test.operation', 50);

    jest.advanceTimersByTime(50);

    await expect(resultPromise).rejects.toThrow('test.operation timed out after 50ms');
  });

  it('resolves when an operation completes before timeout', async () => {
    jest.useFakeTimers();

    const resultPromise = withServiceTimeout(
      new Promise((resolve) => setTimeout(() => resolve('ok'), 10)),
      'test.operation',
      50
    );

    jest.advanceTimersByTime(10);

    await expect(resultPromise).resolves.toBe('ok');
  });

  it('detects timeout errors', () => {
    expect(isServiceTimeoutError(new Error('plans.getPlans timed out after 12000ms'))).toBe(true);
    expect(isServiceTimeoutError(new Error('any other error'))).toBe(false);
    expect(isServiceTimeoutError(null)).toBe(false);
  });
});
