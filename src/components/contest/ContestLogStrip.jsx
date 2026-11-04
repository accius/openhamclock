/**
 * ContestLogStrip — the Contest layout's keyboard-first quick-log bar.
 *
 * One persistent callsign box: typing shows an instant DUPE / WORKED / NEW
 * verdict for the current band+mode (worked-before index) plus an award flag
 * when the call's DXCC entity would be a new one (ATNO) or a new band.
 *
 * The active contest definition (utils/contestDefs.js) drives everything
 * after the callsign box: exchange inputs render dynamically (RST, zone,
 * serial, precedence/check/section, name, …) with per-field validation and
 * cty.dat autofill, serial contests show the auto sent serial, and Enter
 * logs the QSO with the full ADIF contest mapping (CONTEST_ID, STX/SRX,
 * STX_STRING/SRX_STRING, CQZ/ITUZ/CLASS/ARRL_SECT/…) in `extras`.
 *
 * Populate paths: clicking a DX-cluster spot row in the Contest layout and
 * the 📓 log-this-spot buttons (logbookStore prefill stream) both drop the
 * call into the box and focus the first exchange field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRig } from '../../contexts/RigContext.jsx';
import { useWorkedBefore } from '../../hooks/useWorkedBefore.js';
import { useAwards } from '../../hooks/useAwards.js';
import { useGroupLog } from '../../hooks/useGroupLog.js';
import { add as addQso, consumePendingPrefill, subscribePrefill } from '../../services/logbookStore.js';
import { onQsoLogged } from '../../utils/logsync.js';
import { getBandFromFreq } from '../../utils/callsign.js';
import { ctyLookup } from '../../utils/ctyLookup.js';
import { buildQsoContestFields, sentFieldsFor, sentExchangeReady } from '../../utils/contestDefs.js';

const BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];
const MODES = ['SSB', 'CW', 'FT8', 'FT4', 'RTTY', 'PSK31', 'FM', 'AM'];

/** Representative in-band frequency (MHz) when no rig supplies the real one. */
const BAND_FREQ_MHZ = {
  '160m': 1.9,
  '80m': 3.7,
  '60m': 5.36,
  '40m': 7.1,
  '30m': 10.12,
  '20m': 14.2,
  '17m': 18.12,
  '15m': 21.25,
  '12m': 24.95,
  '10m': 28.4,
  '6m': 50.15,
  '2m': 145,
  '70cm': 435,
};

const PHONE_MODES = new Set(['SSB', 'USB', 'LSB', 'AM', 'FM']);
const rstFor = (mode) => (PHONE_MODES.has(String(mode || '').toUpperCase()) ? '59' : '599');

/** Collapse a rig mode string to a loggable ADIF-ish mode. */
const logModeFromRig = (rigMode) => {
  const m = String(rigMode || '')
    .trim()
    .toUpperCase();
  if (!m) return '';
  if (m === 'USB' || m === 'LSB') return 'SSB';
  if (m.startsWith('CW')) return 'CW';
  if (m.startsWith('DATA') || m.startsWith('PKT') || m === 'RTTY-R') return 'DATA';
  return m;
};

const utcNowFields = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    qso_date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    time_on: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
  };
};

const BADGES = {
  dupe: { text: 'DUPE', color: '#ef4444', title: 'Already worked on this band+mode' },
  worked: { text: 'WKD', color: '#f59e0b', title: 'In the log, but not on this band+mode' },
  new: { text: 'NEW', color: '#22c55e', title: 'Not in the log' },
};

const AWARD_BADGES = {
  new: { text: 'NEW ENTITY', color: '#a855f7', title: 'DXCC entity not in the log at all (ATNO)' },
  'new-band': { text: 'NEW BAND', color: '#22d3ee', title: 'Entity worked, but not on this band' },
};

const selectStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
  padding: '5px 6px',
};

const exchangeInputStyle = (width, invalid) => ({
  width: `${width}px`,
  padding: '7px 6px',
  background: 'var(--bg-secondary)',
  border: `1px solid ${invalid ? '#ef4444' : 'var(--border-color)'}`,
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '15px',
  fontWeight: 700,
  fontFamily: 'var(--font-mono)',
  textAlign: 'center',
});

