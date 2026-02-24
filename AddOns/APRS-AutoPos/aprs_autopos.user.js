// ==UserScript==
// @name         APRS Auto-Position for OpenHamClock
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Automatically updates your station position in OpenHamClock based on APRS beacons
// @author       DO3EET
// @match        https://openhamclock.com/*
// @grant        GM_xmlhttpRequest
// @connect      aprs.fi
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_API_KEY = 'ohc_aprsfi_apikey';
  const STORAGE_TRACK_SSID = 'ohc_autopos_ssid';
  const STORAGE_AUTO_INTERVAL = 'ohc_autopos_interval';

  const translations = {
    de: {
      title: '\uD83D\uDCCD APRS Auto-Pos',
      placeholder_apikey: 'aprs.fi API Key',
      track_ssid: 'Track SSID (z.B. -9)',
      interval: 'Intervall (Minuten)',
      save: 'Speichern',
      status_idle: 'Bereit',
      status_loading: 'Lade Position...',
      status_updated: 'Position aktualisiert!',
      status_no_change: 'Position unverändert',
      error_api: 'API Fehler',
      setup_required: 'Einstellungen pr\u00FCfen.',
    },
    en: {
      title: '\uD83D\uDCCD APRS Auto-Pos',
      placeholder_apikey: 'aprs.fi API Key',
      track_ssid: 'Track SSID (e.g. -9)',
      interval: 'Interval (minutes)',
      save: 'Save',
      status_idle: 'Ready',
      status_loading: 'Fetching position...',
      status_updated: 'Position updated!',
      status_no_change: 'No movement detected',
      error_api: 'API Error',
      setup_required: 'Check settings.',
    },
  };

  let lang = document.documentElement.lang.startsWith('de') ? 'de' : 'en';
  const t = (key) => translations[lang][key] || key;

  const styles = `
        #ohc-addon-drawer {
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: flex;
            flex-direction: row-reverse;
            align-items: center;
            gap: 10px;
            z-index: 10000;
            pointer-events: none;
        }
        #ohc-addon-drawer.ohc-vertical {
            flex-direction: column-reverse;
        }
        .ohc-addon-icon {
            width: 45px;
            height: 45px;
            background: var(--bg-panel, rgba(17, 24, 32, 0.95));
            border: 1px solid var(--border-color, rgba(255, 180, 50, 0.3));
            border-radius: 50%;
            color: var(--accent-cyan, #00ddff);
            font-size: 20px;
            cursor: pointer;
            display: flex;
            justify-content: center;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            pointer-events: auto;
            transition: all 0.3s ease;
        }
        .ohc-addon-icon:hover { border-color: var(--accent-amber, #ffb432); transform: scale(1.1); }
        #ohc-addon-launcher { background: var(--bg-tertiary, #1a2332); color: var(--accent-amber); }
        .ohc-addon-item { display: none; }

        #ohc-autopos-container {
            position: fixed;
            top: 140px;
            right: 20px;
            width: 280px;
            background: var(--bg-panel, rgba(17, 24, 32, 0.95));
            border: 1px solid var(--border-color, rgba(255, 180, 50, 0.3));
            border-radius: 8px;
            color: var(--text-primary, #f0f4f8);
            font-family: 'JetBrains Mono', monospace, sans-serif;
            z-index: 9997;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            display: none;
            flex-direction: column;
            backdrop-filter: blur(5px);
        }
        #ohc-autopos-header {
            padding: 10px;
            background: rgba(255, 180, 50, 0.1);
            border-bottom: 1px solid var(--border-color, rgba(255, 180, 50, 0.2));
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-radius: 8px 8px 0 0;
        }
        #ohc-autopos-header h3 { margin: 0; font-size: 14px; color: var(--accent-amber); }
        .ohc-icon-btn { cursor: pointer; color: var(--text-muted); margin-left: 10px; font-size: 14px; }
        .ohc-icon-btn:hover { color: var(--text-primary); }
        #ohc-autopos-content { padding: 12px; font-size: 12px; }
        #ohc-autopos-settings { padding: 10px; background: rgba(0,0,0,0.3); border-top: 1px solid var(--border-color, rgba(255, 180, 50, 0.1)); font-size: 11px; display: none; }
        .ohc-input { width: 100%; padding: 6px; background: var(--bg-secondary); border: 1px solid var(--border-color, rgba(255, 180, 50, 0.2)); color: var(--text-primary); border-radius: 4px; margin-bottom: 6px; box-sizing: border-box; outline: none; }
    `;

  let apiKey = localStorage.getItem(STORAGE_API_KEY) || '';
  let trackSsid = localStorage.getItem(STORAGE_TRACK_SSID) || '-9';
  let interval = parseInt(localStorage.getItem(STORAGE_AUTO_INTERVAL)) || 10;
  let timer = null;

  function getCallsign() {
    try {
      const config = JSON.parse(localStorage.getItem('openhamclock_config'));
      return config && config.callsign && config.callsign !== 'N0CALL' ? config.callsign : null;
    } catch (e) {
      return null;
    }
  }

  function latLonToGrid(lat, lon) {
    let adjLat = lat + 90;
    let adjLon = lon + 180;
    let grid = '';
    grid += String.fromCharCode(65 + Math.floor(adjLon / 20));
    grid += String.fromCharCode(65 + Math.floor(adjLat / 10));
    grid += Math.floor((adjLon % 20) / 2).toString();
    grid += Math.floor(adjLat % 10).toString();
    grid += String.fromCharCode(97 + Math.floor((adjLon % 2) * 12)).toLowerCase();
    grid += String.fromCharCode(97 + Math.floor((adjLat % 1) * 24)).toLowerCase();
    return grid.substring(0, 6).toUpperCase();
  }

  function init() {
    if (!document.body) return;

    const styleSheet = document.createElement('style');
    styleSheet.id = 'ohc-autopos-styles';
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    let drawer = document.getElementById('ohc-addon-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'ohc-addon-drawer';
      const savedLayout = localStorage.getItem('ohc_addon_layout') || 'horizontal';
      if (savedLayout === 'vertical') drawer.classList.add('ohc-vertical');

      const launcher = document.createElement('div');
      launcher.id = 'ohc-addon-launcher';
      launcher.className = 'ohc-addon-icon';
      launcher.innerHTML = '\uD83E\uDDE9';
      launcher.title = 'L: Toggle | R: Rotate';

      launcher.onclick = () => {
        const items = document.querySelectorAll('.ohc-addon-item');
        const isHidden = items[0]?.style.display !== 'flex';
        items.forEach((el) => (el.style.display = isHidden ? 'flex' : 'none'));
        launcher.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
      };

      launcher.oncontextmenu = (e) => {
        e.preventDefault();
        const isVert = drawer.classList.toggle('ohc-vertical');
        localStorage.setItem('ohc_addon_layout', isVert ? 'vertical' : 'horizontal');
      };

      drawer.appendChild(launcher);
      document.body.appendChild(drawer);
    }

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'ohc-autopos-toggle';
    toggleBtn.className = 'ohc-addon-icon ohc-addon-item';
    toggleBtn.innerHTML = '\uD83D\uDCCD';
    toggleBtn.title = t('title');
    drawer.appendChild(toggleBtn);

    const container = document.createElement('div');
    container.id = 'ohc-autopos-container';
    container.innerHTML = `
            <div id="ohc-autopos-header">
                <h3>${t('title')}</h3>
                <div style="display:flex; align-items:center;">
                    <span id="ohc-autopos-settings-toggle" class="ohc-icon-btn" title="Settings">\uD83D\uDD27</span>
                    <span id="ohc-autopos-close" class="ohc-icon-btn" style="font-size: 20px; margin-top: -2px;">\u00D7</span>
                </div>
            </div>
            <div id="ohc-autopos-content">
                <div id="ohc-autopos-info" style="text-align: center; color: var(--text-muted);">${t('status_idle')}</div>
                <div id="ohc-autopos-last" style="font-size: 10px; margin-top: 8px; text-align: center; color: var(--accent-cyan);"></div>
            </div>
            <div id="ohc-autopos-settings">
                <label>${t('placeholder_apikey')}</label>
                <input type="password" id="ohc-autopos-api-input" class="ohc-input" value="${apiKey}">
                <label>${t('track_ssid')}</label>
                <input type="text" id="ohc-autopos-ssid-input" class="ohc-input" value="${trackSsid}">
                <label>${t('interval')}</label>
                <input type="number" id="ohc-autopos-int-input" class="ohc-input" value="${interval}">
                <button id="ohc-autopos-save-btn" style="width:100%; padding: 6px; cursor: pointer; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px;">${t('save')}</button>
            </div>
        `;
    document.body.appendChild(container);

    const settingsBtn = document.getElementById('ohc-autopos-settings-toggle');
    const saveBtn = document.getElementById('ohc-autopos-save-btn');
    const settingsDiv = document.getElementById('ohc-autopos-settings');

    toggleBtn.onclick = () => {
      const isVisible = container.style.display === 'flex';
      container.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) updatePosition();
    };
    document.getElementById('ohc-autopos-close').onclick = () => (container.style.display = 'none');
    settingsBtn.onclick = () => {
      settingsDiv.style.display = settingsDiv.style.display === 'block' ? 'none' : 'block';
    };

    saveBtn.onclick = () => {
      apiKey = document.getElementById('ohc-autopos-api-input').value.trim();
      trackSsid = document.getElementById('ohc-autopos-ssid-input').value.trim();
      interval = parseInt(document.getElementById('ohc-autopos-int-input').value) || 10;
      localStorage.setItem(STORAGE_API_KEY, apiKey);
      localStorage.setItem(STORAGE_TRACK_SSID, trackSsid);
      localStorage.setItem(STORAGE_AUTO_INTERVAL, interval);
      settingsDiv.style.display = 'none';
      startTimer();
      updatePosition();
    };

    let pos1 = 0,
      pos2 = 0,
      pos3 = 0,
      pos4 = 0;
    document.getElementById('ohc-autopos-header').onmousedown = (e) => {
      if (e.target.classList.contains('ohc-icon-btn')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = () => {
        document.onmouseup = null;
        document.onmousemove = null;
      };
      document.onmousemove = (e) => {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        container.style.top = container.offsetTop - pos2 + 'px';
        container.style.left = container.offsetLeft - pos1 + 'px';
        container.style.right = 'auto';
      };
    };

    startTimer();
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(updatePosition, interval * 60000);
  }

  function updatePosition() {
    const baseCall = getCallsign();
    if (!baseCall || !apiKey) {
      const info = document.getElementById('ohc-autopos-info');
      if (info) info.innerText = t('setup_required');
      return;
    }
    const info = document.getElementById('ohc-autopos-info');
    const last = document.getElementById('ohc-autopos-last');
    if (info) info.innerText = t('status_loading');
    const target = baseCall + (trackSsid.startsWith('-') ? trackSsid : '-' + trackSsid);
    const url = `https://api.aprs.fi/api/get?what=loc&name=${target}&apikey=${apiKey}&format=json`;
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        onload: (response) => {
          try {
            handleResponse(JSON.parse(response.responseText));
          } catch (e) {
            if (info) info.innerText = 'Parse Error';
          }
        },
        onerror: () => {
          if (info) info.innerText = t('error_api');
        },
      });
    }
  }

  function handleResponse(data) {
    const info = document.getElementById('ohc-autopos-info');
    const last = document.getElementById('ohc-autopos-last');
    if (data.result === 'ok' && data.entries && data.entries.length > 0) {
      const entry = data.entries[0];
      const newLat = parseFloat(entry.lat);
      const newLon = parseFloat(entry.lng);
      try {
        const config = JSON.parse(localStorage.getItem('openhamclock_config'));
        const oldLat = config.location.lat;
        const oldLon = config.location.lon;
        if (Math.abs(oldLat - newLat) > 0.0005 || Math.abs(oldLon - newLon) > 0.0005) {
          config.location = { lat: newLat, lon: newLon };
          config.locator = latLonToGrid(newLat, newLon);
          localStorage.setItem('openhamclock_config', JSON.stringify(config));
          window.dispatchEvent(new CustomEvent('openhamclock-config-change', { detail: config }));
          if (info) {
            info.innerText = t('status_updated');
            info.style.color = 'var(--accent-green)';
          }
        } else {
          if (info) {
            info.innerText = t('status_no_change');
            info.style.color = 'var(--text-muted)';
          }
        }
        if (last) last.innerText = `${entry.name}: ${newLat.toFixed(4)}, ${newLon.toFixed(4)}\n(${config.locator})`;
      } catch (e) {
        console.error(e);
      }
    } else {
      if (info) {
        info.innerText = t('error_api');
        info.style.color = 'var(--accent-red)';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
