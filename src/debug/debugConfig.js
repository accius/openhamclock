export function getDebugConfig() {
  const params = new URLSearchParams(window.location.search);

  const parseSet = (key) =>
    new Set(
      (params.get(key) || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    );

  return {
    logLevel: params.get('log') || 'none',
    logScopes: parseSet('logScope'),

    features: parseSet('feature'),
    disable: parseSet('disable'),
    debug: parseSet('debug'),

    role: params.get('role') || null,
    state: params.get('state') || null,

    perf: params.get('perf') === 'true',
  };
}