const fieldLabelStyle = {
  fontSize: '8px',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '2px',
  textAlign: 'center',
};

const cleanExchangeValue = (field, raw) => {
  let v = String(raw || '');
  v = field.uppercase || field.serial || field.rst ? v.toUpperCase() : v;
  return v.replace(/[^A-Za-z0-9]/g, '');
};

/**
 * @param {object}   props
 * @param {string}   props.userCallsign
 * @param {string}   props.myGrid
 * @param {object}   props.def           active contestDefs definition
 * @param {object}   props.sentExchange  session sent-side values { key: value }
 * @param {Function} props.onSentExchangeSave (map) => void
 * @param {number}   props.nextSerial    sent serial for the next QSO
 * @param {object}   [props.apiRef]      ref that receives { populate(call) }
 */
export const ContestLogStrip = ({
  userCallsign,
  myGrid,
  def,
  sentExchange,
  onSentExchangeSave,
  nextSerial,
  apiRef,
}) => {
  const { connected, freq: rigFreqHz, mode: rigModeRaw, tuneEnabled } = useRig();
  const { getStatus: getWorkedStatus, hasData: hasLogData } = useWorkedBefore();
  const { getSpotStatus: getAwardStatus } = useAwards();
  // Group session (Field Day multi-station logging). Mounting the hook here
  // also resumes a persisted session in the Contest layout, so mirroring
  // keeps running even when no Logbook panel is open.
  const { session: groupSession, qsos: groupQsos, findDupes: findGroupDupes } = useGroupLog();

  const [call, setCall] = useState('');
  const [manualBand, setManualBand] = useState('20m');
  const [manualMode, setManualMode] = useState('SSB');
  const [lastLogged, setLastLogged] = useState(null); // { call, band, mode, time_on }
  const [error, setError] = useState(null); // subtle red validation hint
  const inputRef = useRef(null);
  const fieldRefs = useRef({}); // exchange input elements by field key

  // Re-resolve the user's own entity once cty.dat lands (sent-side autofill,
  // ARRL DX side detection).
  const [ctyTick, setCtyTick] = useState(0);
  useEffect(() => {
    const onCty = () => setCtyTick((n) => n + 1);
    window.addEventListener('openhamclock-cty-loaded', onCty);
    return () => window.removeEventListener('openhamclock-cty-loaded', onCty);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const myResolved = useMemo(() => ctyLookup(userCallsign), [userCallsign, ctyTick]);

  const rigActive = connected && rigFreqHz > 0;
  const freqMHz = rigActive ? rigFreqHz / 1e6 : BAND_FREQ_MHZ[manualBand];
  const band = rigActive ? getBandFromFreq(rigFreqHz) : manualBand;
  const mode = rigActive ? logModeFromRig(rigModeRaw) || manualMode : manualMode;

  const trimmed = call.trim().toUpperCase();

  // ── Exchange values (per active def) ──────────────────────────────────────
  // modeRef keeps defaultValues stable across mode changes (a mode flip must
  // not wipe a half-typed exchange) while still yielding the current RST.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const defaultValues = useCallback(() => {
    const v = {};
    for (const f of def.exchange) v[f.key] = f.rst ? rstFor(modeRef.current) : '';
    return v;
  }, [def]);
  const [values, setValues] = useState(defaultValues);
  const dirtyRef = useRef(new Set());

  // Def switch → fresh columns. Mode switch → refresh untouched RST default.
  useEffect(() => {
    dirtyRef.current = new Set();
    setValues(defaultValues());
    setError(null);
  }, [def.id, defaultValues]);
  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const f of def.exchange) {
        if (f.rst && !dirtyRef.current.has(f.key)) next[f.key] = rstFor(mode);
      }
      return next;
    });
  }, [mode, def]);

  // Autofill received-side fields from cty.dat as soon as a call is typed
  // (or populated from a spot). User-edited fields are never overwritten.
  useEffect(() => {
    const resolved = trimmed.length >= 3 ? ctyLookup(trimmed) : null;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const f of def.exchange) {
        if (!f.autofillRcvd || dirtyRef.current.has(f.key)) continue;
        const want = resolved ? String(f.autofillRcvd(resolved) ?? '') : '';
        if (next[f.key] !== want) {
          next[f.key] = want;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [trimmed, def, ctyTick]);

  // ── Sent-side session values (setup row) ──────────────────────────────────
  const sentFields = useMemo(() => sentFieldsFor(def, myResolved), [def, myResolved]);
  const sentReady = useMemo(() => sentExchangeReady(def, sentExchange, myResolved), [def, sentExchange, myResolved]);
  const [sentDraft, setSentDraft] = useState({});
  useEffect(() => {
    // Seed the draft from the stored values + cty autofill (my zone).
    const d = {};
    for (const f of sentFields) {
      const stored = String(sentExchange?.[f.key] ?? '');
      d[f.key] = stored || (f.autofillSent ? String(f.autofillSent(myResolved) ?? '') : '');
    }
    setSentDraft(d);
  }, [def.id, sentFields, sentExchange, myResolved]);

  const sentDraftValid = sentFields.every((f) => {
    const v = String(sentDraft[f.key] || '').trim();
    return v && (!f.validate || f.validate(v) === true);
  });
  const saveSentDraft = () => {
    if (!sentDraftValid) return;
    const map = {};
    for (const f of sentFields) {
      map[f.key] = String(sentDraft[f.key] || '')
        .trim()
        .toUpperCase();
    }
    onSentExchangeSave?.(map);
    inputRef.current?.focus();
  };

  // ── Populate (spot click / 📓 prefill stream) ─────────────────────────────
  const populate = useCallback(
    (rawCall) => {
      const c = String(rawCall || '')
        .toUpperCase()
        .replace(/[^A-Z0-9/]/g, '');
      if (!c) return;
      setCall(c);
      setError(null);
      // Focus the first exchange field so the operator types the exchange
      // straight away (autofill has already filled what cty.dat knows).
      requestAnimationFrame(() => {
        const first = def.exchange[0];
        const el = first ? fieldRefs.current[first.key] : null;
        if (el) {
          el.focus();
          el.select?.();
        } else {
          inputRef.current?.focus();
        }
      });
    },
    [def],
  );

  useEffect(() => {
    if (apiRef) apiRef.current = { populate };
    return () => {
      if (apiRef && apiRef.current?.populate === populate) apiRef.current = null;
    };
  }, [apiRef, populate]);

  // The 📓 log-this-spot buttons publish to the logbookStore prefill stream;
  // in the Contest layout the strip is the consumer (the app-level pop-up
  // deliberately stands down here — see LogQsoPopup.jsx).
  useEffect(() => {
    const pending = consumePendingPrefill();
    if (pending?.call) populate(pending.call);
    return subscribePrefill(() => {
      const p = consumePendingPrefill();
      if (p?.call) populate(p.call);
    });
  }, [populate]);

  // ── Verdict badges ────────────────────────────────────────────────────────
  const workedStatus = useMemo(
    () => (trimmed.length >= 3 ? getWorkedStatus(trimmed, freqMHz, mode) : null),
    [trimmed, freqMHz, mode, getWorkedStatus],
  );
  const awardStatus = useMemo(
    () => (trimmed.length >= 3 ? getAwardStatus(trimmed, freqMHz) : null),
    [trimmed, freqMHz, getAwardStatus],
  );
  // Group-session dupe: another station in the session already worked this
  // call on this band+mode. Own contacts are covered by the personal DUPE
  // badge (they're in the local log too), so only cross-station hits get the
  // distinct badge — and it names the operator, so you can shout across the
  // tent.
  const groupDupeBy = useMemo(() => {
    if (!groupSession || trimmed.length < 3) return null;
    const dupe = findGroupDupes(trimmed, band, mode).find((q) => q.operator && q.operator !== groupSession.call);
    return dupe ? dupe.operator : null;
    // groupQsos is read indirectly through findGroupDupes; keep it so the memo refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSession, groupQsos, trimmed, band, mode, findGroupDupes]);
  const badge =
    trimmed.length >= 3
      ? groupDupeBy
        ? { text: 'GRP DUPE', color: '#ef4444', title: `Already worked by ${groupDupeBy} on this band+mode` }
        : BADGES[workedStatus || 'new']
      : null;
  const awardBadge = awardStatus ? AWARD_BADGES[awardStatus] : null;

  // ── Log it ────────────────────────────────────────────────────────────────
  const logIt = useCallback(async () => {
    if (!trimmed || !/\d/.test(trimmed) || trimmed.length < 3) return;

    if (sentFields.length > 0 && !sentReady) {
      setError('Fill in your sent exchange first (row below)');
      return;
    }
    for (const f of def.exchange) {
      const v = String(values[f.key] || '').trim();
      if (!v) {
        setError(`${f.label} required`);
        fieldRefs.current[f.key]?.focus();
        return;
      }
      if (f.validate) {
        const r = f.validate(v);
        if (r !== true) {
          setError(`${f.label}: ${r}`);
          fieldRefs.current[f.key]?.focus();
          return;
        }
      }
    }
    setError(null);

    const contest = buildQsoContestFields(def, {
      mode,
      rcvd: values,
      sent: sentExchange || {},
      serialSent: def.serial ? nextSerial : undefined,
      myResolved,
    });
    const hasRst = def.exchange.some((f) => f.rst);
    const record = {
      call: trimmed,
      ...utcNowFields(),
      band: band && band !== 'other' ? band : '',
      mode,
      freq: rigActive ? Math.round((rigFreqHz / 1e6) * 1e6) / 1e6 : undefined,
      ...(hasRst ? { rst_sent: rstFor(mode), rst_rcvd: contest.rstRcvd || rstFor(mode) } : {}),
      my_gridsquare: myGrid || '',
      ...contest.core,
      extras: contest.extras,
    };
    const saved = await addQso(record);
    // Wavelog/QRZ push when those integrations are enabled (retry queue).
    onQsoLogged(saved, { myCall: userCallsign });
    setLastLogged({ call: record.call, band: record.band, mode: record.mode, time_on: record.time_on });
    setCall('');
    dirtyRef.current = new Set();
    setValues(defaultValues());
    inputRef.current?.focus();
  }, [
    trimmed,
    def,
    values,
    sentExchange,
    sentFields,
    sentReady,
    nextSerial,
    myResolved,
    band,
    mode,
    rigActive,
    rigFreqHz,
    myGrid,
    userCallsign,
    defaultValues,
  ]);

  const onEnterKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      logIt();
    } else if (e.key === 'Escape') {
      setCall('');
      dirtyRef.current = new Set();
      setValues(defaultValues());
      setError(null);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="panel no-theme-header"
      style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}
    >
      {/* Sent-exchange setup row — shown until the def's sent values exist */}
      {sentFields.length > 0 && !sentReady && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            padding: '4px 6px',
            background: 'var(--bg-tertiary)',
            borderRadius: '6px',
          }}
        >
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent-amber)' }}>
            {def.name} — your sent exchange:
          </span>
          {sentFields.map((f) => (
            <label
              key={f.key}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: 'var(--text-muted)' }}
            >
              {f.label}
              <input
                type="text"
                value={sentDraft[f.key] || ''}
                onChange={(e) => setSentDraft((prev) => ({ ...prev, [f.key]: cleanExchangeValue(f, e.target.value) }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveSentDraft();
                  }
                }}
                aria-label={f.label}
                spellCheck={false}
                autoComplete="off"
                style={exchangeInputStyle(
                  f.width || 56,
                  sentDraft[f.key] && f.validate && f.validate(sentDraft[f.key]) !== true,
                )}
              />
            </label>
          ))}
          <button
            onClick={saveSentDraft}
            disabled={!sentDraftValid}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: sentDraftValid ? 'var(--accent-green)' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 600,
              padding: '4px 10px',
              cursor: sentDraftValid ? 'pointer' : 'default',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Save
          </button>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Logging enables once saved.</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          type="text"
          value={call}
          autoFocus
          onChange={(e) => {
            setCall(e.target.value.toUpperCase().replace(/[^A-Z0-9/]/g, ''));
            setError(null);
          }}
          onKeyDown={onEnterKey}
          placeholder="CALLSIGN — Enter logs, Esc clears"
          aria-label="Quick log callsign entry"
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: '1 1 200px',
            minWidth: '170px',
            padding: '8px 12px',
            background: 'var(--bg-secondary)',
            border: `2px solid ${badge ? badge.color : 'var(--border-color)'}`,
            borderRadius: '6px',
            color: 'var(--text-primary)',
            fontSize: '20px',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '1px',
            textTransform: 'uppercase',
          }}
        />

        {/* Exchange inputs — driven by the active contest definition */}
        {def.serial && (
          <div style={{ textAlign: 'center' }} title="Your sent serial — session QSO count + 1">
            <div style={fieldLabelStyle}>Sent</div>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent-cyan)',
                padding: '7px 4px',
              }}
            >
              #{String(nextSerial || 1).padStart(3, '0')}
            </div>
          </div>
        )}
        {def.exchange.map((f) => {
          const v = values[f.key] || '';
          const invalid = v.trim() !== '' && f.validate && f.validate(v.trim()) !== true;
          return (
            <div key={f.key}>
              <div style={fieldLabelStyle}>{f.serial ? 'Rcvd serial' : f.label}</div>
              <input
                ref={(el) => {
                  fieldRefs.current[f.key] = el;
                }}
                type="text"
                value={v}
                onChange={(e) => {
                  dirtyRef.current.add(f.key);
                  setValues((prev) => ({ ...prev, [f.key]: cleanExchangeValue(f, e.target.value) }));
                  setError(null);
                }}
                onKeyDown={onEnterKey}
                placeholder={f.placeholder || ''}
                aria-label={`Received ${f.label}`}
                spellCheck={false}
                autoComplete="off"
                style={exchangeInputStyle(f.width || 56, invalid)}
              />
            </div>
          );
        })}

        {/* Verdict badges */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {badge && (
            <span
              title={badge.title}
              style={{
                background: `${badge.color}22`,
                border: `1px solid ${badge.color}`,
                color: badge.color,
                fontSize: '12px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                padding: '3px 10px',
                borderRadius: '4px',
                letterSpacing: '1px',
              }}
            >
              {badge.text}
            </span>
          )}
          {awardBadge && (
            <span
              title={awardBadge.title}
              style={{
                background: `${awardBadge.color}22`,
                border: `1px solid ${awardBadge.color}`,
                color: awardBadge.color,
                fontSize: '10px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                padding: '3px 8px',
                borderRadius: '4px',
                letterSpacing: '0.5px',
              }}
            >
              {awardBadge.text}
            </span>
          )}
          {badge && !hasLogData && (
            <span
              style={{ fontSize: '9px', color: 'var(--text-muted)' }}
              title="Dupe checking starts once the log has QSOs"
            >
              (log empty)
            </span>
          )}
        </div>

        {/* Band / mode: live from the rig, manual picks otherwise */}
        {rigActive ? (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)' }}
            title={tuneEnabled ? 'Following the rig (click-to-tune enabled)' : 'Following the rig'}
          >
            <span style={{ color: 'var(--accent-green)', fontSize: '10px', fontWeight: 700 }}>● RIG</span>
            <span style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600 }}>
              {(rigFreqHz / 1e6).toFixed(3)} MHz
            </span>
            <span style={{ color: 'var(--accent-amber)', fontSize: '13px', fontWeight: 600 }}>
              {band !== 'other' ? band : ''} {mode}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              value={manualBand}
              onChange={(e) => {
                setManualBand(e.target.value);
                inputRef.current?.focus();
              }}
              aria-label="Band"
              style={selectStyle}
            >
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              value={manualMode}
              onChange={(e) => {
                setManualMode(e.target.value);
                inputRef.current?.focus();
              }}
              aria-label="Mode"
              style={selectStyle}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Validation hint / last logged confirmation */}
        <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', minWidth: '150px' }}>
          {error ? (
            <span style={{ color: '#ef4444', fontWeight: 600 }}>{error}</span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              {lastLogged
                ? `✓ ${lastLogged.call} · ${lastLogged.band} ${lastLogged.mode} · ${lastLogged.time_on.slice(0, 2)}:${lastLogged.time_on.slice(2, 4)}z`
                : 'No QSO logged yet this view'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContestLogStrip;
