/**
 * LogbookPanel — native QSO logbook (dockable panel `logbook`).
 *
 * QSOs live in the browser via logbookStore (IndexedDB, in-memory fallback).
 * Features: searchable/filterable table (newest first, render-capped), a
 * New/Edit QSO form with UTC now defaults and rig prefill, ADIF import with
 * dedup, ADIF export, and a "log from spot" hand-off — spot panels call
 * requestLogQso() and this panel opens its form pre-filled.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRig } from '../contexts/RigContext.jsx';
import { useLogbook } from '../hooks/useLogbook.js';
import {
  consumePendingPrefill,
  registerPanelMount,
  subscribePrefill,
  tunedSpotPrefill,
  unregisterPanelMount,
} from '../services/logbookStore.js';
import {
  backupFilename,
  buildBackup,
  dismissBackupNudge,
  markBackupDone,
  shouldShowBackupNudge,
} from '../utils/backup.js';
import { getPendingCount, onQsoLogged, processQueue, subscribeLogsync } from '../utils/logsync.js';
import CallsignLink from './CallsignLink.jsx';
import { useCallsignPopup } from './CallsignPopupManager.jsx';
import GroupLogSection from './GroupLogSection.jsx';
import QsoForm, { BANDS, inputStyle, smallBtnStyle } from './QsoForm.jsx';

const MAX_ROWS = 200;

export const LogbookPanel = ({ userCallsign, myGrid }) => {
  const { t } = useTranslation();
  const { showPopup } = useCallsignPopup();
  const { qsos, add, update, remove, importAdif, exportAdif, stats } = useLogbook();

  // Rig state is optional (same as QsoForm): +QSO offers the call of the spot
  // the rig was tuned to, but only while the dial is still on it.
  let rig = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    rig = useRig();
  } catch {
    rig = null;
  }
  const rigFreqHz = rig?.connected && rig.freq > 0 ? rig.freq : null;

  // Report presence to the store so the app-level LogQsoPopup only handles
  // "log this spot" requests when no Logbook panel is around to take them.
  useEffect(() => {
    registerPanelMount();
    return unregisterPanelMount;
  }, []);

  // ── View state ────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = new QSO
  // The QsoForm owns its field state; formInit carries what it starts from and
  // formKey remounts it whenever a new prefill / edit target comes in.
  const [formInit, setFormInit] = useState({ prefill: null, qso: null });
  const [formKey, setFormKey] = useState(0);
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [importSummary, setImportSummary] = useState(null); // {imported, skipped} | {error}
  // Group session UI opens automatically when a session is being resumed.
  const [showGroup, setShowGroup] = useState(() => {
    try {
      return !!localStorage.getItem('openhamclock_groupLog');
    } catch {
      return false;
    }
  });
  const fileInputRef = useRef(null);

  // Log-sync pending pushes (Wavelog/QRZ retry queue) — shown in the footer.
  // Mounting the panel also retries anything left over from a previous session.
  const [syncPending, setSyncPending] = useState(() => getPendingCount());
  useEffect(() => {
    if (getPendingCount() > 0) processQueue().catch(() => {});
    return subscribeLogsync(() => setSyncPending(getPendingCount()));
  }, []);

  // Monthly "back up your log" reminder — recheck after dismiss/export.
  const [nudgeCheck, setNudgeCheck] = useState(0);
  const showBackupNudge = useMemo(
    () => shouldShowBackupNudge(qsos.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qsos.length, nudgeCheck],
  );

  const handleFullBackup = async () => {
    const bundle = await buildBackup();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markBackupDone();
    setNudgeCheck((c) => c + 1);
  };

  const openNewForm = (prefill = {}) => {
    setFormInit({ prefill, qso: null });
    setFormKey((k) => k + 1);
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (qso) => {
    setFormInit({ prefill: null, qso });
    setFormKey((k) => k + 1);
    setEditingId(qso.id);
    setShowForm(true);
  };

  // ── Log-from-spot hand-off ────────────────────────────────────────────────
  // Consume a prefill queued before this panel mounted, then listen for new
  // ones. openNewForm is intentionally read through a ref so the subscription
  // survives re-renders without re-subscribing.
  const openNewFormRef = useRef(openNewForm);
  openNewFormRef.current = openNewForm;
  useEffect(() => {
    const applyPrefill = (p) => {
      if (!p) return;
      const { requestedAt, ...fields } = p;
      openNewFormRef.current(fields);
    };
    applyPrefill(consumePendingPrefill());
    return subscribePrefill((p) => {
      applyPrefill(p);
      consumePendingPrefill();
    });
  }, []);

  // ── Derived table data ────────────────────────────────────────────────────
  const sorted = useMemo(
    () =>
      [...qsos].sort(
        (a, b) =>
          `${b.qso_date || ''}${b.time_on || ''}`.localeCompare(`${a.qso_date || ''}${a.time_on || ''}`) ||
          (a.call || '').localeCompare(b.call || ''),
      ),
    [qsos],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return sorted.filter((rec) => {
      if (bandFilter && rec.band !== bandFilter) return false;
      if (modeFilter && (rec.mode || '').toUpperCase() !== modeFilter) return false;
      if (!q) return true;
      return (
        (rec.call || '').toUpperCase().includes(q) ||
        (rec.name || '').toUpperCase().includes(q) ||
        (rec.comment || '').toUpperCase().includes(q)
      );
    });
  }, [sorted, search, bandFilter, modeFilter]);

  const visible = filtered.slice(0, MAX_ROWS);

  const bandOptions = useMemo(() => {
    const inLog = Object.keys(stats.byBand);
    return BANDS.filter((b) => inLog.includes(b));
  }, [stats.byBand]);

  const modeOptions = useMemo(
    () =>
      Object.keys(stats.byMode)
        .map((m) => m.toUpperCase())
        .sort(),
    [stats.byMode],
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleFormSaved = async (record) => {
    if (editingId) {
      await update(editingId, record);
    } else {
      const saved = await add({ ...record, extras: {} });
      // Log-sync hand-off: queue for Wavelog/QRZ push when those integrations
      // are enabled (fire-and-forget with retry queue — see utils/logsync.js).
      onQsoLogged(saved, { myCall: userCallsign });
    }
    setShowForm(false);
    setEditingId(null);
  };

  const handleDelete = async () => {
    if (!editingId) return;
    const ok = window.confirm(t('logbook.deleteConfirm', { defaultValue: 'Delete this QSO from your logbook?' }));
    if (!ok) return;
    await remove(editingId);
    setShowForm(false);
    setEditingId(null);
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = await importAdif(text);
      setImportSummary(result);
    } catch (err) {
      setImportSummary({ error: String(err?.message || err) });
    }
    setTimeout(() => setImportSummary(null), 8000);
  };

  const handleExport = () => {
    const text = exportAdif({ myCall: userCallsign });
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(
      d.getUTCMinutes(),
    )}${p(d.getUTCSeconds())}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ohc-logbook-${stamp}.adi`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (time_on) => {
    const tt = String(time_on || '');
    return tt.length >= 4 ? `${tt.slice(0, 2)}:${tt.slice(2, 4)}` : tt;
  };

  const formatDate = (qso_date) => {
    const d = String(qso_date || '');
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="panel"
      style={{ padding: '10px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: '12px',
          color: 'var(--accent-green)',
          fontWeight: '700',
          marginBottom: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span>
          📓 {t('logbook.title', { defaultValue: 'LOGBOOK' })}{' '}
          <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: '400' }}>
            {t('logbook.qsoCount', { defaultValue: '{{total}} QSOs', total: stats.total })}
          </span>
        </span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() =>
              showForm && !editingId ? setShowForm(false) : openNewForm(tunedSpotPrefill(rigFreqHz) || {})
            }
            title={t('logbook.newQsoTooltip', { defaultValue: 'Log a new QSO' })}
            aria-label={t('logbook.newQsoTooltip', { defaultValue: 'Log a new QSO' })}
            aria-pressed={showForm && !editingId}
            style={smallBtnStyle(showForm && !editingId)}
          >
            +{t('logbook.newQso', { defaultValue: 'QSO' })}
          </button>
          <button
            type="button"
            onClick={() => setShowGroup((v) => !v)}
            title={t('groupLog.toggleTooltip', {
              defaultValue: 'Group logging — shared log for multi-station operations',
            })}
            aria-label={t('groupLog.toggleTooltip', {
              defaultValue: 'Group logging — shared log for multi-station operations',
            })}
            aria-pressed={showGroup}
            style={smallBtnStyle(showGroup)}
          >
            {t('groupLog.toggle', { defaultValue: 'Group' })}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={t('logbook.importTooltip', { defaultValue: 'Import an ADIF (.adi) log file' })}
            aria-label={t('logbook.importTooltip', { defaultValue: 'Import an ADIF (.adi) log file' })}
            style={smallBtnStyle(false)}
          >
            {t('logbook.import', { defaultValue: 'Import' })}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={stats.total === 0}
            title={t('logbook.exportTooltip', { defaultValue: 'Export your log as ADIF (.adi)' })}
            aria-label={t('logbook.exportTooltip', { defaultValue: 'Export your log as ADIF (.adi)' })}
            style={{ ...smallBtnStyle(false), cursor: stats.total === 0 ? 'not-allowed' : 'pointer' }}
          >
            {t('logbook.export', { defaultValue: 'Export' })}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".adi,.adif"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleImportFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Group logging (Field Day multi-station sessions) */}
      {showGroup && <GroupLogSection userCallsign={userCallsign} />}

      {/* Import summary */}
      {importSummary && (
        <div
          role="status"
          style={{
            fontSize: '10px',
            marginBottom: '6px',
            color: importSummary.error ? 'var(--accent-red)' : 'var(--accent-green)',
          }}
        >
          {importSummary.error
            ? t('logbook.importFailed', { defaultValue: 'Import failed: {{error}}', error: importSummary.error })
            : t('logbook.importSummary', {
                defaultValue: 'Imported {{imported}}, skipped {{skipped}} dupes',
                imported: importSummary.imported,
                skipped: importSummary.skipped,
              })}
        </div>
      )}

      {/* QSO form (shared with LogQsoPopup — see QsoForm.jsx) */}
      {showForm && (
        <div style={{ marginBottom: '8px' }}>
          <QsoForm
            key={formKey}
            prefill={formInit.prefill || undefined}
            editQso={formInit.qso || undefined}
            myGrid={myGrid}
            onSaved={handleFormSaved}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            onDelete={editingId ? handleDelete : undefined}
          />
        </div>
      )}

      {/* Search + filters */}
      {stats.total > 0 && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          <input
            type="text"
            placeholder={t('logbook.search', { defaultValue: 'Search call / name / comment...' })}
            aria-label={t('logbook.search', { defaultValue: 'Search logbook' })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={bandFilter}
            onChange={(e) => setBandFilter(e.target.value)}
            aria-label={t('logbook.filterBand', { defaultValue: 'Filter by band' })}
            style={{ ...inputStyle, width: 'auto', flex: '0 0 auto' }}
          >
            <option value="">{t('logbook.allBands', { defaultValue: 'All bands' })}</option>
            {bandOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            aria-label={t('logbook.filterMode', { defaultValue: 'Filter by mode' })}
            style={{ ...inputStyle, width: 'auto', flex: '0 0 auto' }}
          >
            <option value="">{t('logbook.allModes', { defaultValue: 'All modes' })}</option>
            {modeOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Table / empty state */}
      {stats.total === 0 && !showForm ? (
        <div
          style={{
            textAlign: 'center',
            padding: '24px 12px',
            color: 'var(--text-muted)',
            fontSize: '12px',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '6px' }}>📓</div>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '4px' }}>
            {t('logbook.emptyTitle', { defaultValue: 'Your logbook is empty' })}
          </div>
          <div style={{ maxWidth: '360px', margin: '0 auto' }}>
            {t('logbook.emptyBody', {
              defaultValue:
                'QSOs you log here are stored in this browser and can be exported as ADIF at any time. Log a contact with +QSO, use the 📓+ button on any DX cluster or activation spot, or import your existing log.',
            })}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ ...smallBtnStyle(true), marginTop: '10px' }}
          >
            {t('logbook.emptyImport', { defaultValue: 'Import ADIF log' })}
          </button>
        </div>
      ) : (
        <div
          role="table"
          aria-label={t('logbook.tableLabel', { defaultValue: 'Logged QSOs' })}
          style={{ flex: 1, overflow: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
        >
          <div className="visually-hidden" role="row">
            <span role="columnheader">{t('logbook.col.dateTime', { defaultValue: 'Date and time (UTC)' })}</span>
            <span role="columnheader">{t('logbook.col.call', { defaultValue: 'Callsign' })}</span>
            <span role="columnheader">{t('logbook.col.band', { defaultValue: 'Band' })}</span>
            <span role="columnheader">{t('logbook.col.mode', { defaultValue: 'Mode' })}</span>
            <span role="columnheader">{t('logbook.col.freq', { defaultValue: 'Frequency' })}</span>
            <span role="columnheader">{t('logbook.col.rst', { defaultValue: 'RST sent/received' })}</span>
            <span role="columnheader">{t('logbook.col.grid', { defaultValue: 'Grid' })}</span>
            <span role="columnheader">{t('logbook.col.name', { defaultValue: 'Name' })}</span>
          </div>
          {visible.map((qso, i) => (
            <div
              key={qso.id}
              role="row"
              onClick={() => openEditForm(qso)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openEditForm(qso);
                }
              }}
              tabIndex={0}
              title={t('logbook.rowTooltip', { defaultValue: 'Click to edit this QSO' })}
              style={{
                display: 'grid',
                gridTemplateColumns: '96px 1fr 38px 44px 58px 60px 48px minmax(0, 0.8fr)',
                gap: '6px',
                padding: '4px 6px',
                borderRadius: '3px',
                marginBottom: '1px',
                background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div role="cell" style={{ color: 'var(--text-muted)', fontSize: '10px', alignSelf: 'center' }}>
                {formatDate(qso.qso_date)} {formatTime(qso.time_on)}
              </div>
              <div
                role="cell"
                style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                <CallsignLink
                  call={qso.call}
                  color="var(--text-primary)"
                  fontWeight="700"
                  onPopup={showPopup}
                  location={qso.gridsquare ? { grid: qso.gridsquare } : undefined}
                />
                {qso.extras?.LOTW_QSL_RCVD === 'Y' && (
                  <span
                    title={t('logbook.lotwConfirmed', { defaultValue: 'Confirmed on LoTW' })}
                    aria-label={t('logbook.lotwConfirmed', { defaultValue: 'Confirmed on LoTW' })}
                    style={{
                      marginLeft: 4,
                      fontSize: '8px',
                      fontWeight: 700,
                      color: 'var(--accent-green)',
                      border: '1px solid var(--accent-green)',
                      borderRadius: 3,
                      padding: '0 3px',
                      verticalAlign: 'middle',
                    }}
                  >
                    LoTW✓
                  </span>
                )}
              </div>
              <div role="cell" style={{ color: 'var(--accent-cyan)', alignSelf: 'center', fontSize: '10px' }}>
                {qso.band || '—'}
              </div>
              <div role="cell" style={{ color: 'var(--text-secondary)', alignSelf: 'center', fontSize: '10px' }}>
                {qso.mode || '—'}
              </div>
              <div role="cell" style={{ color: 'var(--text-secondary)', alignSelf: 'center', fontSize: '10px' }}>
                {qso.freq != null && qso.freq !== '' ? Number(qso.freq).toFixed(3) : '—'}
              </div>
              <div role="cell" style={{ color: 'var(--text-muted)', alignSelf: 'center', fontSize: '10px' }}>
                {qso.rst_sent || '—'}/{qso.rst_rcvd || '—'}
              </div>
              <div role="cell" style={{ color: 'var(--text-muted)', alignSelf: 'center', fontSize: '10px' }}>
                {qso.gridsquare || ''}
              </div>
              <div
                role="cell"
                style={{
                  color: 'var(--text-muted)',
                  alignSelf: 'center',
                  fontSize: '10px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={qso.comment || undefined}
              >
                {qso.name || qso.comment || ''}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '11px' }}>
              {t('logbook.noMatch', { defaultValue: 'No QSOs match the current search/filters' })}
            </div>
          )}
        </div>
      )}

      {/* Backup reminder: log is browser-local; nudge monthly once it's worth protecting */}
      {showBackupNudge && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '6px',
            padding: '5px 8px',
            background: 'rgba(255, 191, 0, 0.08)',
            border: '1px solid rgba(255, 191, 0, 0.35)',
            borderRadius: '4px',
            fontSize: '10px',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ flex: 1, lineHeight: 1.4 }}>
            {t('logbook.backupNudge.body', {
              defaultValue:
                "Your log ({{count}} QSOs) hasn't been backed up in over a month. It lives only in this browser — export a full backup to keep it safe.",
              count: stats.total,
            })}
          </span>
          <button type="button" onClick={handleFullBackup} style={smallBtnStyle(true)}>
            {t('logbook.backupNudge.go', { defaultValue: 'Back up now' })}
          </button>
          <button
            type="button"
            onClick={() => {
              dismissBackupNudge();
              setNudgeCheck((c) => c + 1);
            }}
            title={t('logbook.backupNudge.dismiss', { defaultValue: 'Dismiss backup reminder for 30 days' })}
            aria-label={t('logbook.backupNudge.dismiss', { defaultValue: 'Dismiss backup reminder for 30 days' })}
            style={smallBtnStyle(false)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Footer: showing X of Y + per-band mini summary */}
      {stats.total > 0 && (
        <div
          style={{
            marginTop: '6px',
            fontSize: '9px',
            color: 'var(--text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span>
            {filtered.length > MAX_ROWS
              ? t('logbook.showing', {
                  defaultValue: 'Showing {{shown}} of {{total}}',
                  shown: visible.length,
                  total: filtered.length,
                })
              : t('logbook.showingAll', { defaultValue: '{{total}} shown', total: filtered.length })}
            {syncPending > 0 && (
              <span
                style={{ marginLeft: 8, color: 'var(--accent-amber)' }}
                title={t('logbook.syncPendingTooltip', {
                  defaultValue: 'QSOs waiting to be pushed to Wavelog/QRZ — see Settings → Integrations → Logbook Sync',
                })}
              >
                ⇪ {t('logbook.syncPending', { defaultValue: '{{count}} pending sync', count: syncPending })}
              </span>
            )}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {BANDS.filter((b) => stats.byBand[b])
              .map((b) => `${b}:${stats.byBand[b]}`)
              .join(' ')}
          </span>
        </div>
      )}
    </div>
  );
};

export default LogbookPanel;
