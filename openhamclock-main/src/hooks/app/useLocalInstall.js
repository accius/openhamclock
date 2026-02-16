'use strict';

import { useMemo } from 'react';

export default function useLocalInstall() {
  return useMemo(() => {
    const host = (window.location.hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'openhamclock.com' || host.endsWith('.openhamclock.com')) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.local')) return true;
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
    if (host.startsWith('172.')) {
      const parts = host.split('.');
      const second = parseInt(parts[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }, []);
}
