/**
 * QsoForm — the shared New/Edit QSO entry form.
 *
 * Extracted from LogbookPanel so the same form serves two hosts:
 *   • LogbookPanel — inline, for both New QSO and Edit QSO
 *   • LogQsoPopup  — app-level modal for "log from spot" (📓+) in layouts
 *     that have no Logbook panel mounted
 *
 * The form owns its field state; the CALLER owns persistence. On submit the
 * normalized, ADIF-ready record (no id) is handed to onSaved(record) — the
 * caller decides add vs update and any log-sync hand-off. Hosts remount the
 * form (React `key`) to reset it for a new prefill or a different QSO.
 *
 * Behavior preserved from the original LogbookPanel form:
 *   • rig prefill — a new QSO with no freq in the prefill takes freq/mode
 *     from the connected rig
 *   • RST defaults follow the mode (59 phone / 599 CW+digital), and typing a
 *     mode only replaces RSTs still at a default value
 *   • freq input auto-derives the band
 *
 * Props:
 *   prefill  — partial fields for a NEW QSO ({ call, freq (MHz), mode, ... })
 *   editQso  — full QSO record when editing (submit label becomes Save)
 *   onSaved(record) — required; receives the normalized record on submit
 *   onCancel — Cancel button handler
 *   onDelete — optional; shows the Delete button (edit mode)
 *   myGrid   — operator grid stamped into record.my_gridsquare
 *   autoFocusCall — focus the callsign input on mount (popup host)
 */
import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBandFromFreq } from '../utils/callsign.js';
import { useRig } from '../contexts/RigContext.jsx';
import { tunedSpotForRig } from '../services/logbookStore.js';

export const BANDS = [
  '630m',
  '160m',
  '80m',
  '60m',
  '40m',
  '30m',
  '20m',
  '17m',
  '15m',
  '12m',
  '10m',
  '6m',
  '4m',
  '2m',
  '70cm',
];

export const MODES = ['SSB', 'CW', 'FT8', 'FT4', 'RTTY', 'PSK31', 'JS8', 'AM', 'FM', 'DIGITALVOICE', 'MFSK', 'OLIVIA'];

const PHONE_MODES = new Set(['SSB', 'USB', 'LSB', 'AM', 'FM', 'DIGITALVOICE']);
const rstDefaultFor = (mode) => (PHONE_MODES.has(String(mode || '').toUpperCase()) ? '59' : '599');
const isDefaultRst = (v) => v === '' || v === '59' || v === '599';

const utcNowFields = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    qso_date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    time_on: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
  };
};

/** Band derived from the freq input (MHz); '' when unknown. */
const bandForFreq = (freq) => {
  const f = parseFloat(freq);
  if (!Number.isFinite(f) || f <= 0) return '';
  const band = getBandFromFreq(f);
  return band === 'other' ? '' : band;
};

const blankForm = () => ({
  call: '',
  ...utcNowFields(),
  band: '',
  mode: 'SSB',
  freq: '',
  rst_sent: '59',
  rst_rcvd: '59',
  gridsquare: '',
  name: '',
  comment: '',
  tx_pwr: '',
});

export const inputStyle = {
  padding: '4px 6px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  minWidth: 0,
  width: '100%',
};

