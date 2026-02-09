'use strict';

import { useState, useEffect } from 'react';
import { loadConfig, saveConfig, applyTheme, fetchServerConfig } from '../../utils';

export default function useAppConfig() {
  const [config, setConfig] = useState(loadConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showDxWeather, setShowDxWeather] = useState(true);
  const [classicAnalogClock, setClassicAnalogClock] = useState(false);

  useEffect(() => {
    const initConfig = async () => {
      const serverCfg = await fetchServerConfig();
      if (serverCfg) {
        setShowDxWeather(serverCfg.showDxWeather !== false);
        setClassicAnalogClock(serverCfg.classicAnalogClock === true);
      }

      const loadedConfig = loadConfig();
      setConfig(loadedConfig);
      setConfigLoaded(true);
    };
    initConfig();
  }, []);

  useEffect(() => {
    applyTheme(config.theme || 'dark');
  }, []);

  const handleSaveConfig = (newConfig) => {
    setConfig(newConfig);
    saveConfig(newConfig);
    applyTheme(newConfig.theme || 'dark');
    console.log('[Config] Saved to localStorage:', newConfig.callsign);
    if (newConfig.lowMemoryMode) {
      console.log('[Config] Low Memory Mode ENABLED - reduced spot limits, disabled animations');
    }
  };

  return {
    config,
    setConfig,
    configLoaded,
    showDxWeather,
    setShowDxWeather,
    classicAnalogClock,
    setClassicAnalogClock,
    handleSaveConfig
  };
}
