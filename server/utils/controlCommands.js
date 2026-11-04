/**
 * Remote-control command parser/validator (HamClock-style `set_*` API).
 *
 * Pure functions, no I/O: `server/routes/control.js` calls
 * parseControlCommand() for every POST /api/control/<name> and queues the
 * normalised command for the display(s). The browser side
 * (src/hooks/app/useRemoteControl.js) applies the `params` object verbatim,
 * so everything the browser could trip over (strings where numbers are
 * expected, huge arrays, odd ids) is rejected or clamped here.
 */

const { validateGridLocator, maidenheadToLatLon } = require('./grid.js');

// Keep in sync with src/components/CommandPalette.jsx LAYOUT_IDS (+ 'clock').
const LAYOUT_IDS = [
  'modern',
  'classic',
  'tablet',
  'compact',
  'dockable',
  'emcomm',
  'contest',
  'eme',
  'clock',
  'activator',
  'hunter',
  'weather',
  'airtraffic',
  'mobile',
];

// Keep in sync with src/theme/themeConfig.js AVAILABLE_THEMES.
const THEME_IDS = [
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
  'custom',
];

const PROJECTIONS = ['mercator', 'azimuthal', 'globe3d'];
const STOPWATCH_ACTIONS = ['reset', 'run', 'stop', 'lap', 'countdown'];
const ALARM_KINDS = ['once', 'daily', 'off'];

const COMMAND_TYPES = [
  'de',
  'dx',
  'layout',
  'theme',
  'panels',
  'mapview',
  'satellite',
  'time',
  'title',
  'alarm',
  'stopwatch',
  'rotator',
  'touch',
  'capture',
];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CALLSIGN_RE = /^[A-Z0-9/]{3,16}$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24})$/;
const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const MAX_TITLE_LEN = 60;
const MAX_TITLES = 6;
const MAX_PANEL_OPS = 20;
const MAX_LAYER_OPS = 50;
const MAX_TIME_OFFSET_MS = 100 * 365 * 24 * 3600 * 1000; // ±100 years

const fail = (error) => ({ ok: false, error });
const okCmd = (type, params) => ({ ok: true, command: { type, params } });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
};

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no'].includes(s)) return false;
  }
  return null;
};

/** Is this a usable display id (the browser's `controlId`)? */
function isValidControlId(id) {
  return typeof id === 'string' && CONTROL_ID_RE.test(id);
}

/**
 * Resolve a location from `{grid}` or `{lat, lon}`.
 * → { ok, lat, lon, grid } | { ok:false, error }
 */
