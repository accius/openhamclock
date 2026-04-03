export function getDebugConfig() {
  const params = new URLSearchParams(window.location.search);

  const level = params.get('log');

  const validLevels = ['none', 'error', 'warn', 'info', 'debug', 'all'];

  // warn will be the default
  return {
    logLevel: validLevels.includes(level) ? level : 'warn',
  };
}
