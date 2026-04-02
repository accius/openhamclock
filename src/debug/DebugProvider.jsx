import React, { createContext, useMemo, useEffect } from 'react';
import { getDebugConfig } from './debugConfig';
import { createLogger } from './logger';
import { overrideConsole } from './consoleOverride';

export const DebugContext = createContext(null);

export function DebugProvider({ children }) {
  const config = useMemo(() => getDebugConfig(), []);
  const logger = useMemo(() => createLogger(config), [config]);

  // Hybrid strategy: override console globally
  useEffect(() => {
    overrideConsole(config);
  }, [config]);

  return <DebugContext.Provider value={{ config, logger }}>{children}</DebugContext.Provider>;
}
