const LEVEL_MAP = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  all: 4,
};

const METHOD_LEVEL = {
  error: 1,
  warn: 2,
  info: 3,
  log: 4,
  debug: 4,
  trace: 4,
};

export function overrideConsole(config) {
  const allowedLevel = LEVEL_MAP[config.logLevel];

  const originalConsole = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    trace: console.trace ? console.trace.bind(console) : console.log.bind(console),
  };

  Object.keys(METHOD_LEVEL).forEach((method) => {
    const methodLevel = METHOD_LEVEL[method];

    console[method] = methodLevel <= allowedLevel ? originalConsole[method] : () => {};
  });
}
