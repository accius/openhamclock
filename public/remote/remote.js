/* OpenHamClock phone remote — drives one display through /api/control.
 * Plain JS, no build step. URL: /remote?target=<display id>&key=<pairing key>
 * The pairing key is the display's own secret (QR code / Settings → Station);
 * the server's API_WRITE_KEY works too. It is moved out of the address bar
 * into sessionStorage on connect and sent as Authorization: Bearer.
 * State comes from GET /api/control/state (what the display last reported);
 * every button is one POST /api/control/<command>. See docs/API.md.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  const LAYOUTS = [
    ['modern', 'Modern'],
    ['classic', 'Classic'],
    ['dockable', 'Dockable'],
    ['tablet', 'Tablet'],
    ['compact', 'Compact'],
    ['contest', 'Contest'],
    ['emcomm', 'EmComm'],
    ['eme', 'EME'],
    ['clock', 'Clock'],
    ['activator', 'Activator'],
    ['hunter', 'Hunter'],
    ['weather', 'Weather'],
    ['airtraffic', 'Air Traffic'],
    ['mobile', 'Mobile'],
  ];
  const THEMES = [
    'dark',
    'light',
    'legacy',
    'retro',
    'matrix',
    'eightbit',
    'steampunk',
    'trek',
    'midnight',
    'ember',
    'winter',
    'spring',
    'summer',
    'fall',
  ];
  const PROJECTIONS = [
    ['mercator', 'Flat'],
    ['azimuthal', 'Azimuthal'],
    ['globe3d', '3D globe'],
  ];
  const BASEMAPS = [
    'dark',
    'streets',
    'satellite',
    'MODIS',
    'terrain',
    'topo',
    'watercolor',
    'hybrid',
    'gray',
    'natgeo',
    'countries',
  ];
  const COMMON_LAYERS = [
    'grayline',
    'maidenhead',
    'satellites',
    'aurora',
    'citylights',
    'wxradar',
    'lightning',
    'great-circle',
    'muf-map',
    'voacap-heatmap',
    'wspr',
    'rbn',
    'active-users',
  ];
  const PANELS = [
    'world-map',
    'dx-cluster',
    'psk-reporter',
    'solar',
    'solar-indices',
    'propagation',
    'band-conditions',
    'pota',
    'sota',
    'wwff',
    'contests',
    'dxpeditions',
    'sat-passes',
    'lunar',
    'logbook',
    'rig-control',
    'world-clocks',
    'stopwatch',
    'aprs',
    'dx-news',
    'swpc-alerts',
    'meteor-showers',
    'repeaters',
    'callsign-search',
    'net-schedule',
    'keybindings',
  ];

  // ── Connection settings ───────────────────────────────────────────────
  let target = params.get('target') || sessionStorage.getItem('ohc-remote-target') || '';
  let key = params.get('key') || sessionStorage.getItem('ohc-remote-key') || '';
  let serverInfo = { requireTarget: false, writeKeyRequired: false };
  let state = null;
  let pollTimer = null;

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (key) h.Authorization = `Bearer ${key}`;
    return h;
  };
  const tq = () => (target ? `?target=${encodeURIComponent(target)}` : '');

  const toast = (msg, err = false) => {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.className = 'toast'), 2200);
  };
  const setStatus = (text, cls) => {
    $('statusText').textContent = text;
    $('statusDot').className = `dot ${cls || ''}`;
  };
  // "Paired ✓" once the server has accepted our key for a command / state
  // read; "not paired" after a 401/403. Empty until we know.
  let paired = null;
  const setPaired = (ok) => {
    paired = ok;
    const el = $('pairStatus');
    el.textContent = ok === null ? '' : ok ? 'Paired ✓' : 'not paired';
    el.className = `pair ${ok === null ? '' : ok ? 'ok' : 'bad'}`;
  };
  const authFailed = (status) => status === 401 || status === 403;

  async function send(cmd, body) {
    try {
      const res = await fetch(`/api/control/${cmd}${tq()}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (authFailed(res.status)) setPaired(false);
        toast(json.error || `HTTP ${res.status}`, true);
        return null;
      }
      if (paired !== true) setPaired(true);
      if (json.live === 0 && json.queued) toast('Display offline — queued');
      else toast(`✓ ${cmd}`);
      setTimeout(refresh, 800);
      return json;
    } catch (e) {
      toast(`Network error: ${e.message}`, true);
      return null;
    }
  }

  async function refresh() {
    if (!target && serverInfo.requireTarget) return;
    try {
      const res = await fetch(`/api/control/state${tq()}`, { headers: headers() });
      if (authFailed(res.status)) {
        // 403 also covers "display has not paired yet" (it has not reported
        // since the server started) — show the server's reason, not a guess.
        const json = await res.json().catch(() => ({}));
        const notPairedYet = res.status === 403 && /not paired yet/i.test(json.error || '');
        setPaired(notPairedYet ? null : false);
        setStatus(
          notPairedYet
            ? 'display not reporting yet — waiting'
            : json.error || (key ? 'pairing key not accepted' : 'pairing key required'),
          'bad',
        );
        return;
      }
      if (res.status === 404) {
        setStatus('display not reporting yet', 'bad');
        return;
      }
      if (!res.ok) {
        setStatus(`error ${res.status}`, 'bad');
        return;
      }
      const json = await res.json();
      // The server says how it let us in; 'open' (no key configured) proves nothing.
      if (json.auth === 'pairing' || json.auth === 'master') setPaired(true);
      if (json.displays && !target) {
        // Local fan-out server: adopt the first connected display for state rendering.
        const ids = Object.keys(json.displays);
        const connected = ids.find((id) => json.displays[id].connected) || ids[0];
        if (!connected) {
          setStatus('no displays yet', 'bad');
          return;
        }
        state = json.displays[connected].state;
        setStatus(`${ids.length} display${ids.length === 1 ? '' : 's'} (broadcast)`, 'ok');
      } else {
        state = json.state;
        const age = json.lastReport ? Math.round((Date.now() - json.lastReport) / 1000) : null;
        setStatus(
          json.connected ? `connected · ${state?.callsign || ''} · ${age}s ago` : 'display offline',
          json.connected ? 'ok' : 'bad',
        );
      }
      render();
    } catch {
      setStatus('server unreachable', 'bad');
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────
  const btn = (label, { cls = '', on = false, active = false, attrs = {} } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${cls}${on ? ' on' : ''}${active ? ' active' : ''}`;
    b.textContent = label;
    Object.entries(attrs).forEach(([k, v]) => b.setAttribute(k, v));
    return b;
  };
  const fill = (el, nodes) => {
    el.replaceChildren(...nodes);
  };

  function render() {
    const s = state || {};
    document.querySelectorAll('.card').forEach((c) => (c.hidden = false));
    $('setupCard').hidden = false;

    $('dxNow').textContent = s.dxCallsign || (s.dx ? `${s.dx.lat?.toFixed(1)}, ${s.dx.lon?.toFixed(1)}` : '');

    fill(
      $('layoutGrid'),
      LAYOUTS.map(([id, label]) => {
        const b = btn(label, { active: s.layout === id });
        b.onclick = () => send('layout', { layout: id });
        return b;
      }),
    );
    fill(
      $('themeGrid'),
      THEMES.map((id) => {
        const b = btn(id, { active: s.theme === id });
        b.onclick = () => send('theme', { theme: id });
        return b;
      }),
    );
    fill(
      $('projectionGrid'),
      PROJECTIONS.map(([id, label]) => {
        const b = btn(label, { active: s.projection === id });
        b.onclick = () => send('mapview', { projection: id });
        return b;
      }),
    );
    const bm = $('basemapSelect');
    if (!bm.options.length) {
      bm.append(new Option('basemap…', ''));
      BASEMAPS.forEach((id) => bm.append(new Option(id, id)));
      bm.onchange = () => bm.value && send('mapview', { basemap: bm.value });
    }
    if (s.basemap && bm.value !== s.basemap) bm.value = s.basemap;

    const layers = Array.isArray(s.layers) ? s.layers : [];
    const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
    const ordered = [
      ...COMMON_LAYERS.filter((id) => byId[id]),
      ...layers.map((l) => l.id).filter((id) => !COMMON_LAYERS.includes(id)),
    ];
    fill(
      $('layerGrid'),
      ordered.map((id) => {
        const l = byId[id];
        const b = btn(l.name || id, { on: !!l.enabled });
        b.onclick = () => send('mapview', { layers: { [id]: !l.enabled } });
        return b;
      }),
    );
    const grid = byId.maidenhead;
    $('gridBtn').className = `btn${grid?.enabled ? ' on' : ''}`;
    $('gridBtn').onclick = () => send('mapview', { grid: !grid?.enabled });
    $('nightBtn').onclick = () => {
      $('nightBtn').dataset.on = $('nightBtn').dataset.on === '1' ? '0' : '1';
      send('mapview', { night: $('nightBtn').dataset.on === '1' });
    };

    const sats = Array.isArray(s.satellites) ? s.satellites : [];
    const satNodes = sats.map((name) => {
      const b = btn(name);
      b.onclick = () => send('satellite', { name });
      return b;
    });
    const none = btn('None', { cls: 'ghost' });
    none.onclick = () => send('satellite', { name: 'none' });
    fill($('satGrid'), [none, ...satNodes]);
    $('satCard').querySelector('h2').innerHTML =
      `Satellite <small>${sats.length ? `${sats.length} tracked` : 'none tracked — add some in Settings → Satellites'}</small>`;

    $('panelsCard').hidden = s.layout !== 'dockable';
    const ps = $('panelSelect');
    if (!ps.options.length) PANELS.forEach((id) => ps.append(new Option(id, id)));
    fill(
      $('panelChips'),
      (s.panels || []).map((id) => {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip active';
        c.textContent = `${id} ×`;
        c.title = 'Remove panel';
        c.onclick = () => send('panels', { remove: [id] });
        return c;
      }),
    );

    const off = s.timeOffsetMs || 0;
    $('timeOffset').textContent = off ? `offset ${off > 0 ? '+' : ''}${(off / 3600000).toFixed(2)} h` : 'live';

    $('rigCard').hidden = !s.rigRelaySession;
    $('rigHint').textContent = s.rigRelaySession
      ? 'Tunes through the Rig Bridge cloud relay session this display uses.'
      : '';

    $('captureLink').href =
      `/api/control/capture.png${tq()}${key ? `${target ? '&' : '?'}key=${encodeURIComponent(key)}` : ''}`;
  }

  // ── Wiring ────────────────────────────────────────────────────────────
  function connect() {
    target = $('targetInput').value.trim();
    key = $('keyInput').value.trim();
    setPaired(null);
    sessionStorage.setItem('ohc-remote-target', target);
    sessionStorage.setItem('ohc-remote-key', key);
    const url = new URL(location.href);
    if (target) url.searchParams.set('target', target);
    else url.searchParams.delete('target');
    url.searchParams.delete('key'); // never keep the pairing key in the address bar / history
    history.replaceState(null, '', url.toString());
    if (!target && serverInfo.requireTarget) {
      toast('This server needs a display id — scan the QR in Settings → Station', true);
      return;
    }
    refresh();
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 5000);
  }

  $('connectBtn').onclick = connect;
  $('pickDisplayBtn').onclick = async () => {
    try {
      const res = await fetch('/api/control/displays', { headers: headers() });
      const json = await res.json();
      const list = json.displays || [];
      if (!list.length) return toast('No displays known yet', true);
      const pick = prompt(
        list.map((d, i) => `${i + 1}. ${d.id} ${d.callsign || ''} ${d.connected ? '(online)' : ''}`).join('\n') +
          '\n\nNumber:',
      );
      const d = list[parseInt(pick, 10) - 1];
      if (d) {
        $('targetInput').value = d.id;
        connect();
      }
    } catch {
      toast('Could not list displays', true);
    }
  };

  $('dxForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('dxInput').value.trim().toUpperCase();
    if (!v) return;
    const body = /^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/.test(v) ? { grid: v } : { call: v };
    send('dx', body);
  };
  $('deHereBtn').onclick = () => {
    if (!navigator.geolocation) return toast('No geolocation on this device', true);
    navigator.geolocation.getCurrentPosition(
      (pos) => send('de', { lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) }),
      () => toast('Location denied', true),
      { timeout: 8000 },
    );
  };

  $('panelAddBtn').onclick = () => send('panels', { add: [$('panelSelect').value] });
  $('panelRemoveBtn').onclick = () => send('panels', { remove: [$('panelSelect').value] });

  document.querySelectorAll('[data-time]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.time;
      if (v === 'now') return send('time', { time: 'now' });
      const cur = state?.timeOffsetMs || 0;
      send('time', { offsetMs: cur + parseInt(v, 10) });
    };
  });
  $('timeIsoBtn').onclick = () => {
    const iso = prompt('Show the display at (ISO 8601 UTC):', new Date().toISOString().slice(0, 16) + 'Z');
    if (iso) send('time', { iso });
  };

  $('alarmSetBtn').onclick = () => {
    const time = $('alarmTime').value;
    if (!time) return toast('Pick a time first', true);
    send('alarm', { kind: $('alarmDaily').checked ? 'daily' : 'once', time, utc: $('alarmUtc').checked, armed: true });
  };
  $('alarmOffBtn').onclick = () => send('alarm', { kind: 'off' });

  document
    .querySelectorAll('[data-sw]')
    .forEach((b) => (b.onclick = () => send('stopwatch', { action: b.dataset.sw })));
  $('countdownBtn').onclick = () =>
    send('stopwatch', { action: 'countdown', minutes: parseFloat($('countdownMin').value) || 10 });

  $('rigForm').onsubmit = async (e) => {
    e.preventDefault();
    const session = state?.rigRelaySession;
    if (!session) return toast('No rig relay on this display', true);
    const mhz = parseFloat($('rigFreq').value.replace(',', '.'));
    const mode = $('rigMode').value;
    const post = (type, payload) =>
      fetch(`/api/rig-bridge/relay/command?session=${encodeURIComponent(session)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      });
    try {
      if (Number.isFinite(mhz) && mhz > 0) await post('setFreq', { freq: Math.round(mhz * 1e6) });
      if (mode) await post('setMode', { mode });
      toast('✓ rig');
    } catch (err) {
      toast(`Rig: ${err.message}`, true);
    }
  };

  $('titleBtn').onclick = () => {
    const text = prompt('Title for the callsign box (up to six, separated by ;):', state?.title || '');
    if (text !== null) send('title', { text });
  };
  $('titleClearBtn').onclick = () => send('title', { text: null });

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    try {
      const res = await fetch('/api/control');
      serverInfo = await res.json();
    } catch {
      /* server info is optional */
    }
    $('targetInput').value = target;
    $('keyInput').value = key;
    $('pickDisplayBtn').hidden = !!serverInfo.requireTarget;
    $('setupHint').textContent = serverInfo.requireTarget
      ? 'This server requires a display id. Scan the QR code in Settings → Station on the display — it fills in the id and the pairing key.'
      : 'Leave the id empty to broadcast to every display on this server, or pick one.';
    if (serverInfo.writeKeyRequired && !key)
      $('setupHint').textContent += target
        ? ' Commands need this display’s pairing key (QR code / Settings → Station) or the server’s API_WRITE_KEY.'
        : ' Broadcast commands need the server’s API_WRITE_KEY; with a display id its pairing key is enough.';
    if (target || !serverInfo.requireTarget) connect();
    else setStatus('enter a display id', 'bad');
  })();
})();
