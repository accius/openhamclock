import React, { useEffect, useMemo, useState } from 'react';
import { useAmbientWeather } from '../hooks/useAmbientWeather.js';

const row = (label, value) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, margin: '2px 0' }}>
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
  </div>
);

const STORAGE_KEY = 'openhamclock_ambientPanel';

const DEFAULT_SHOW = {
  // Outside
  temp: true,
  feelsLike: true,
  humidity: true,
  dewPoint: false,

  // Pressure
  pressureRel: true,
  pressureAbs: false,

  // Wind
  windSpeed: true,
  windDir: true,
  windGust: false,
  maxDailyGust: false,
  windDirDeg: false,

  // Rain
  rainDaily: true,
  rainRate: true,
  rainHourly: false,
  rainWeekly: false,
  rainMonthly: false,
  rainYearly: false,

  // Indoor
  indoorTemp: false,
  indoorHumidity: false,
  indoorFeelsLike: false,
  indoorDewPoint: false,

  // Extras
  uv: false,
  solar: false,

  // Battery
  battOutOk: false,
  battInOk: false,
  battRainOk: false,
};

function safeLocalTimeString(v) {
  try {
    if (v == null || v === '') return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  } catch {
    return '';
  }
}

function loadPanelPrefs() {
  try {
    // localStorage may be unavailable in some environments; keep inside try
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { autoHideMissing: true, show: DEFAULT_SHOW, open: false };
    const parsed = JSON.parse(raw);
    return {
      autoHideMissing: parsed?.autoHideMissing ?? true,
      show: { ...DEFAULT_SHOW, ...(parsed?.show || {}) },
      open: false,
    };
  } catch {
    return { autoHideMissing: true, show: DEFAULT_SHOW, open: false };
  }
}

function savePanelPrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoHideMissing: prefs.autoHideMissing, show: prefs.show }));
  } catch {
    // ignore
  }
}

function fmtBoolOk(v) {
  if (v == null) return '--';
  return v ? 'OK' : 'LOW';
}

