export function createLogger(config) {
  const levels = ['error', 'warn', 'info', 'debug'];

  const shouldLog = (level, scope) => {
    if (config.logLevel === 'none') return false;

    if (config.logScopes.size && scope && !config.logScopes.has(scope)) {
      return false;
    }

    if (config.logLevel === 'all') return true;

    return levels.indexOf(level) <= levels.indexOf(config.logLevel);
  };

  const log =
    (level) =>
    (scope, ...args) => {
      if (!shouldLog(level, scope)) return;
      console[level](`[${scope}]`, ...args);
    };

  return {
    error: log('error'),
    warn: log('warn'),
    info: log('info'),
    debug: log('debug'),
  };
}
