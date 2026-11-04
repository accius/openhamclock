/**
 * IcsFormsPanel — ICS 309 / 214 / 213 / 205 paperwork built from what the
 * app already records (dockable panel `ics-forms`, and the overlay opened
 * from the EmComm layout's operations rail).
 *
 * All form logic lives in utils/icsForms.js; this component only edits the
 * draft (persisted in localStorage), shows a live preview, and hands the
 * generated HTML to the in-page print helper. The ICS 213 "Send as APRS"
 * action goes through utils/aprsMessageSend.js — the same path as the
 * EmComm MSG composer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/icsForms.css';
import {
  getEvents,
  subscribeEvents,
  recordEvent,
  EVENT_TYPE_META,
  peekNextMsgNo,
  resetMessageNumbers,
} from '../utils/emcommEventLog.js';
import { loadDoc, saveDoc, subscribeDocs } from '../utils/incidentDocs.js';
import IcsDraftConflict from './IcsDraftConflict.jsx';
import { loadNetSchedule } from '../utils/netSchedule.js';
import { getNetControlRoster } from '../utils/netControl.js';
import { apiFetch } from '../utils/apiFetch.js';
import { sendAprsParts, directRigUrl } from '../utils/aprsMessageSend.js';
import { useRigOptional } from '../contexts/RigContext.jsx';
import { printIcsHtml, downloadCsv } from '../utils/icsPrint.js';
import {
  ICS_FORM_IDS,
  ICS_FORM_TITLES,
  ICS309_DEFAULT_TYPES,
  defaultDrafts,
  headerRange,
  ics309Rows,
  newIcs309Row,
  editIcs309Row,
  removeIcs309Row,
  newSendState,
  applySendResult,
  firstUnsentPart,
  sendStateMatches,
  zonesOf,
  groupRowsByZone,
  toInputDateTime,
  ics309Csv,
  ics214RowsFromEvents,
  mergeIcs214Rows,
  newIcs214Row,
  newIcs214Resource,
  sortRowsByDateTime,
  ics213AprsText,
  splitForAprs,
  ics205RowFromRepeater,
  ics205RowFromNet,
  ics205RowFromVoiceNet,
  newSimplexRow,
  buildIcsHtml,
  utcDate,
} from '../utils/icsForms.js';
import { ics205ToChirpCsv, chirpCsvToIcs205Rows } from '../utils/icsChirp.js';

const TAB_KEY = 'ohc_icsForms_tab';
const REPEATER_RADIUS_KEY = 'ohc_repeaters_radius'; // shared with the Repeaters panel

const inputStyle = {
  padding: '3px 6px',
  background: 'var(--bg-secondary, #0a0e14)',
  border: '1px solid var(--border-color, #2a3040)',
  borderRadius: '3px',
  color: 'var(--text-primary, #ddd)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
};

const btnStyle = {
  background: 'var(--bg-tertiary, #1a1f2e)',
  border: '1px solid var(--border-color, #2a3040)',
  borderRadius: '3px',
  color: 'var(--text-secondary, #ccc)',
  fontSize: '10px',
  padding: '3px 8px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
};

const primaryBtn = { ...btnStyle, background: '#22d3ee', color: '#000', border: 'none', fontWeight: 700 };

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  fontSize: '9px',
  color: 'var(--text-muted, #888)',
};

const gridStyle = (min = 150) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
  gap: '6px',
});

function Field({ label, children, wide }) {
  return (
    <label style={{ ...labelStyle, ...(wide ? { gridColumn: '1 / -1' } : null) }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 700,
        color: 'var(--accent-amber, #f59e0b)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        margin: '10px 0 4px',
      }}
    >
      {children}
    </div>
  );
}

/** File → text, with a FileReader fallback for engines without Blob.text(). */
function readFileText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsText(file);
  });
}

function readTab() {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return ICS_FORM_IDS.includes(v) ? v : '309';
  } catch {
    return '309';
  }
}

/** Fill blank call-sign fields from the station callsign on first load. */
function initialDrafts(callsign) {
  // The shared incident's drafts while joined, this browser's own otherwise.
  const d = loadDoc('ics-drafts');
  const call = String(callsign || '').toUpperCase();
  if (call && call !== 'N0CALL') {
    if (!d.header.preparedCall) d.header = { ...d.header, preparedCall: call };
    if (!d.ics309.operatorCall) d.ics309 = { ...d.ics309, operatorCall: call };
  }
  return d;
}

/**
 * @param {Array} [sharedEvents]  the shared incident's event log while joined —
 *   used in place of this browser's own log for the 309 and 214 imports.
 */