export default function AmbientPanel({ tempUnit = 'F' }) {
  // ✅ Hooks must always run in the same order
  const ambient = useAmbientWeather(tempUnit);
  const w = ambient.data;

  const [prefs, setPrefs] = useState(loadPanelPrefs);

  useEffect(() => {
    savePanelPrefs(prefs);
  }, [prefs]);

  // ✅ Derive units safely even when w is null
  const deg = `°${w?.tempUnit || tempUnit}`;
  const windUnit = w?.windUnit || 'mph';
  const rainUnit = w?.rainUnit || 'in';
  const pressureUnit = w?.pressureUnit || 'inHg';

  // ✅ useMemo MUST run on every render (return [] when no data)
  const rows = useMemo(() => {
    if (!w) return [];

    return [
      // Outside
      { key: 'temp', label: 'Temp', value: w.temp, fmt: (v) => `${v}${deg}`, group: 'outside' },
      { key: 'feelsLike', label: 'Feels', value: w.feelsLike, fmt: (v) => `${v}${deg}`, group: 'outside' },
      { key: 'humidity', label: 'Humidity', value: w.humidity, fmt: (v) => `${v}%`, group: 'outside' },
      { key: 'dewPoint', label: 'Dew Pt', value: w.dewPoint, fmt: (v) => `${v}${deg}`, group: 'outside' },

      // Pressure
      {
        key: 'pressureRel',
        label: 'Pressure (Rel)',
        value: w.pressureRel,
        fmt: (v) => `${v} ${pressureUnit}`,
        group: 'outside',
      },
      {
        key: 'pressureAbs',
        label: 'Pressure (Abs)',
        value: w.pressureAbs,
        fmt: (v) => `${v} ${pressureUnit}`,
        group: 'outside',
      },

      // Wind
      { key: 'windSpeed', label: 'Wind', value: w.windSpeed, fmt: (v) => `${v} ${windUnit}`, group: 'wind' },
      // NOTE: windDir is a compass string (E, ESE, etc.) — no degree symbol
      { key: 'windDir', label: 'Direction', value: w.windDir, fmt: (v) => `${v}`, group: 'wind' },
      { key: 'windDirDeg', label: 'Dir (deg)', value: w.windDirDeg, fmt: (v) => `${v}°`, group: 'wind' },
      { key: 'windGust', label: 'Gust', value: w.windGust, fmt: (v) => `${v} ${windUnit}`, group: 'wind' },
      { key: 'maxDailyGust', label: 'Max Gust', value: w.maxDailyGust, fmt: (v) => `${v} ${windUnit}`, group: 'wind' },

      // Rain
      { key: 'rainDaily', label: 'Rain Today', value: w.rainDaily, fmt: (v) => `${v} ${rainUnit}`, group: 'rain' },
      { key: 'rainRate', label: 'Rain Rate', value: w.rainRate, fmt: (v) => `${v} ${rainUnit}`, group: 'rain' },
      { key: 'rainHourly', label: 'Rain Hourly', value: w.rainHourly, fmt: (v) => `${v} ${rainUnit}`, group: 'rain' },
      { key: 'rainWeekly', label: 'Rain Weekly', value: w.rainWeekly, fmt: (v) => `${v} ${rainUnit}`, group: 'rain' },
      {
        key: 'rainMonthly',
        label: 'Rain Monthly',
        value: w.rainMonthly,
        fmt: (v) => `${v} ${rainUnit}`,
        group: 'rain',
      },
      { key: 'rainYearly', label: 'Rain Yearly', value: w.rainYearly, fmt: (v) => `${v} ${rainUnit}`, group: 'rain' },

      // Indoor
      { key: 'indoorTemp', label: 'Indoor Temp', value: w.indoorTemp, fmt: (v) => `${v}${deg}`, group: 'indoor' },
      {
        key: 'indoorHumidity',
        label: 'Indoor Humidity',
        value: w.indoorHumidity,
        fmt: (v) => `${v}%`,
        group: 'indoor',
      },
      {
        key: 'indoorFeelsLike',
        label: 'Indoor Feels',
        value: w.indoorFeelsLike,
        fmt: (v) => `${v}${deg}`,
        group: 'indoor',
      },
      {
        key: 'indoorDewPoint',
        label: 'Indoor Dew Pt',
        value: w.indoorDewPoint,
        fmt: (v) => `${v}${deg}`,
        group: 'indoor',
      },

      // Extras
      { key: 'uv', label: 'UV', value: w.uv, fmt: (v) => `${v}`, group: 'extras' },
      { key: 'solar', label: 'Solar', value: w.solar, fmt: (v) => `${v}`, group: 'extras' },

      // Battery
      { key: 'battOutOk', label: 'Batt Out', value: w.battOutOk, fmt: fmtBoolOk, group: 'battery' },
      { key: 'battInOk', label: 'Batt In', value: w.battInOk, fmt: fmtBoolOk, group: 'battery' },
      { key: 'battRainOk', label: 'Batt Rain', value: w.battRainOk, fmt: fmtBoolOk, group: 'battery' },
    ];
  }, [w, deg, windUnit, rainUnit, pressureUnit]);

  const hasError = !!ambient.error;
  const isLoading = !!ambient.loading;

  // Render helper (not a hook; safe anywhere)
  const Code = ({ children }) => (
    <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: 3 }}>{children}</code>
  );

  // ✅ Now it’s safe to early-return after hooks
  if (hasError && ambient.error?.code === 'missing_credentials') {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🌦️ Ambient Weather</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
          Missing Ambient credentials.
          <br />
          Put <Code>VITE_AMBIENT_API_KEY</Code> and <Code>VITE_AMBIENT_APPLICATION_KEY</Code> in <Code>.env.local</Code>
          , then restart.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🌦️ Ambient Weather</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (!w) {
    return (
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🌦️ Ambient Weather</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          No data yet. {hasError ? `(${ambient.error?.message || 'error'})` : ''}
        </div>
      </div>
    );
  }

  const filtered = rows.filter((r) => {
    if (!prefs.show[r.key]) return false;
    if (!prefs.autoHideMissing) return true;
    return !(r.value == null || r.value === '');
  });

  const byGroup = (g) => filtered.filter((r) => r.group === g);

  const outsideRows = byGroup('outside');
  const windRows = byGroup('wind');
  const rainRows = byGroup('rain');
  const indoorRows = byGroup('indoor');
  const extraRows = byGroup('extras');
  const batteryRows = byGroup('battery');

  const Toggle = ({ k, label }) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '4px 0' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      <input
        type="checkbox"
        checked={!!prefs.show[k]}
        onChange={(e) => setPrefs((p) => ({ ...p, show: { ...p.show, [k]: e.target.checked } }))}
      />
    </label>
  );

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>🌦️ Ambient Weather</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{safeLocalTimeString(w.lastUpdated)}</div>
          <button
            onClick={() => setPrefs((p) => ({ ...p, open: !p.open }))}
            title="Ambient display options"
            style={{
              cursor: 'pointer',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 12,
              lineHeight: '18px',
            }}
          >
            ⚙
          </button>
        </div>
      </div>

      {prefs.open && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            background: 'var(--bg-tertiary)',
          }}
        >
          <label
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}
          >
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Auto-hide missing values</span>
            <input
              type="checkbox"
              checked={!!prefs.autoHideMissing}
              onChange={(e) => setPrefs((p) => ({ ...p, autoHideMissing: e.target.checked }))}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
                Outside
              </div>
              <Toggle k="temp" label="Temp" />
              <Toggle k="feelsLike" label="Feels" />
              <Toggle k="humidity" label="Humidity" />
              <Toggle k="dewPoint" label="Dew Point" />
              <Toggle k="pressureRel" label="Pressure (Rel)" />
              <Toggle k="pressureAbs" label="Pressure (Abs)" />
            </div>

            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>Wind</div>
              <Toggle k="windSpeed" label="Wind Speed" />
              <Toggle k="windDir" label="Direction (N/NE/E…)" />
              <Toggle k="windDirDeg" label="Direction (deg)" />
              <Toggle k="windGust" label="Gust" />
              <Toggle k="maxDailyGust" label="Max Daily Gust" />
            </div>

            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>Rain</div>
              <Toggle k="rainDaily" label="Rain Today" />
              <Toggle k="rainRate" label="Rain Rate" />
              <Toggle k="rainHourly" label="Rain Hourly" />
              <Toggle k="rainWeekly" label="Rain Weekly" />
              <Toggle k="rainMonthly" label="Rain Monthly" />
              <Toggle k="rainYearly" label="Rain Yearly" />
            </div>

            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-primary)', marginBottom: 6 }}>
                Indoor / Extras
              </div>
              <Toggle k="indoorTemp" label="Indoor Temp" />
              <Toggle k="indoorHumidity" label="Indoor Humidity" />
              <Toggle k="indoorFeelsLike" label="Indoor Feels" />
              <Toggle k="indoorDewPoint" label="Indoor Dew Pt" />
              <Toggle k="uv" label="UV" />
              <Toggle k="solar" label="Solar" />
              <Toggle k="battOutOk" label="Batt Out" />
              <Toggle k="battInOk" label="Batt In" />
              <Toggle k="battRainOk" label="Batt Rain" />
            </div>
          </div>
        </div>
      )}

      {outsideRows.map((r) => row(r.label, r.value != null ? r.fmt(r.value) : '--'))}

      {windRows.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
          {windRows.map((r) => row(r.label, r.value != null ? r.fmt(r.value) : '--'))}
        </div>
      )}

      {rainRows.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
          {rainRows.map((r) => row(r.label, r.value != null ? r.fmt(r.value) : '--'))}
        </div>
      )}

      {indoorRows.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
          {indoorRows.map((r) => row(r.label, r.value != null ? r.fmt(r.value) : '--'))}
        </div>
      )}

      {(extraRows.length > 0 || batteryRows.length > 0) && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
          {extraRows.map((r) => row(r.label, r.value != null ? r.fmt(r.value) : '--'))}
          {batteryRows.map((r) => row(r.label, r.value != null ? r.fmt(r.value) : '--'))}
        </div>
      )}
    </div>
  );
}
