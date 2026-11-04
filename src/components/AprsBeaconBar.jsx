/**
 * AprsBeaconBar — position beacons through the Rig Bridge APRS TNC plugin
 * (#1262), at the top of the EmComm Stations panel: on/off, "Beacon now",
 * and when the last one went out and whether a digipeater repeated it.
 *
 * Talks to the Rig Bridge this browser uses directly (not Cloud Relay). It
 * also hands the bridge OpenHamClock's station location, the beacon
 * position when the bridge has no override or GPS fix. Hidden when there is
 * no direct bridge, the APRS plugin is not running, or the bridge predates
 * beacon support.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 20_000;
const CONFIRM_RECHECK_MS = 5_000;

const btn = {
  background: '#1a1f2e',
  border: '1px solid #2a3040',
  borderRadius: '3px',
  color: '#ccc',
  fontSize: '10px',
  padding: '2px 7px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const ON = '#22c55e';

const SOURCE_LABEL = { override: 'set position', gps: 'GPS', station: 'station location' };

/** "just now" / "4 min ago" / "2 h ago" */
export function agoText(ms, now = Date.now()) {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}

/** "now" / "in 6 min" */
export function dueText(ms, now = Date.now()) {
  const min = Math.ceil((ms - now) / 60_000);
  return min <= 0 ? 'now' : `in ${min} min`;
}

export default function AprsBeaconBar({ rigUrl, apiToken = '', location, fetchImpl = globalThis.fetch }) {
  const [tnc, setTnc] = useState(null); // /api/aprs-tnc/status
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [, setTick] = useState(0); // re-render the "ago" text
  const pushedRef = useRef('');

  const headers = { 'Content-Type': 'application/json', ...(apiToken ? { 'X-RigBridge-Token': apiToken } : {}) };

  const refresh = useCallback(async () => {
    if (!rigUrl) return;
    try {
      const res = await fetchImpl(`${rigUrl}/api/aprs-tnc/status`);
      setTnc(res?.ok ? await res.json() : null);
    } catch {
      setTnc(null);
    }
  }, [rigUrl, fetchImpl]);

  useEffect(() => {
    if (!rigUrl) return undefined;
    refresh();
    const id = setInterval(() => {
      refresh();
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [rigUrl, refresh]);

  const running = !!tnc?.running && !!tnc?.beacon;
  const lat = location?.lat;
  const lon = location?.lon;

  // Tell the bridge where the station is, once per bridge and position.
  useEffect(() => {
    if (!running || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = `${rigUrl}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
    if (pushedRef.current === key) return;
    pushedRef.current = key;
    fetchImpl(`${rigUrl}/aprs/station-location`, { method: 'POST', headers, body: JSON.stringify({ lat, lon }) })
      .then((res) => {
        if (res?.ok) refresh();
        else pushedRef.current = ''; // retry on the next render
      })
      .catch(() => {
        pushedRef.current = '';
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- headers only change with apiToken
  }, [running, rigUrl, lat, lon, apiToken]);

  if (!rigUrl || !running) return null;

  const b = tnc.beacon;
  const post = async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchImpl(`${rigUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* no body */
      }
      if (!res?.ok)
        setError(res?.status === 401 ? 'Rig Bridge API token missing or wrong' : data?.error || `HTTP ${res?.status}`);
      else if (data?.error) setError(data.error); // switched on, but the first beacon could not go out
      if (data?.beacon) setTnc((prev) => (prev ? { ...prev, beacon: data.beacon } : prev));
      else refresh();
      // A digipeater's copy arrives a second or two after the send; look again.
      if (res?.ok) setTimeout(refresh, CONFIRM_RECHECK_MS);
    } catch {
      setError(`Rig Bridge not reachable at ${rigUrl}`);
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const heard =
    b.lastSent && b.lastHeard && b.lastHeard.at >= b.lastSent.at
      ? `heard via ${b.lastHeard.via}`
      : 'not heard by a digipeater yet';

  return (
    <div
      style={{
        background: '#0d1117',
        borderRadius: '4px',
        padding: '5px 8px',
        margin: '0 0 4px',
        fontSize: '10px',
        color: '#999',
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ color: '#ccc', fontWeight: 600 }}>Beacon</span>
        <button
          type="button"
          style={{ ...btn, ...(b.enabled ? { color: ON, borderColor: ON } : {}) }}
          onClick={() => post('/aprs/beacon/enabled', { enabled: !b.enabled })}
          disabled={busy}
          aria-pressed={b.enabled}
          title={
            b.enabled
              ? 'Stop sending position beacons'
              : `Send a position beacon every ${Math.round(b.intervalSec / 60)} min (transmits on RF)`
          }
        >
          {b.enabled ? `On · every ${Math.round(b.intervalSec / 60)} min` : 'Off'}
        </button>
        <button
          type="button"
          style={btn}
          onClick={() => post('/aprs/beacon/now')}
          disabled={busy || !tnc.connected}
          title="Send one position beacon now"
        >
          Beacon now
        </button>
        {!tnc.connected && <span style={{ color: '#f59e0b' }}>TNC not connected</span>}
      </div>
      <div>
        {b.lastSent ? (
          <>
            Last sent {agoText(b.lastSent.at, now)} · <span style={{ color: b.lastHeard ? ON : '#888' }}>{heard}</span>
            {b.enabled && b.nextDue ? ` · next ${dueText(b.nextDue, now)}` : ''}
          </>
        ) : (
          'No beacon sent yet'
        )}
      </div>
      <div style={{ color: '#666' }}>
        {b.position
          ? `${tnc.callsign} at ${b.position.lat.toFixed(4)}, ${b.position.lon.toFixed(4)} (${SOURCE_LABEL[b.position.source] || b.position.source})`
          : 'No position: set your station location, or a beacon position in Rig Bridge'}
        {b.comment ? ` · "${b.comment}"` : ''}
      </div>
      {(error || b.error) && (
        <div role="alert" style={{ color: '#ef4444' }}>
          {error || b.error}
        </div>
      )}
    </div>
  );
}
