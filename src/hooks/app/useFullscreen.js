'use strict';

import { useState, useEffect, useCallback } from 'react';

export default function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreenToggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  return { isFullscreen, handleFullscreenToggle };
}
