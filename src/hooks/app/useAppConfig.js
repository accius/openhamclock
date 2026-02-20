'use strict';

import { useState, useEffect } from 'react';
import {
  loadConfig,
  saveConfig,
  applyTheme,
  fetchServerConfig,
  fetchServerSettings,
  syncAllSettingsToServer,
  installSettingsSyncInterceptor,
} from '../../utils';

export default function useAppConfig() {
  const [config, setConfig] = useState(loadConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showDxWeather, setShowDxWeather] = useState(true);
  const [classicAnalogClock, setClassicAnalogClock] = useState(false);

  useEffect(() => {
    const initConfig = async () => {
      // 1. Fetch .env-based server config first (need features.settingsSync flag)
      const serverCfg = await fetchServerConfig();
      if (serverCfg) {
        setShowDxWeather(serverCfg.showDxWeather !== false);
        setClassicAnalogClock(serverCfg.classicAnalogClock === true);
      }

      // 2. If server-side settings sync is enabled (self-hosted/Pi), load settings from server
      const syncEnabled = serverCfg?.features?.settingsSync === true;
      if (syncEnabled) {
        const hadServerSettings = await fetchServerSettings();
        // Install interceptor: any future localStorage write to openhamclock_* auto-syncs to server
        installSettingsSyncInterceptor();

        // If first device with no server settings, push current state to server
        if (!hadServerSettings) {
          syncAllSettingsToServer();
        }
      }

      // 3. Load config (reads from localStorage, which may have been updated by server sync)
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
    // Sync all settings to server (debounced)
    syncAllSettingsToServer();
  };

  return {
    config,
    setConfig,
    configLoaded,
    showDxWeather,
    setShowDxWeather,
    classicAnalogClock,
    setClassicAnalogClock,
    handleSaveConfig,
  };
}