function parseLocation(body, { allowEmpty = false } = {}) {
  if (!isPlainObject(body)) return fail('body must be a JSON object');
  const grid = typeof body.grid === 'string' ? body.grid.trim() : '';
  const hasLatLon = body.lat !== undefined || body.lon !== undefined;

  if (grid) {
    if (!validateGridLocator(grid) || grid.length < 4) {
      return fail('grid must be a 4, 6 or 8 character Maidenhead locator');
    }
    const ll = maidenheadToLatLon(grid);
    if (!ll) return fail('grid could not be converted');
    return { ok: true, lat: +ll.lat.toFixed(5), lon: +ll.lon.toFixed(5), grid: grid.toUpperCase() };
  }

  if (hasLatLon) {
    const lat = toNumber(body.lat);
    const lon = toNumber(body.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail('lat must be a number between -90 and 90');
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return fail('lon must be a number between -180 and 180');
    return { ok: true, lat, lon, grid: null };
  }

  if (allowEmpty) return { ok: true, lat: null, lon: null, grid: null };
  return fail('provide grid or lat+lon');
}

function parseCallsign(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return false;
  const call = raw.trim().toUpperCase();
  return CALLSIGN_RE.test(call) ? call : false;
}

function parseIdList(list, what) {
  if (list === undefined || list === null) return { ok: true, ids: [] };
  if (!Array.isArray(list)) return fail(`${what} must be an array of ids`);
  if (list.length > MAX_PANEL_OPS) return fail(`${what} may list at most ${MAX_PANEL_OPS} ids`);
  const ids = [];
  for (const id of list) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return fail(`${what} contains an invalid id`);
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Parse one control command.
 * @param {string} type  command name (URL segment after /api/control/)
 * @param {object} body  JSON body
 * @param {{ now?: number }} [opts]  injectable clock for tests
 * @returns {{ ok: true, command: { type, params } } | { ok: false, error }}
 */
function parseControlCommand(type, body, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  if (typeof type !== 'string' || !COMMAND_TYPES.includes(type)) {
    return fail(`unknown command '${type}'. Known: ${COMMAND_TYPES.join(', ')}`);
  }
  const b = isPlainObject(body) ? body : {};

  switch (type) {
    case 'de': {
      const loc = parseLocation(b);
      if (!loc.ok) return loc;
      const call = parseCallsign(b.call);
      if (call === false) return fail('call is not a valid callsign');
      return okCmd('de', { lat: loc.lat, lon: loc.lon, grid: loc.grid, call });
    }

    case 'dx': {
      const call = parseCallsign(b.call);
      if (call === false) return fail('call is not a valid callsign');
      const loc = parseLocation(b, { allowEmpty: !!call });
      if (!loc.ok) return loc;
      if (loc.lat === null && !call) return fail('provide grid, lat+lon, or call');
      return okCmd('dx', { lat: loc.lat, lon: loc.lon, grid: loc.grid, call });
    }

    case 'layout': {
      const layout = typeof b.layout === 'string' ? b.layout.trim() : '';
      if (!layout) return fail('layout is required');
      const [base, preset] = layout.split('#');
      if (!LAYOUT_IDS.includes(base)) return fail(`layout must be one of: ${LAYOUT_IDS.join(', ')}`);
      if (preset !== undefined && (base !== 'dockable' || !ID_RE.test(preset))) {
        return fail('only dockable layouts take a #preset suffix');
      }
      return okCmd('layout', { layout });
    }

    case 'theme': {
      const theme = typeof b.theme === 'string' ? b.theme.trim().toLowerCase() : '';
      if (!THEME_IDS.includes(theme)) return fail(`theme must be one of: ${THEME_IDS.join(', ')}`);
      return okCmd('theme', { theme });
    }

    case 'panels': {
      const add = parseIdList(b.add, 'add');
      if (!add.ok) return add;
      const remove = parseIdList(b.remove, 'remove');
      if (!remove.ok) return remove;
      let focus = null;
      if (b.focus !== undefined && b.focus !== null) {
        if (typeof b.focus !== 'string' || !ID_RE.test(b.focus)) return fail('focus must be a panel id');
        focus = b.focus;
      }
      if (!add.ids.length && !remove.ids.length && !focus) return fail('provide add, remove and/or focus');
      return okCmd('panels', { add: add.ids, remove: remove.ids, focus });
    }

    case 'mapview': {
      const params = {};
      let any = false;
      if (b.projection !== undefined) {
        const p = String(b.projection).toLowerCase();
        if (!PROJECTIONS.includes(p)) return fail(`projection must be one of: ${PROJECTIONS.join(', ')}`);
        params.projection = p;
        any = true;
      }
      if (b.basemap !== undefined) {
        if (typeof b.basemap !== 'string' || !ID_RE.test(b.basemap)) return fail('basemap must be a style id');
        params.basemap = b.basemap;
        any = true;
      }
      if (b.layers !== undefined) {
        if (!isPlainObject(b.layers)) return fail('layers must be an object of { layerId: boolean }');
        const entries = Object.entries(b.layers);
        if (entries.length > MAX_LAYER_OPS) return fail(`layers may list at most ${MAX_LAYER_OPS} ids`);
        const layers = {};
        for (const [id, v] of entries) {
          if (!ID_RE.test(id)) return fail(`layer id '${id}' is invalid`);
          const on = toBool(v);
          if (on === null) return fail(`layer '${id}' must be true or false`);
          layers[id] = on;
        }
        params.layers = layers;
        any = true;
      }
      for (const key of ['night', 'grid']) {
        if (b[key] !== undefined) {
          const on = toBool(b[key]);
          if (on === null) return fail(`${key} must be true or false`);
          params[key] = on;
          any = true;
        }
      }
      if (!any) return fail('provide projection, basemap, layers, night and/or grid');
      return okCmd('mapview', params);
    }

    case 'satellite': {
      const raw = b.name !== undefined ? b.name : b.satellite;
      if (raw === null || raw === undefined || raw === '' || String(raw).toLowerCase() === 'none') {
        return okCmd('satellite', { name: null });
      }
      if (typeof raw !== 'string' || raw.length > 40 || /[<>]/.test(raw)) return fail('name must be a satellite name');
      return okCmd('satellite', { name: raw.trim().toUpperCase() });
    }

    case 'time': {
      let offsetMs;
      const raw = b.time !== undefined ? b.time : b.offsetMs !== undefined ? b.offsetMs : b.iso;
      if (raw === 'now' || raw === undefined || raw === null || raw === '') {
        offsetMs = 0;
      } else if (b.offsetMs !== undefined || typeof raw === 'number') {
        offsetMs = toNumber(raw);
        if (!Number.isFinite(offsetMs)) return fail('offsetMs must be a number of milliseconds');
      } else {
        const t = Date.parse(String(raw));
        if (!Number.isFinite(t)) return fail("time must be 'now', an offset in ms, or an ISO 8601 date");
        offsetMs = t - now;
      }
      offsetMs = Math.round(offsetMs);
      if (Math.abs(offsetMs) > MAX_TIME_OFFSET_MS) return fail('time offset is out of range');
      return okCmd('time', { offsetMs });
    }

    case 'title': {
      const params = { text: null, fg: null, bg: null };
      if (b.text !== undefined && b.text !== null && b.text !== '') {
        if (typeof b.text !== 'string') return fail('text must be a string');
        const parts = b.text
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length > MAX_TITLES) return fail(`at most ${MAX_TITLES} titles separated by ';'`);
        if (parts.some((p) => p.length > MAX_TITLE_LEN))
          return fail(`each title may be at most ${MAX_TITLE_LEN} chars`);
        params.text = parts.join(';');
      }
      for (const key of ['fg', 'bg']) {
        if (b[key] !== undefined && b[key] !== null && b[key] !== '') {
          if (typeof b[key] !== 'string' || !COLOR_RE.test(b[key].trim())) return fail(`${key} must be a CSS color`);
          params[key] = b[key].trim();
        }
      }
      return okCmd('title', params);
    }

    case 'alarm': {
      const kind = typeof b.kind === 'string' ? b.kind.toLowerCase() : b.armed === false ? 'off' : 'once';
      if (!ALARM_KINDS.includes(kind)) return fail(`kind must be one of: ${ALARM_KINDS.join(', ')}`);
      if (kind === 'off') return okCmd('alarm', { kind: 'off', time: null, utc: false, armed: false });
      const time = typeof b.time === 'string' ? b.time.trim() : '';
      if (!TIME_HHMM_RE.test(time)) return fail('time must be HH:MM (24 h)');
      const utc = toBool(b.utc);
      const armed = b.armed === undefined ? true : toBool(b.armed);
      if (armed === null) return fail('armed must be true or false');
      return okCmd('alarm', { kind, time, utc: utc === null ? false : utc, armed });
    }

    case 'stopwatch': {
      const action = typeof b.action === 'string' ? b.action.toLowerCase() : '';
      if (!STOPWATCH_ACTIONS.includes(action)) return fail(`action must be one of: ${STOPWATCH_ACTIONS.join(', ')}`);
      const params = { action, minutes: null };
      if (action === 'countdown') {
        const minutes = toNumber(b.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 720) return fail('minutes must be 0 < m <= 720');
        params.minutes = minutes;
      }
      return okCmd('stopwatch', params);
    }

    case 'rotator': {
      const stop = toBool(b.stop) === true;
      const params = { az: null, el: null, stop };
      if (!stop) {
        if (b.az !== undefined) {
          const az = toNumber(b.az);
          if (!Number.isFinite(az)) return fail('az must be a number of degrees');
          params.az = Math.round((((az % 360) + 360) % 360) * 10) / 10;
        }
        if (b.el !== undefined) {
          const el = toNumber(b.el);
          if (!Number.isFinite(el) || el < 0 || el > 180) return fail('el must be 0..180 degrees');
          params.el = Math.round(el * 10) / 10;
        }
        if (params.az === null && params.el === null) return fail('provide az, el or stop');
      }
      return okCmd('rotator', params);
    }

    case 'touch': {
      const x = toNumber(b.x);
      const y = toNumber(b.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 8192 || y > 8192) {
        return fail('x and y must be integers between 0 and 8192');
      }
      return okCmd('touch', { x, y });
    }

    case 'capture':
      return okCmd('capture', {});

    default:
      return fail('unknown command');
  }
}

/**
 * Validate a browser-side state report. Returns a shallow copy with only
 * known, bounded fields, or null if the shape is unusable.
 */
function sanitizeStateReport(state) {
  if (!isPlainObject(state)) return null;
  const out = {};
  const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : null);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const loc = (v) => (isPlainObject(v) ? { lat: num(v.lat), lon: num(v.lon), grid: str(v.grid, 8) } : null);

  out.callsign = str(state.callsign, 16);
  out.de = loc(state.de);
  out.dx = loc(state.dx);
  out.dxCallsign = str(state.dxCallsign, 16);
  out.layout = str(state.layout, 80);
  out.theme = str(state.theme, 32);
  out.projection = str(state.projection, 16);
  out.basemap = str(state.basemap, 32);
  out.timeOffsetMs = num(state.timeOffsetMs) ?? 0;
  out.title = str(state.title, 400);
  out.kioskLocked = state.kioskLocked === true;
  out.demoMode = state.demoMode === true;
  out.rigRelaySession = str(state.rigRelaySession, 64);
  out.version = str(state.version, 24);

  const idArr = (v, max) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.length <= 64).slice(0, max) : [];
  out.panels = idArr(state.panels, 60);
  out.satellites = idArr(state.satellites, 60);

  out.layers = Array.isArray(state.layers)
    ? state.layers
        .filter((l) => isPlainObject(l) && typeof l.id === 'string' && ID_RE.test(l.id))
        .slice(0, 80)
        .map((l) => ({ id: l.id, name: str(l.name, 48) || l.id, enabled: l.enabled === true }))
    : [];
  return out;
}

module.exports = {
  COMMAND_TYPES,
  LAYOUT_IDS,
  THEME_IDS,
  PROJECTIONS,
  STOPWATCH_ACTIONS,
  isValidControlId,
  parseControlCommand,
  parseLocation,
  sanitizeStateReport,
};
