let originalConsole = {};

export function overrideConsole(config) {
  // Save original console once
  if (!originalConsole.log) {
    originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
  }

  const noop = () => {};

  // Allow everything
  if (config.logLevel === 'all') {
    restoreConsole();
    return;
  }

  // Disable everything
  if (config.logLevel === 'none') {
    console.log = noop;
    console.info = noop;
    console.warn = noop;
    console.error = noop;
    return;
  }

  const order = ['error', 'warn', 'info', 'log'];
  const allowedIndex = ['none', 'error', 'warn', 'info', 'debug', 'all'].indexOf(config.logLevel);

  order.forEach((method, index) => {
    if (index > allowedIndex) {
      console[method] = noop;
    } else {
      console[method] = originalConsole[method];
    }
  });
}

export function restoreConsole() {
  if (!originalConsole.log) return;

  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
