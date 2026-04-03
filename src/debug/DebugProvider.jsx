import React from 'react';
import { getDebugConfig } from './debugConfig';
import { overrideConsole } from './consoleOverride';

export function DebugProvider({ children }) {
  const config = getDebugConfig();

  overrideConsole(config);

  return children;
}
