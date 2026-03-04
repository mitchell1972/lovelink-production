const DEFAULT_SERVICE_TIMEOUT_MS = 12000;

export const withServiceTimeout = async (operation, label, timeoutMs = DEFAULT_SERVICE_TIMEOUT_MS) => {
  let timeoutId;
  const operationPromise = typeof operation === 'function' ? operation() : operation;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const isServiceTimeoutError = (error) => {
  return Boolean(error?.message && error.message.includes('timed out after'));
};
