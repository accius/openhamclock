'use strict';

import { useMemo } from 'react';

export default function useLocalInstall(serverLocal = false) {
  return useMemo(() => {
    const host = (window.location.hostname || '').toLowerCase();

    if (serverLocal) {
      console.info('[useLocalInstall] Bypassing extra testing as serverLocal is set true');
      return true;
    }

    if (!host || host === 'openhamclock.com' || host.endsWith('.openhamclock.com')) return false;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.home') ||
      host.endsWith('.lan') ||
      host.endsWith('.internal') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.')
    )
      return true;
    if (host.startsWith('172.')) {
      const parts = host.split('.');
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }, [serverLocal]);
}
