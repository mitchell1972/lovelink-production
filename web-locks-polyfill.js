// Web: Stub navigator.locks to prevent Supabase auth deadlock on page reload
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  try {
    const lockStub = {
      request: async (_name, _opts, cb) => {
        if (typeof _opts === 'function') {
          cb = _opts;
        }
        return cb({ name: _name, mode: 'exclusive' });
      },
      query: async () => ({ held: [], pending: [] }),
    };

    // Try direct assignment first
    navigator.locks = lockStub;

    // If it didn't stick, use Object.defineProperty on the prototype
    if (navigator.locks !== lockStub) {
      Object.defineProperty(Navigator.prototype, 'locks', {
        get: () => lockStub,
        configurable: true,
      });
    }

    // Final fallback: defineProperty on navigator instance
    if (navigator.locks !== lockStub) {
      Object.defineProperty(navigator, 'locks', {
        value: lockStub,
        writable: true,
        configurable: true,
      });
    }

    console.log('[POLYFILL] navigator.locks stubbed:', navigator.locks === lockStub);
  } catch (e) {
    console.error('[POLYFILL] Failed to stub navigator.locks:', e);
  }
}
