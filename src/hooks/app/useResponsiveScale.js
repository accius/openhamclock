'use strict';

import { useState, useEffect } from 'react';

export default function useResponsiveScale() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const calculateScale = () => {
      const minWidth = 1200;
      const minHeight = 800;
      const scaleX = window.innerWidth / minWidth;
      const scaleY = window.innerHeight / minHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    };
    calculateScale();
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, []);

  return scale;
}