export default function IcsFormsPanel({ config, initialForm, onClose, sharedEvents }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(() => (ICS_FORM_IDS.includes(initialForm) ? initialForm : readTab()));
  const [drafts, setDrafts] = useState(() => initialDrafts(config?.callsign));
  const [localEvents, setEvents] = useState(() => getEvents());
  const events = sharedEvents || localEvents;
  const [showPreview, setShowPreview] = useState(true);

  // Follow the rail's form buttons when the overlay is re-opened on another form
  useEffect(() => {
    if (ICS_FORM_IDS.includes(initialForm)) setForm(initialForm);
  }, [initialForm]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, form);
    } catch {}
  }, [form]);

  useEffect(() => subscribeEvents(setEvents), []);

  // Joined / left a shared incident, or another station saved the drafts.
  const callsignForDrafts = config?.callsign;
  useEffect(
    () =>
      subscribeDocs((id) => {
        if (id === 'ics-drafts') setDrafts(initialDrafts(callsignForDrafts));
      }),
    [callsignForDrafts],
  );

  // Persist drafts (debounced — typing in the message box shouldn't hammer storage)
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDoc('ics-drafts', drafts), 300);
    return () => clearTimeout(saveTimer.current);
  }, [drafts]);
  // Flush on unmount so closing the overlay never loses the last keystrokes
  const latestDrafts = useRef(drafts);
  latestDrafts.current = drafts;
  useEffect(() => () => saveDoc('ics-drafts', latestDrafts.current), []);

  const patch = useCallback((section, changes) => {
    setDrafts((d) => ({ ...d, [section]: { ...d[section], ...changes } }));
  }, []);

  // Printed labels: FEMA's English wording by default, or the interface language
  const printLang = drafts.header.printLang === 'ui' ? 'ui' : 'en';
  const tr = useMemo(() => (printLang === 'ui' ? t : i18n.getFixedT('en')), [printLang, t, i18n]);

  const html = useMemo(
    () => (showPreview ? buildIcsHtml(form, drafts, { events, now: Date.now(), tr }) : ''),
    [showPreview, form, drafts, events, tr],
  );

  const rows309 = useMemo(() => ics309Rows(drafts, events), [drafts, events]);

  const fileStem = useMemo(() => {
    const incident = (drafts.header.incidentName || 'incident').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    return `ICS-${form}-${incident || 'incident'}-${utcDate(Date.now())}`;
  }, [form, drafts.header.incidentName]);

  const handlePrint = useCallback(() => {
    printIcsHtml(buildIcsHtml(form, drafts, { events: sharedEvents || getEvents(), now: Date.now(), tr }), {
      title: fileStem,
      landscape: form === '205',
    });
  }, [form, drafts, fileStem, tr, sharedEvents]);

  const handleCsv = useCallback(() => {
    downloadCsv(ics309Csv(drafts, rows309, { tr }), `${fileStem}.csv`);
  }, [drafts, rows309, fileStem, tr]);

  const resetForm = useCallback(() => {
    if (!window.confirm(t('icsForms.resetConfirm', { defaultValue: 'Clear this form back to blank?' }))) return;
    const fresh = defaultDrafts();
    const key = `ics${form}`;
    setDrafts((d) => ({ ...d, [key]: fresh[key] }));
  }, [form, t]);

  const h = drafts.header;

  return (
    <div
      className="panel ics-forms-panel"
      style={{
        padding: '8px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* Shared incident: our draft was refused as older than someone else's */}
      <IcsDraftConflict />

      {/* Title row: form tabs + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-primary, #f59e0b)' }}>
          📋 {t('icsForms.title', { defaultValue: 'ICS FORMS' })}
        </span>
        <div role="tablist" aria-label={t('icsForms.tabs', { defaultValue: 'Form' })} style={{ display: 'flex' }}>
          {ICS_FORM_IDS.map((id, i) => (
            <button
              key={id}
              role="tab"
              aria-selected={form === id}
              title={ICS_FORM_TITLES[id]}
              onClick={() => setForm(id)}
              style={{
                ...btnStyle,
                borderRadius: i === 0 ? '3px 0 0 3px' : i === ICS_FORM_IDS.length - 1 ? '0 3px 3px 0' : 0,
                background: form === id ? 'var(--accent-amber, #f59e0b)' : btnStyle.background,
                color: form === id ? '#000' : btnStyle.color,
                fontWeight: form === id ? 700 : 400,
              }}
            >
              {id}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: '10px', color: 'var(--text-muted, #888)', display: 'flex', gap: '3px' }}>
          <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} />
          {t('icsForms.preview', { defaultValue: 'Preview' })}
        </label>
        {form === '309' && (
          <button
            onClick={handleCsv}
            style={btnStyle}
            title={t('icsForms.csvTitle', { defaultValue: 'Download the Communications Log as CSV' })}
          >
            CSV
          </button>
        )}
        <button
          onClick={handlePrint}
          style={primaryBtn}
          title={t('icsForms.printTitle', {
            defaultValue: "Print this form — choose Save as PDF in your browser's print dialog for a PDF",
          })}
        >
          {t('icsForms.print', { defaultValue: 'Print / PDF' })}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={t('icsForms.close', { defaultValue: 'Close' })}
            style={{ ...btnStyle, border: 'none', background: 'none', fontSize: '14px', padding: '0 4px' }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary, #aaa)' }}>{ICS_FORM_TITLES[form]}</div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: '2px' }}>
        {/* Shared header — typed once, used by every form */}
        <SectionTitle>{t('icsForms.incident', { defaultValue: 'Incident' })}</SectionTitle>
        <div style={gridStyle(160)}>
          <Field label={t('icsForms.incidentName', { defaultValue: 'Incident name / activation #' })} wide>
            <input
              style={inputStyle}
              value={h.incidentName}
              onChange={(e) => patch('header', { incidentName: e.target.value })}
            />
          </Field>
          <Field label={t('icsForms.periodFrom', { defaultValue: 'Operational period from (UTC)' })}>
            <input
              type="datetime-local"
              style={inputStyle}
              value={h.periodFrom}
              onChange={(e) => patch('header', { periodFrom: e.target.value })}
            />
          </Field>
          <Field label={t('icsForms.periodTo', { defaultValue: 'Operational period to (UTC)' })}>
            <div style={{ display: 'flex', gap: '3px' }}>
              <input
                type="datetime-local"
                style={inputStyle}
                value={h.periodTo}
                onChange={(e) => patch('header', { periodTo: e.target.value })}
              />
              <button
                type="button"
                style={btnStyle}
                onClick={() => patch('header', { periodTo: toInputDateTime(Date.now()) })}
              >
                {t('icsForms.now', { defaultValue: 'Now' })}
              </button>
            </div>
          </Field>
          <Field label={t('icsForms.preparedBy', { defaultValue: 'Prepared by (name / position)' })}>
            <input
              style={inputStyle}
              value={h.preparedBy}
              onChange={(e) => patch('header', { preparedBy: e.target.value })}
            />
          </Field>
          <Field label={t('icsForms.preparedCall', { defaultValue: 'Prepared by call sign' })}>
            <input
              style={inputStyle}
              value={h.preparedCall}
              onChange={(e) => patch('header', { preparedCall: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label={t('icsForms.printLang', { defaultValue: 'Print labels in' })}>
            <select
              style={inputStyle}
              value={printLang}
              onChange={(e) => patch('header', { printLang: e.target.value })}
              title={t('icsForms.printLangTitle', {
                defaultValue: 'Agencies expect the FEMA wording, so English is the default',
              })}
            >
              <option value="en">{t('icsForms.printLangEn', { defaultValue: 'English (FEMA wording)' })}</option>
              <option value="ui">{t('icsForms.printLangUi', { defaultValue: 'Interface language' })}</option>
            </select>
          </Field>
        </div>

        {form === '309' && <Ics309Editor t={t} drafts={drafts} patch={patch} setDrafts={setDrafts} rows={rows309} />}
        {form === '214' && <Ics214Editor t={t} drafts={drafts} patch={patch} events={events} />}
        {form === '213' && <Ics213Editor t={t} drafts={drafts} patch={patch} config={config} />}
        {form === '205' && <Ics205Editor t={t} drafts={drafts} patch={patch} config={config} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button onClick={resetForm} style={{ ...btnStyle, color: '#ef4444', borderColor: '#ef444455' }}>
            {t('icsForms.reset', { defaultValue: 'Clear form' })}
          </button>
        </div>

        {showPreview && (
          <>
            <SectionTitle>{t('icsForms.previewTitle', { defaultValue: 'Print preview' })}</SectionTitle>
            {/* html is built by utils/icsForms.js — every user value is escaped there */}
            <div className="ics-paper" dangerouslySetInnerHTML={{ __html: html }} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Large modal host for the panel — the EmComm operations rail is too narrow
 * to edit a form in, so its ICS Forms buttons open this over the map.
 * Escape or a click on the backdrop closes it; drafts are saved on close.
 */
export function IcsFormsOverlay({ config, initialForm, onClose, sharedEvents }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('icsForms.title', { defaultValue: 'ICS FORMS' })}
        style={{
          width: 'min(1100px, 100%)',
          height: 'min(92vh, 100%)',
          background: 'var(--bg-primary, #111)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: '8px',
          overflow: 'hidden',
          color: 'var(--text-primary, #ddd)',
        }}
      >
        <IcsFormsPanel config={config} initialForm={initialForm} onClose={onClose} sharedEvents={sharedEvents} />
      </div>
    </div>
  );
}

// ── ICS 309 ─────────────────────────────────────────────────────────────────
const COLS_309 = {
  dateTime: 'Date/time (UTC)',
  from: 'From',
  fromMsg: 'Msg #',
  to: 'To',
  toMsg: 'Msg #',
  message: 'Message',
};

function Ics309Editor({ t, drafts, patch, setDrafts, rows }) {
  const f = drafts.ics309;
  const types = Array.isArray(f.types) ? f.types : ICS309_DEFAULT_TYPES;
  const removedCount = Array.isArray(f.removed) ? f.removed.length : 0;
  const toggleType = (type) =>
    patch('ics309', { types: types.includes(type) ? types.filter((x) => x !== type) : [...types, type] });
  // Row edits go through the pure helpers so event rows keep updating live underneath
  const updateRow = (row, changes) => setDrafts((d) => ({ ...d, ics309: editIcs309Row(d.ics309, row, changes) }));
  const removeRow = (row) => setDrafts((d) => ({ ...d, ics309: removeIcs309Row(d.ics309, row) }));
  const addRow = () =>
    setDrafts((d) => ({
      ...d,
      ics309: {
        ...d.ics309,
        manual: [...(d.ics309.manual || []), newIcs309Row(Date.now(), { to: d.ics309.operatorCall || '' })],
      },
    }));
  const colLabel = (key) => t(`icsForms.309.col.${key}`, { defaultValue: COLS_309[key] });
  // Re-read on every render: the panel re-renders on each event-log change,
  // and resetMessageNumbers() notifies the same subscribers.
  const nextNo = peekNextMsgNo();
  const resetNumbers = () => {
    const ok = window.confirm(
      t('icsForms.309.resetNumbersConfirm', {
        defaultValue:
          'Restart station message numbers at 1? Messages already logged keep their numbers; the next message will be number 1.',
      }),
    );
    if (ok) resetMessageNumbers();
  };
  const cellInput = (row, key, width, upper = false) => (
    <input
      style={{ ...inputStyle, width }}
      value={row[key] ?? ''}
      aria-label={colLabel(key)}
      onChange={(e) => updateRow(row, { [key]: upper ? e.target.value.toUpperCase() : e.target.value })}
    />
  );
  return (
    <>
      <SectionTitle>{t('icsForms.309.section', { defaultValue: 'Communications log' })}</SectionTitle>
      <div style={gridStyle(160)}>
        <Field label={t('icsForms.309.netName', { defaultValue: 'Radio net name or position / tactical call' })} wide>
          <input style={inputStyle} value={f.netName} onChange={(e) => patch('ics309', { netName: e.target.value })} />
        </Field>
        <Field label={t('icsForms.309.operatorName', { defaultValue: 'Radio operator name' })}>
          <input
            style={inputStyle}
            value={f.operatorName}
            onChange={(e) => patch('ics309', { operatorName: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.309.operatorCall', { defaultValue: 'Radio operator call sign' })}>
          <input
            style={inputStyle}
            value={f.operatorCall}
            onChange={(e) => patch('ics309', { operatorCall: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t('icsForms.309.startNumber', { defaultValue: 'First message # this period' })}>
          <input
            inputMode="numeric"
            style={inputStyle}
            value={f.startNumber ?? ''}
            placeholder={t('icsForms.309.startNumberAuto', { defaultValue: 'running numbers' })}
            title={t('icsForms.309.startNumberTitle', {
              defaultValue:
                'Leave blank to use the station message numbers from the event log, or enter the number this period starts from',
            })}
            onChange={(e) => patch('ics309', { startNumber: e.target.value.replace(/[^0-9]/g, '') })}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary, #aaa)' }}>
          {t('icsForms.309.nextNumber', {
            defaultValue: 'Next station message #: {{n}} — numbers keep running when the Event Log is cleared',
            n: nextNo,
          })}
        </span>
        <button
          style={{ ...btnStyle, color: '#ef4444', borderColor: '#ef444455' }}
          onClick={resetNumbers}
          disabled={nextNo === 1}
        >
          {t('icsForms.309.resetNumbers', { defaultValue: 'Reset message numbers' })}
        </button>
      </div>
      <div style={{ fontSize: '9px', color: 'var(--text-muted, #888)', margin: '8px 0 3px' }}>
        {t('icsForms.309.include', { defaultValue: 'Include from the event log:' })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
        {Object.entries(EVENT_TYPE_META)
          .filter(([, meta]) => !meta.internal)
          .map(([type, meta]) => (
            <label key={type} style={{ fontSize: '10px', display: 'flex', gap: '3px', color: meta.color }}>
              <input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} />
              {meta.label}
            </label>
          ))}
      </div>

      <SectionTitle>{t('icsForms.309.entries', { defaultValue: 'Log entries' })}</SectionTitle>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary, #aaa)' }}>
          {t('icsForms.309.rowCount', {
            defaultValue: 'Log entries in the operational period: {{count}}',
            count: rows.length,
          })}
        </span>
        <button style={btnStyle} onClick={addRow}>
          + {t('icsForms.309.addRow', { defaultValue: 'Add entry' })}
        </button>
        {removedCount > 0 && (
          <button style={btnStyle} onClick={() => patch('ics309', { removed: [] })}>
            {t('icsForms.309.restore', { defaultValue: 'Restore removed ({{count}})', count: removedCount })}
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '10px', width: '100%' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted, #888)', textAlign: 'left' }}>
                {Object.keys(COLS_309).map((key) => (
                  <th key={key} style={{ padding: '2px 3px', fontWeight: 400 }}>
                    {colLabel(key)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: '1px 2px' }}>
                    <input
                      type="datetime-local"
                      style={{ ...inputStyle, width: '150px' }}
                      value={r.dateTime || ''}
                      aria-label={colLabel('dateTime')}
                      onChange={(e) => updateRow(r, { dateTime: e.target.value })}
                    />
                  </td>
                  <td style={{ padding: '1px 2px' }}>{cellInput(r, 'from', '80px', true)}</td>
                  <td style={{ padding: '1px 2px' }}>{cellInput(r, 'fromMsg', '44px')}</td>
                  <td style={{ padding: '1px 2px' }}>{cellInput(r, 'to', '80px', true)}</td>
                  <td style={{ padding: '1px 2px' }}>{cellInput(r, 'toMsg', '44px')}</td>
                  <td style={{ padding: '1px 2px', width: '100%' }}>
                    <textarea
                      rows={1}
                      style={{ ...inputStyle, resize: 'vertical', minHeight: '22px', minWidth: '160px' }}
                      value={r.message || ''}
                      aria-label={colLabel('message')}
                      onChange={(e) => updateRow(r, { message: e.target.value })}
                    />
                  </td>
                  <td style={{ padding: '1px 2px', whiteSpace: 'nowrap' }}>
                    {r.edited && (
                      <span
                        style={{ color: 'var(--accent-amber, #f59e0b)', marginRight: '3px' }}
                        title={t('icsForms.309.edited', { defaultValue: 'Edited' })}
                      >
                        ✎
                      </span>
                    )}
                    <button
                      style={btnStyle}
                      aria-label={t('icsForms.remove', { defaultValue: 'Remove' })}
                      onClick={() => removeRow(r)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: '9px', color: 'var(--text-muted, #888)', marginTop: '4px' }}>
        {t('icsForms.309.hint', {
          defaultValue:
            'Edits stay in your draft while new events keep arriving. Msg #: our number for traffic we sent goes under FROM, for traffic we received under TO.',
        })}
      </div>
    </>
  );
}

// ── ICS 214 ─────────────────────────────────────────────────────────────────
function Ics214Editor({ t, drafts, patch, events }) {
  const f = drafts.ics214;
  const rows = f.rows || [];
  const resources = f.resources || [];

  const importEvents = () => {
    const imported = ics214RowsFromEvents(events, headerRange(drafts.header));
    patch('ics214', { rows: mergeIcs214Rows(rows, imported) });
  };
  const updateRow = (id, changes) =>
    patch('ics214', { rows: rows.map((r) => (r.id === id ? { ...r, ...changes } : r)) });
  const removeRow = (id) => patch('ics214', { rows: rows.filter((r) => r.id !== id) });
  const updateRes = (id, changes) =>
    patch('ics214', { resources: resources.map((r) => (r.id === id ? { ...r, ...changes } : r)) });

  return (
    <>
      <SectionTitle>{t('icsForms.214.section', { defaultValue: 'Unit / operator' })}</SectionTitle>
      <div style={gridStyle(150)}>
        <Field label={t('icsForms.214.name', { defaultValue: 'Name' })}>
          <input style={inputStyle} value={f.name} onChange={(e) => patch('ics214', { name: e.target.value })} />
        </Field>
        <Field label={t('icsForms.214.position', { defaultValue: 'ICS position' })}>
          <input
            style={inputStyle}
            value={f.icsPosition}
            onChange={(e) => patch('ics214', { icsPosition: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.214.agency', { defaultValue: 'Home agency (and unit)' })}>
          <input
            style={inputStyle}
            value={f.homeAgency}
            onChange={(e) => patch('ics214', { homeAgency: e.target.value })}
          />
        </Field>
      </div>

      <SectionTitle>{t('icsForms.214.resources', { defaultValue: 'Resources assigned' })}</SectionTitle>
      {resources.map((r) => (
        <div
          key={r.id}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '4px', marginBottom: '3px' }}
        >
          <input
            style={inputStyle}
            placeholder={t('icsForms.214.name', { defaultValue: 'Name' })}
            value={r.name}
            onChange={(e) => updateRes(r.id, { name: e.target.value })}
          />
          <input
            style={inputStyle}
            placeholder={t('icsForms.214.position', { defaultValue: 'ICS position' })}
            value={r.position}
            onChange={(e) => updateRes(r.id, { position: e.target.value })}
          />
          <input
            style={inputStyle}
            placeholder={t('icsForms.214.agency', { defaultValue: 'Home agency (and unit)' })}
            value={r.agency}
            onChange={(e) => updateRes(r.id, { agency: e.target.value })}
          />
          <button
            style={btnStyle}
            aria-label={t('icsForms.remove', { defaultValue: 'Remove' })}
            onClick={() => patch('ics214', { resources: resources.filter((x) => x.id !== r.id) })}
          >
            ✕
          </button>
        </div>
      ))}
      <button style={btnStyle} onClick={() => patch('ics214', { resources: [...resources, newIcs214Resource()] })}>
        + {t('icsForms.214.addResource', { defaultValue: 'Add person' })}
      </button>

      <SectionTitle>{t('icsForms.214.activity', { defaultValue: 'Activity log' })}</SectionTitle>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <button
          style={btnStyle}
          onClick={importEvents}
          title={t('icsForms.214.importTitle', {
            defaultValue: 'Add event-log entries from the operational period. Rows you already edited are kept.',
          })}
        >
          ⤓ {t('icsForms.214.import', { defaultValue: 'Import from event log' })}
        </button>
        <button
          style={btnStyle}
          onClick={() => patch('ics214', { rows: sortRowsByDateTime([...rows, newIcs214Row()]) })}
        >
          + {t('icsForms.214.addRow', { defaultValue: 'Add entry' })}
        </button>
        {rows.length > 0 && (
          <button
            style={{ ...btnStyle, marginLeft: 'auto' }}
            onClick={() => patch('ics214', { rows: sortRowsByDateTime(rows) })}
          >
            {t('icsForms.214.sort', { defaultValue: 'Sort by time' })}
          </button>
        )}
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted, #888)', fontStyle: 'italic' }}>
          {t('icsForms.214.empty', {
            defaultValue: 'No entries yet — import from the event log or add your own.',
          })}
        </div>
      )}
      {rows.map((r) => (
        <div
          key={r.id}
          style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: '4px', marginBottom: '3px' }}
        >
          <input
            type="datetime-local"
            style={inputStyle}
            value={r.dateTime}
            aria-label={t('icsForms.214.dateTime', { defaultValue: 'Date/time (UTC)' })}
            onChange={(e) => updateRow(r.id, { dateTime: e.target.value })}
          />
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '24px' }}
            rows={1}
            value={r.text}
            aria-label={t('icsForms.214.notable', { defaultValue: 'Notable activity' })}
            onChange={(e) => updateRow(r.id, { text: e.target.value })}
          />
          <button
            style={btnStyle}
            aria-label={t('icsForms.remove', { defaultValue: 'Remove' })}
            onClick={() => removeRow(r.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}

// ── ICS 213 ─────────────────────────────────────────────────────────────────
function Ics213Editor({ t, drafts, patch, config }) {
  const f = drafts.ics213;
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error'|'busy', text }
  // Local TNC state: null = unknown (let the server decide), true/false from rig-bridge
  const [tncConnected, setTncConnected] = useState(null);
  // Transmit through the Rig Bridge this browser uses, and ask it (not the
  // server, which only sees localhost:5555) whether its TNC is up (#1243).
  const rigUrl = directRigUrl(useRigOptional());
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = rigUrl
          ? await fetch(`${rigUrl}/api/aprs-tnc/status`, { cache: 'no-store' })
          : await apiFetch('/api/aprs/tnc-status', { cache: 'no-store' });
        if (!alive || !res?.ok) return;
        const data = await res.json();
        if (alive) setTncConnected(!!data?.connected);
      } catch {
        /* status unknown — sending still reports the server's answer */
      }
    };
    check();
    const id = setInterval(check, 30 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [rigUrl]);
  const aprsText = ics213AprsText(f);
  const parts = useMemo(() => splitForAprs(aprsText), [aprsText]);
  const addressee = String(f.toCall || '')
    .trim()
    .toUpperCase();
  const tncDown = tncConnected === false;
  // Per-part progress of the last send — only meaningful while the text and addressee are unchanged
  const tracked = sendStateMatches(f.sendState, addressee, parts) ? f.sendState : null;
  const resumeFrom = tracked ? firstUnsentPart(tracked) : 0; // -1 = every part went out
  const busy = status?.kind === 'busy';
  const canSend = !!addressee && parts.length > 0 && !tncDown && !busy;
  const canResume = canSend && !!tracked && resumeFrom > 0;

  /** Send parts[start..] and record the outcome per part and in the event log. */
  const runSend = async (start) => {
    const base = start > 0 && tracked ? tracked : newSendState(addressee, parts);
    setStatus({ kind: 'busy', text: t('icsForms.213.sending', { defaultValue: 'Sending…' }) });
    const r = await sendAprsParts(addressee, parts.slice(start), undefined, rigUrl);
    const next = applySendResult(base, start, r);
    patch('ics213', { sendState: next });
    if (r.sent > 0) {
      const first = start + 1;
      const last = start + r.sent;
      const all = start === 0 && r.sent === parts.length;
      recordEvent('ics213_sent', {
        callsign: config?.callsign || 'N0CALL',
        summary: `ICS 213 to ${addressee}: ${f.subject || '(no subject)'}${start > 0 ? ' (resumed)' : ''}`,
        details: all
          ? aprsText
          : `${aprsText} [parts ${first}${last > first ? `–${last}` : ''} of ${parts.length} sent${r.error ? `; stopped: ${r.error}` : ''}]`,
      });
    }
    const unsent = firstUnsentPart(next);
    setStatus(
      r.error
        ? {
            kind: 'error',
            text: t('icsForms.213.sendFailedAt', {
              defaultValue: 'Part {{part}} of {{total}} failed — {{error}}. {{sent}} of {{total}} sent so far.',
              part: start + r.sent + 1,
              total: parts.length,
              sent: next.parts.filter((p) => p.state === 'sent').length,
              error: r.error,
            }),
          }
        : unsent === -1
          ? {
              kind: 'ok',
              text: t('icsForms.213.sent', {
                defaultValue: 'Sent to {{call}} in {{count}} message(s) and recorded in the event log.',
                call: addressee,
                count: parts.length,
              }),
            }
          : null,
    );
  };

  const send = async () => {
    if (!canSend) return;
    const ok = window.confirm(
      t('icsForms.213.sendConfirm', {
        defaultValue: 'Send this ICS 213 to {{call}} as {{count}} APRS message(s) through the local TNC?',
        call: addressee,
        count: parts.length,
      }),
    );
    if (ok) await runSend(0);
  };

  const resume = async () => {
    if (!canResume) return;
    await runSend(resumeFrom);
  };

  return (
    <>
      <SectionTitle>{t('icsForms.213.section', { defaultValue: 'General message' })}</SectionTitle>
      <div style={gridStyle(160)}>
        <Field label={t('icsForms.213.to', { defaultValue: 'To (name and position)' })}>
          <input style={inputStyle} value={f.to} onChange={(e) => patch('ics213', { to: e.target.value })} />
        </Field>
        <Field label={t('icsForms.213.toCall', { defaultValue: 'To call sign (APRS addressee)' })}>
          <input
            style={inputStyle}
            value={f.toCall}
            maxLength={9}
            onChange={(e) => patch('ics213', { toCall: e.target.value.toUpperCase().replace(/\s/g, '') })}
          />
        </Field>
        <Field label={t('icsForms.213.from', { defaultValue: 'From (name and position)' })}>
          <input style={inputStyle} value={f.from} onChange={(e) => patch('ics213', { from: e.target.value })} />
        </Field>
        <Field label={t('icsForms.213.dateTime', { defaultValue: 'Date / time (UTC)' })}>
          <div style={{ display: 'flex', gap: '3px' }}>
            <input
              type="datetime-local"
              style={inputStyle}
              value={f.dateTime}
              onChange={(e) => patch('ics213', { dateTime: e.target.value })}
            />
            <button
              type="button"
              style={btnStyle}
              onClick={() => patch('ics213', { dateTime: toInputDateTime(Date.now()) })}
            >
              {t('icsForms.now', { defaultValue: 'Now' })}
            </button>
          </div>
        </Field>
        <Field label={t('icsForms.213.subject', { defaultValue: 'Subject' })} wide>
          <input style={inputStyle} value={f.subject} onChange={(e) => patch('ics213', { subject: e.target.value })} />
        </Field>
        <Field label={t('icsForms.213.message', { defaultValue: 'Message' })} wide>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
            value={f.message}
            onChange={(e) => patch('ics213', { message: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.213.approvedBy', { defaultValue: 'Approved by (name)' })}>
          <input
            style={inputStyle}
            value={f.approvedBy}
            onChange={(e) => patch('ics213', { approvedBy: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.213.approvedPosition', { defaultValue: 'Approver position / title' })}>
          <input
            style={inputStyle}
            value={f.approvedPosition}
            onChange={(e) => patch('ics213', { approvedPosition: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.213.reply', { defaultValue: 'Reply' })} wide>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '40px' }}
            value={f.reply}
            onChange={(e) => patch('ics213', { reply: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.213.repliedBy', { defaultValue: 'Replied by (name / position)' })}>
          <input
            style={inputStyle}
            value={f.repliedBy}
            onChange={(e) => patch('ics213', { repliedBy: e.target.value })}
          />
        </Field>
        <Field label={t('icsForms.213.repliedDateTime', { defaultValue: 'Reply date / time (UTC)' })}>
          <input
            type="datetime-local"
            style={inputStyle}
            value={f.repliedDateTime}
            onChange={(e) => patch('ics213', { repliedDateTime: e.target.value })}
          />
        </Field>
      </div>

      <SectionTitle>{t('icsForms.213.aprs', { defaultValue: 'Send over APRS' })}</SectionTitle>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary, #aaa)', marginBottom: '4px' }}>
        {parts.length === 0
          ? t('icsForms.213.aprsEmpty', { defaultValue: 'Write a subject or message to send it over APRS.' })
          : t('icsForms.213.aprsParts', {
              defaultValue: 'Subject and message go out as {{count}} APRS message(s) of up to 67 characters:',
              count: parts.length,
            })}
      </div>
      {parts.length > 0 && (
        <ol
          style={{
            margin: '0 0 6px',
            paddingLeft: '22px',
            fontSize: '10px',
            color: 'var(--text-primary, #ddd)',
            maxHeight: '120px',
            overflowY: 'auto',
          }}
        >
          {parts.map((p, i) => {
            const st = tracked?.parts[i]?.state;
            return (
              <li key={i} style={{ wordBreak: 'break-word' }} data-part-state={st || 'new'}>
                {p} <span style={{ color: 'var(--text-muted, #888)' }}>({p.length})</span>
                {st && (
                  <span
                    style={{
                      marginLeft: '6px',
                      color: st === 'sent' ? '#22c55e' : st === 'failed' ? '#ef4444' : 'var(--text-muted, #888)',
                    }}
                    title={tracked.parts[i].error || undefined}
                  >
                    {st === 'sent'
                      ? `✓ ${t('icsForms.213.partSent', { defaultValue: 'sent' })}`
                      : st === 'failed'
                        ? `✗ ${t('icsForms.213.partFailed', { defaultValue: 'failed' })}`
                        : `… ${t('icsForms.213.partPending', { defaultValue: 'not sent' })}`}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={send}
          disabled={!canSend}
          style={{ ...primaryBtn, opacity: canSend ? 1 : 0.4, cursor: canSend ? 'pointer' : 'not-allowed' }}
        >
          📡 {t('icsForms.213.send', { defaultValue: 'Send as APRS message' })}
        </button>
        {canResume && (
          <button onClick={resume} style={{ ...primaryBtn, background: '#f59e0b' }}>
            ↻{' '}
            {t('icsForms.213.resend', {
              defaultValue: 'Resend remaining parts ({{from}}–{{total}})',
              from: resumeFrom + 1,
              total: parts.length,
            })}
          </button>
        )}
        {!addressee && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted, #888)' }}>
            {t('icsForms.213.needCall', { defaultValue: 'Enter the To call sign first.' })}
          </span>
        )}
        {tncDown && (
          <span style={{ fontSize: '10px', color: '#f59e0b' }}>
            {t('icsForms.213.noTnc', {
              defaultValue: 'No local TNC connected — enable the APRS TNC plugin in Rig Bridge.',
            })}
          </span>
        )}
        {status && (
          <span
            role="status"
            style={{
              fontSize: '10px',
              color: status.kind === 'error' ? '#ef4444' : status.kind === 'ok' ? '#22c55e' : '#aaa',
            }}
          >
            {status.text}
          </span>
        )}
      </div>
    </>
  );
}

// ── ICS 205 ─────────────────────────────────────────────────────────────────
// [key, label, width, kind] — kind: text input, 'zone' (input + zone picker), 'nw' (N/W select)
const COLS_205 = [
  ['zone', 'Zone', 70, 'zone'],
  ['ch', 'Ch #', 36],
  ['function', 'Function', 80],
  ['name', 'Channel name', 110],
  ['assignment', 'Assignment', 90],
  ['rxFreq', 'RX MHz', 76],
  ['rxNW', 'RX N/W', 44, 'nw'],
  ['rxTone', 'RX tone', 56],
  ['txFreq', 'TX MHz', 76],
  ['txNW', 'TX N/W', 44, 'nw'],
  ['txTone', 'TX tone', 56],
];

function Ics205Editor({ t, drafts, patch, config }) {
  const f = drafts.ics205;
  const rows = useMemo(() => f.rows || [], [f.rows]);
  const [picker, setPicker] = useState(null); // 'repeaters' | 'nets' | null
  const [repeaters, setRepeaters] = useState(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repError, setRepError] = useState('');
  const nets = useMemo(() => (picker === 'nets' ? loadNetSchedule() : []), [picker]);
  // The voice net running in Net Control right now, if any
  const voiceNet = useMemo(() => {
    if (picker !== 'nets') return null;
    const snap = getNetControlRoster();
    return snap?.active ? snap : null;
  }, [picker]);
  const lat = config?.location?.lat;
  const lon = config?.location?.lon;

  const loadRepeaters = useCallback(async () => {
    if (lat == null || lon == null) {
      setRepError(t('icsForms.205.noLocation', { defaultValue: 'Set your location in Settings → Station first.' }));
      return;
    }
    setRepLoading(true);
    setRepError('');
    try {
      let radius = 100;
      try {
        const stored = Number(localStorage.getItem(REPEATER_RADIUS_KEY));
        if (stored > 0) radius = stored;
      } catch {}
      const res = await apiFetch(`/api/repeaters?lat=${lat}&lon=${lon}&radius=${radius}`);
      if (!res?.ok) throw new Error(res ? `HTTP ${res.status}` : 'busy');
      const data = await res.json();
      setRepeaters(Array.isArray(data?.repeaters) ? data.repeaters : []);
    } catch (e) {
      setRepError(
        t('icsForms.205.repError', { defaultValue: 'Could not load repeaters ({{error}})', error: e?.message || '' }),
      );
    } finally {
      setRepLoading(false);
    }
  }, [lat, lon, t]);

  const openPicker = (which) => {
    setPicker((p) => (p === which ? null : which));
    if (which === 'repeaters' && repeaters == null && !repLoading) loadRepeaters();
  };

  const [newZone, setNewZone] = useState('');
  const [chirpMsg, setChirpMsg] = useState(null); // { text, error }
  const chirpInputRef = useRef(null);
  const zones = useMemo(() => zonesOf(rows), [rows]);
  const zoneListId = 'ics205-zones';

  // New channels land in the zone the operator picked (if any)
  const addRow = (row) => patch('ics205', { rows: [...rows, newZone.trim() ? { ...row, zone: newZone.trim() } : row] });

  const exportChirp = () => {
    downloadCsv(ics205ToChirpCsv(rows), `ICS-205-CHIRP-${utcDate(Date.now())}.csv`);
  };
  const importChirp = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imported = chirpCsvToIcs205Rows(await readFileText(file)).map((r) =>
        newZone.trim() ? { ...r, zone: newZone.trim() } : r,
      );
      patch('ics205', { rows: [...rows, ...imported] });
      setChirpMsg({
        text: t('icsForms.205.chirpImported', {
          defaultValue: 'Imported {{count}} channel(s) from {{file}}.',
          count: imported.length,
          file: file.name,
        }),
      });
    } catch (err) {
      setChirpMsg({
        error: true,
        text: t('icsForms.205.chirpImportError', {
          defaultValue: 'Could not import {{file}}: {{error}}',
          file: file.name,
          error: err?.message || '',
        }),
      });
    }
  };
  const updateRow = (id, changes) =>
    patch('ics205', { rows: rows.map((r) => (r.id === id ? { ...r, ...changes } : r)) });
  const moveRow = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    patch('ics205', { rows: next });
  };

  const pickerList = {
    maxHeight: '180px',
    overflowY: 'auto',
    border: '1px solid var(--border-color, #2a3040)',
    borderRadius: '3px',
    margin: '4px 0 8px',
    fontSize: '10px',
  };
  const pickerRow = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '6px',
    padding: '3px 6px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  };

  return (
    <>
      <SectionTitle>{t('icsForms.205.section', { defaultValue: 'Basic radio channel use' })}</SectionTitle>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button style={btnStyle} onClick={() => openPicker('repeaters')} aria-expanded={picker === 'repeaters'}>
          🗼 {t('icsForms.205.fromRepeaters', { defaultValue: 'Add from Repeaters' })}
        </button>
        <button style={btnStyle} onClick={() => openPicker('nets')} aria-expanded={picker === 'nets'}>
          🕐 {t('icsForms.205.fromNets', { defaultValue: 'Add from Nets' })}
        </button>
        <button style={btnStyle} onClick={() => addRow(newSimplexRow())}>
          + {t('icsForms.205.addSimplex', { defaultValue: 'Simplex channel' })}
        </button>
        <span style={{ flex: 1 }} />
        <button
          style={btnStyle}
          onClick={() => chirpInputRef.current?.click()}
          title={t('icsForms.205.chirpImportTitle', {
            defaultValue: 'Add the channels from a CHIRP CSV export to this plan',
          })}
        >
          ⤓ {t('icsForms.205.chirpImport', { defaultValue: 'Import CHIRP CSV' })}
        </button>
        <input
          ref={chirpInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          data-testid="chirp-import"
          onChange={importChirp}
        />
        <button
          style={btnStyle}
          disabled={rows.length === 0}
          onClick={exportChirp}
          title={t('icsForms.205.chirpExportTitle', {
            defaultValue: 'Download the plan as a CHIRP CSV to program radios',
          })}
        >
          ⤒ {t('icsForms.205.chirpExport', { defaultValue: 'CHIRP CSV' })}
        </button>
      </div>
      {chirpMsg && (
        <div
          role="status"
          style={{ fontSize: '10px', marginTop: '4px', color: chirpMsg.error ? '#ef4444' : '#22c55e' }}
        >
          {chirpMsg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: '4px' }}>
          <span>{t('icsForms.205.zoneFor', { defaultValue: 'Zone/group for new channels' })}</span>
          <input
            style={{ ...inputStyle, width: '110px' }}
            list={zoneListId}
            value={newZone}
            onChange={(e) => setNewZone(e.target.value)}
          />
        </label>
        <button
          style={btnStyle}
          disabled={zones.length === 0}
          onClick={() => patch('ics205', { rows: groupRowsByZone(rows) })}
          title={t('icsForms.205.groupTitle', {
            defaultValue: 'Order the plan by zone/group (zones in first-used order, rows without one last)',
          })}
        >
          ▤ {t('icsForms.205.group', { defaultValue: 'Group by zone' })}
        </button>
        <datalist id={zoneListId}>
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </div>

      {picker === 'repeaters' && (
        <div style={pickerList}>
          {repLoading && <div style={{ padding: '6px' }}>{t('icsForms.loading', { defaultValue: 'Loading…' })}</div>}
          {repError && <div style={{ padding: '6px', color: '#ef4444' }}>{repError}</div>}
          {!repLoading && !repError && repeaters?.length === 0 && (
            <div style={{ padding: '6px' }}>
              {t('icsForms.205.noRepeaters', { defaultValue: 'No repeaters found near your location.' })}
            </div>
          )}
          {(repeaters || []).map((r, i) => (
            <div key={`${r.callsign}-${r.mhz}-${i}`} style={pickerRow}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b>{r.callsign || '—'}</b> {Number(r.mhz).toFixed(4)}{' '}
                {r.offsetMhz ? `${r.offsetMhz > 0 ? '+' : ''}${Number(r.offsetMhz).toFixed(1)}` : 'simplex'}
                {r.tone ? ` · ${r.tone}` : ''}
                {r.mode ? ` · ${r.mode}` : ''}
                {r.city ? ` · ${r.city}` : ''}
              </span>
              <button style={btnStyle} onClick={() => addRow(ics205RowFromRepeater(r))}>
                + {t('icsForms.add', { defaultValue: 'Add' })}
              </button>
            </div>
          ))}
        </div>
      )}

      {picker === 'nets' && (
        <div style={pickerList}>
          {voiceNet && (
            <div style={pickerRow}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                🎙️ <b>{voiceNet.net}</b> {voiceNet.frequency}{' '}
                <span style={{ color: '#14b8a6' }}>
                  {t('icsForms.205.runningNet', { defaultValue: 'running now' })}
                </span>
              </span>
              <button style={btnStyle} onClick={() => addRow(ics205RowFromVoiceNet(voiceNet))}>
                + {t('icsForms.add', { defaultValue: 'Add' })}
              </button>
            </div>
          )}
          {nets.length === 0 && !voiceNet && (
            <div style={{ padding: '6px' }}>
              {t('icsForms.205.noNets', { defaultValue: 'No nets saved — add them in the Nets panel.' })}
            </div>
          )}
          {nets.map((n) => (
            <div key={n.id || n.name} style={pickerRow}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b>{n.name}</b> {n.freq_mhz ? Number(n.freq_mhz).toFixed(3) : ''} {n.mode || ''} {n.time_utc}Z
              </span>
              <button style={btnStyle} onClick={() => addRow(ics205RowFromNet(n))}>
                + {t('icsForms.add', { defaultValue: 'Add' })}
              </button>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: '10px', color: 'var(--text-muted, #888)', fontStyle: 'italic', marginTop: '6px' }}>
          {t('icsForms.205.empty', {
            defaultValue: 'No channels yet — add repeaters, nets, or simplex channels above.',
          })}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: '6px' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted, #888)', textAlign: 'left' }}>
                {COLS_205.map(([key, label]) => (
                  <th key={key} style={{ padding: '2px 3px', fontWeight: 400 }}>
                    {t(`icsForms.205.col.${key}`, { defaultValue: label })}
                  </th>
                ))}
                <th style={{ padding: '2px 3px', fontWeight: 400 }}>
                  {t('icsForms.205.col.mode', { defaultValue: 'Mode' })}
                </th>
                <th style={{ padding: '2px 3px', fontWeight: 400 }}>
                  {t('icsForms.205.col.remarks', { defaultValue: 'Remarks' })}
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id}>
                  {COLS_205.map(([key, label, width, kind]) => (
                    <td key={key} style={{ padding: '1px 2px' }}>
                      {kind === 'nw' ? (
                        <select
                          style={{ ...inputStyle, width: `${width}px` }}
                          value={r[key] === 'N' ? 'N' : 'W'}
                          aria-label={t(`icsForms.205.col.${key}`, { defaultValue: label })}
                          title={t('icsForms.205.bandwidthTitle', { defaultValue: 'N = narrowband, W = wideband' })}
                          onChange={(e) => updateRow(r.id, { [key]: e.target.value })}
                        >
                          <option value="N">N</option>
                          <option value="W">W</option>
                        </select>
                      ) : (
                        <input
                          style={{
                            ...inputStyle,
                            width: `${width}px`,
                            ...(key === 'txFreq' && r.txUnknown && !r.txFreq ? { borderColor: '#f59e0b' } : {}),
                          }}
                          value={r[key] || ''}
                          list={kind === 'zone' ? zoneListId : undefined}
                          aria-label={t(`icsForms.205.col.${key}`, { defaultValue: label })}
                          // A voice-net row whose repeater offset is unknown asks for the TX frequency
                          placeholder={
                            key === 'txFreq' && r.txUnknown
                              ? t('icsForms.205.offsetUnknown', { defaultValue: 'offset?' })
                              : undefined
                          }
                          title={
                            key === 'txFreq' && r.txUnknown && !r.txFreq
                              ? t('icsForms.205.offsetUnknownTitle', {
                                  defaultValue: 'The repeater offset is not known — type the TX (input) frequency',
                                })
                              : undefined
                          }
                          onChange={(e) =>
                            updateRow(r.id, {
                              [key]: e.target.value,
                              ...(key === 'txFreq' && e.target.value.trim() ? { txUnknown: false } : {}),
                            })
                          }
                        />
                      )}
                    </td>
                  ))}
                  <td style={{ padding: '1px 2px' }}>
                    <select
                      style={{ ...inputStyle, width: '48px' }}
                      value={r.mode || 'A'}
                      aria-label={t('icsForms.205.col.mode', { defaultValue: 'Mode' })}
                      onChange={(e) => updateRow(r.id, { mode: e.target.value })}
                    >
                      <option value="A">A</option>
                      <option value="D">D</option>
                      <option value="M">M</option>
                    </select>
                  </td>
                  <td style={{ padding: '1px 2px' }}>
                    <input
                      style={{ ...inputStyle, width: '160px' }}
                      value={r.remarks || ''}
                      aria-label={t('icsForms.205.col.remarks', { defaultValue: 'Remarks' })}
                      onChange={(e) => updateRow(r.id, { remarks: e.target.value })}
                    />
                  </td>
                  <td style={{ padding: '1px 2px', whiteSpace: 'nowrap' }}>
                    <button
                      style={btnStyle}
                      onClick={() => moveRow(idx, -1)}
                      aria-label={t('icsForms.moveUp', { defaultValue: 'Move up' })}
                    >
                      ↑
                    </button>
                    <button
                      style={btnStyle}
                      onClick={() => moveRow(idx, 1)}
                      aria-label={t('icsForms.moveDown', { defaultValue: 'Move down' })}
                    >
                      ↓
                    </button>
                    <button
                      style={btnStyle}
                      aria-label={t('icsForms.remove', { defaultValue: 'Remove' })}
                      onClick={() => patch('ics205', { rows: rows.filter((x) => x.id !== r.id) })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: '9px', color: 'var(--text-muted, #888)', marginTop: '4px' }}>
        {t('icsForms.205.hint', {
          defaultValue:
            'Blank Ch # cells are numbered in order when printed. N/W: narrowband (12.5 kHz) or wideband (amateur FM). Mode: A = analog, D = digital, M = mixed.',
        })}
      </div>

      <div style={{ marginTop: '8px' }}>
        <Field label={t('icsForms.205.special', { defaultValue: 'Special instructions' })} wide>
          <textarea
            style={{ ...inputStyle, resize: 'vertical', minHeight: '40px' }}
            value={f.specialInstructions}
            onChange={(e) => patch('ics205', { specialInstructions: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