export const smallBtnStyle = (active, color = 'var(--accent-green)') => ({
  background: active ? 'rgba(0, 255, 136, 0.15)' : 'rgba(100, 100, 100, 0.3)',
  border: `1px solid ${active ? color : '#666'}`,
  color: active ? color : '#888',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

/** Form values for editing an existing QSO record. */
const formFromQso = (qso) => ({
  call: qso.call || '',
  qso_date: qso.qso_date || '',
  time_on: qso.time_on || '',
  band: qso.band || '',
  mode: qso.mode || '',
  freq: qso.freq != null ? String(qso.freq) : '',
  rst_sent: qso.rst_sent || '',
  rst_rcvd: qso.rst_rcvd || '',
  gridsquare: qso.gridsquare || '',
  name: qso.name || '',
  comment: qso.comment || '',
  tx_pwr: qso.tx_pwr || '',
});

/** Form values for a new QSO from a (possibly empty) prefill + rig state. */
const formFromPrefill = (prefill, rigFreqMHz, rigMode) => {
  const base = blankForm();
  // Prefill from the rig when the spot didn't bring a frequency.
  if (prefill?.freq == null && rigFreqMHz) {
    base.freq = rigFreqMHz.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    if (rigMode) base.mode = rigMode.toUpperCase();
  }
  const merged = { ...base, ...(prefill || {}) };
  if (merged.freq != null && merged.freq !== '') {
    merged.freq = String(merged.freq);
    merged.band = bandForFreq(merged.freq) || merged.band || '';
  }
  if (merged.mode) {
    const def = rstDefaultFor(merged.mode);
    merged.rst_sent = def;
    merged.rst_rcvd = def;
  }
  return merged;
};

export const QsoForm = ({ prefill, editQso, onSaved, onCancel, onDelete, myGrid, autoFocusCall = false }) => {
  const { t } = useTranslation();

  // Rig state is optional — the form renders inside RigProvider in the app,
  // but stay resilient if it is ever mounted elsewhere (tests, storybooks).
  let rig = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    rig = useRig();
  } catch {
    rig = null;
  }
  const rigFreqMHz = rig?.connected && rig.freq > 0 ? rig.freq / 1e6 : null;
  const rigMode = rig?.connected ? rig.mode || '' : '';

  const editing = !!editQso;
  const [form, setForm] = useState(() =>
    editQso ? formFromQso(editQso) : formFromPrefill(prefill, rigFreqMHz, rigMode),
  );

  const callInputRef = useRef(null);
  useEffect(() => {
    if (autoFocusCall) callInputRef.current?.focus();
  }, [autoFocusCall]);

  const setField = (name, value) => setForm((f) => ({ ...f, [name]: value }));

  const onFreqChange = (value) => {
    setForm((f) => ({ ...f, freq: value, band: bandForFreq(value) || f.band }));
  };

  const onModeChange = (value) => {
    setForm((f) => {
      const def = rstDefaultFor(value);
      return {
        ...f,
        mode: value,
        rst_sent: isDefaultRst(f.rst_sent) ? def : f.rst_sent,
        rst_rcvd: isDefaultRst(f.rst_rcvd) ? def : f.rst_rcvd,
      };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const call = form.call.trim().toUpperCase();
    if (!call) return;
    const freqNum = parseFloat(form.freq);
    onSaved({
      call,
      qso_date: form.qso_date.trim(),
      time_on: form.time_on.trim(),
      band: form.band || bandForFreq(form.freq),
      mode: (form.mode || '').trim().toUpperCase(),
      freq: Number.isFinite(freqNum) ? freqNum : undefined,
      rst_sent: form.rst_sent.trim(),
      rst_rcvd: form.rst_rcvd.trim(),
      gridsquare: form.gridsquare.trim(),
      name: form.name.trim(),
      comment: form.comment.trim(),
      tx_pwr: form.tx_pwr.trim(),
      my_gridsquare: myGrid || '',
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr auto', gap: '4px' }}>
        <input
          ref={callInputRef}
          type="text"
          required
          placeholder={t('logbook.form.call', { defaultValue: 'Callsign' })}
          aria-label={t('logbook.form.call', { defaultValue: 'Callsign' })}
          value={form.call}
          onChange={(e) => setField('call', e.target.value.toUpperCase())}
          style={{ ...inputStyle, textTransform: 'uppercase', fontWeight: 700 }}
        />
        <input
          type="text"
          placeholder="YYYYMMDD"
          aria-label={t('logbook.form.date', { defaultValue: 'QSO date (UTC, YYYYMMDD)' })}
          value={form.qso_date}
          onChange={(e) => setField('qso_date', e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="HHMMSS"
          aria-label={t('logbook.form.time', { defaultValue: 'Time on (UTC, HHMMSS)' })}
          value={form.time_on}
          onChange={(e) => setField('time_on', e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, ...utcNowFields() }))}
          title={t('logbook.form.nowTooltip', { defaultValue: 'Set date and time to now (UTC)' })}
          style={smallBtnStyle(false)}
        >
          {t('logbook.form.now', { defaultValue: 'now' })}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.9fr 1.1fr 0.7fr 0.7fr', gap: '4px' }}>
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('logbook.form.freq', { defaultValue: 'MHz' })}
          aria-label={t('logbook.form.freqLabel', { defaultValue: 'Frequency in MHz' })}
          value={form.freq}
          onChange={(e) => onFreqChange(e.target.value)}
          style={inputStyle}
        />
        <select
          value={form.band}
          onChange={(e) => setField('band', e.target.value)}
          aria-label={t('logbook.form.band', { defaultValue: 'Band' })}
          style={inputStyle}
        >
          <option value="">{t('logbook.form.band', { defaultValue: 'Band' })}</option>
          {BANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <input
          type="text"
          list="logbook-modes"
          placeholder={t('logbook.form.mode', { defaultValue: 'Mode' })}
          aria-label={t('logbook.form.mode', { defaultValue: 'Mode' })}
          value={form.mode}
          onChange={(e) => onModeChange(e.target.value.toUpperCase())}
          style={{ ...inputStyle, textTransform: 'uppercase' }}
        />
        <datalist id="logbook-modes">
          {MODES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <input
          type="text"
          placeholder={t('logbook.form.rstSent', { defaultValue: 'RST S' })}
          aria-label={t('logbook.form.rstSent', { defaultValue: 'RST sent' })}
          value={form.rst_sent}
          onChange={(e) => setField('rst_sent', e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder={t('logbook.form.rstRcvd', { defaultValue: 'RST R' })}
          aria-label={t('logbook.form.rstRcvd', { defaultValue: 'RST received' })}
          value={form.rst_rcvd}
          onChange={(e) => setField('rst_rcvd', e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1fr 1.4fr 0.6fr', gap: '4px' }}>
        <input
          type="text"
          placeholder={t('logbook.form.grid', { defaultValue: 'Grid' })}
          aria-label={t('logbook.form.grid', { defaultValue: 'Gridsquare' })}
          value={form.gridsquare}
          onChange={(e) => setField('gridsquare', e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder={t('logbook.form.name', { defaultValue: 'Name' })}
          aria-label={t('logbook.form.name', { defaultValue: 'Operator name' })}
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder={t('logbook.form.comment', { defaultValue: 'Comment' })}
          aria-label={t('logbook.form.comment', { defaultValue: 'Comment' })}
          value={form.comment}
          onChange={(e) => setField('comment', e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('logbook.form.power', { defaultValue: 'W' })}
          aria-label={t('logbook.form.powerLabel', { defaultValue: 'TX power in watts' })}
          value={form.tx_pwr}
          onChange={(e) => setField('tx_pwr', e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <button type="submit" style={smallBtnStyle(true)}>
          {editing
            ? t('logbook.form.save', { defaultValue: 'Save' })
            : t('logbook.form.log', { defaultValue: 'Log QSO' })}
        </button>
        <button type="button" onClick={onCancel} style={smallBtnStyle(false)}>
          {t('logbook.form.cancel', { defaultValue: 'Cancel' })}
        </button>
        {rigFreqMHz && (
          <button
            type="button"
            onClick={() =>
              setForm((f) => {
                const next = {
                  ...f,
                  freq: String(rigFreqMHz.toFixed(4)).replace(/0+$/, '').replace(/\.$/, ''),
                  band: bandForFreq(rigFreqMHz) || f.band,
                  mode: rigMode ? rigMode.toUpperCase() : f.mode,
                };
                // New QSOs also take the call of the spot the rig was tuned to:
                // still near it → that call (and its grid); tuned well away →
                // the call no longer belongs to this frequency, so clear it.
                // Without a remembered spot the call is left alone.
                const spot = editing ? null : tunedSpotForRig(rig.freq);
                if (spot?.near) {
                  const sameStation =
                    String(f.call || '')
                      .trim()
                      .toUpperCase() === spot.call;
                  next.call = spot.call;
                  next.gridsquare = spot.gridsquare || (sameStation ? f.gridsquare : '');
                } else if (spot) {
                  next.call = '';
                  next.gridsquare = '';
                }
                return next;
              })
            }
            title={t('logbook.form.fromRigTooltip', {
              defaultValue:
                "Fill frequency and mode from the connected rig, and the call of the spot you tuned to (cleared when you've tuned away from it)",
            })}
            style={smallBtnStyle(false, 'var(--accent-cyan)')}
          >
            {t('logbook.form.fromRig', { defaultValue: 'Rig' })}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {editing && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title={t('logbook.deleteTooltip', { defaultValue: 'Delete this QSO' })}
            style={{
              ...smallBtnStyle(false),
              border: '1px solid var(--accent-red)',
              color: 'var(--accent-red)',
              background: 'rgba(255, 68, 68, 0.12)',
            }}
          >
            {t('logbook.form.delete', { defaultValue: 'Delete' })}
          </button>
        )}
      </div>
    </form>
  );
};

export default QsoForm;
