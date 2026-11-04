/**
 * NetSchedulePanel — user-defined recurring nets (dockable panel
 * `net-schedule`).
 *
 * Nets are { id, name, freq_mhz?, mode?, day: 0-6|'daily', time_utc 'HHMM',
 * duration_min?, notes? }, persisted in localStorage
 * (openhamclock_netSchedule — synced/profiled/backed up like other user
 * state). The list is sorted by next occurrence (src/utils/netSchedule.js)
 * with a live countdown; running nets are highlighted ON NOW. Rows with a
 * frequency click-to-tune via RigContext.tuneTo. The add/edit form takes a
 * UTC time and previews it in the user's local timezone.
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRig } from '../contexts/RigContext.jsx';
import { useNetLoggerNets } from '../hooks/useNetLoggerNets.js';
import { formatMemoryFreq, parseFreqMHz } from '../utils/freqMemories.js';
import {
  loadNetSchedule,
  saveNetSchedule,
  sortByNextOccurrence,
  nextOccurrence,
  formatCountdown,
  isValidTimeUtc,
} from '../utils/netSchedule.js';

const MODE_OPTIONS = ['SSB', 'USB', 'LSB', 'CW', 'AM', 'FM', 'FT8', 'DATA', 'DMR', 'D-STAR', 'YSF'];

// Localized short weekday names, index = JS getUTCDay() (0 = Sunday).
// 2023-01-01 was a Sunday.
const dayNames = (() => {
  try {
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))));
  } catch {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  }
})();

const inputStyle = {
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

const iconBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  opacity: 0.8,
  padding: '1px 3px',
  fontSize: '10px',
  lineHeight: 1,
};

const blankForm = () => ({ name: '', freq_mhz: '', mode: '', day: 'daily', time_utc: '', duration_min: '', notes: '' });

const newId = () => `net-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const NetSchedulePanel = () => {
  const { t } = useTranslation();

  // Rig state is optional — resilient outside RigProvider (tests, storybooks).
  let rig = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    rig = useRig();
  } catch {
    rig = null;
  }
  const canTune = !!rig?.enabled;

  const [nets, setNets] = useState(loadNetSchedule);
  const [now, setNow] = useState(() => new Date());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [formError, setFormError] = useState(false);

  // "My nets" (the local schedule) vs "Live" (NetLogger's active nets).
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem('ohc_nets_tab') === 'live' ? 'live' : 'mine';
    } catch {
      return 'mine';
    }
  });
  const switchTab = (next) => {
    setTab(next);
    try {
      localStorage.setItem('ohc_nets_tab', next);
    } catch {}
  };
  const live = useNetLoggerNets({ enabled: tab === 'live' });
  const [expandedNet, setExpandedNet] = useState(null); // "server|name"
  const [checkins, setCheckins] = useState({}); // key → { loading, data, error }

  const toggleExpand = async (net) => {
    const key = `${net.server}|${net.name}`;
    if (expandedNet === key) {
      setExpandedNet(null);
      return;
    }
    setExpandedNet(key);
    setCheckins((c) => ({ ...c, [key]: { ...(c[key] || {}), loading: true } }));
    try {
      const data = await live.loadCheckins(net);
      setCheckins((c) => ({ ...c, [key]: { loading: false, data, error: null } }));
    } catch (err) {
      setCheckins((c) => ({ ...c, [key]: { loading: false, data: null, error: err?.message || 'failed' } }));
    }
  };

  const handleLiveTune = (net) => {
    if (!canTune || net.freq == null) return;
    rig.tuneTo(net.freq, net.mode || null);
  };

  // Countdown tick — 30 s keeps "in 2h 14m" honest without burning cycles
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  const sorted = useMemo(() => sortByNextOccurrence(nets, now), [nets, now]);

  const persist = (next) => {
    setNets(next);
    saveNetSchedule(next);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(blankForm());
    setFormError(false);
    setShowForm(true);
  };

  const openEdit = (net) => {
    setEditingId(net.id);
    setForm({
      name: net.name,
      freq_mhz: net.freq_mhz != null ? String(net.freq_mhz) : '',
      mode: net.mode || '',
      day: net.day,
      time_utc: net.time_utc,
      duration_min: net.duration_min != null ? String(net.duration_min) : '',
      notes: net.notes || '',
    });
    setFormError(false);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(blankForm());
    setFormError(false);
  };

  const buildFromForm = () => {
    const name = form.name.trim();
    if (!name || !isValidTimeUtc(form.time_utc)) return null;
    const net = {
      id: editingId || newId(),
      name,
      day: form.day === 'daily' ? 'daily' : Number(form.day),
      time_utc: form.time_utc,
    };
    const freq = parseFreqMHz(form.freq_mhz);
    if (form.freq_mhz.trim() !== '' && freq == null) return null;
    if (freq != null) net.freq_mhz = freq;
    const mode = form.mode.trim().toUpperCase();
    if (mode) net.mode = mode;
    const dur = Number(form.duration_min);
    if (Number.isFinite(dur) && dur > 0) net.duration_min = dur;
    const notes = form.notes.trim();
    if (notes) net.notes = notes;
    return net;
  };

  const handleSave = (e) => {
    e.preventDefault();
    const built = buildFromForm();
    if (!built) {
      setFormError(true);
      return;
    }
    persist(editingId ? nets.map((n) => (n.id === editingId ? built : n)) : [...nets, built]);
    closeForm();
  };

  const handleDelete = (id) => persist(nets.filter((n) => n.id !== id));

  const handleRowTune = (net) => {
    if (!canTune || net.freq_mhz == null) return;
    rig.tuneTo(net.freq_mhz, net.mode || null);
  };

  // Local-time preview of the UTC time typed in the form
  const localPreview = useMemo(() => {
    if (!isValidTimeUtc(form.time_utc)) return null;
    const next = nextOccurrence(
      { day: form.day === 'daily' ? 'daily' : Number(form.day), time_utc: form.time_utc },
      now,
    );
    if (!next) return null;
    try {
      return next.start.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  }, [form.day, form.time_utc, now]);

  const formValid = form.name.trim() !== '' && isValidTimeUtc(form.time_utc);

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>🕐 {t('netSchedule.title', { defaultValue: 'NET SCHEDULE' })}</span>
          <span
            role="tablist"
            aria-label={t('netSchedule.tabs', { defaultValue: 'Net list' })}
            style={{ display: 'flex' }}
          >
            {[
              ['mine', t('netSchedule.tabMine', { defaultValue: 'My nets' })],
              ['live', t('netSchedule.tabLive', { defaultValue: 'Live' })],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => switchTab(id)}
                style={{
                  background: tab === id ? 'var(--accent-amber)' : 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: id === 'mine' ? '4px 0 0 4px' : '0 4px 4px 0',
                  color: tab === id ? '#000' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  padding: '1px 6px',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: tab === id ? '700' : '400',
                }}
              >
                {label}
              </button>
            ))}
          </span>
        </span>
        {tab === 'mine' ? (
          <button
            onClick={showForm ? closeForm : openAdd}
            title={
              showForm
                ? t('netSchedule.cancel', { defaultValue: 'Cancel' })
                : t('netSchedule.add', { defaultValue: 'Add net' })
            }
            aria-label={
              showForm
                ? t('netSchedule.cancel', { defaultValue: 'Cancel' })
                : t('netSchedule.add', { defaultValue: 'Add net' })
            }
            style={{
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '10px',
              padding: '1px 7px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {showForm ? '✕' : '+'}
          </button>
        ) : (
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: '400' }}>
            {live.loading
              ? '…'
              : t('netSchedule.liveCount', { defaultValue: '{{count}} on air', count: live.nets.length })}
          </span>
        )}
      </div>

      {tab === 'mine' && showForm && (
        <form
          onSubmit={handleSave}
          style={{
            marginBottom: '6px',
            padding: '6px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontSize: '10px',
          }}
        >
          <input
            style={inputStyle}
            value={form.name}
            maxLength={60}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t('netSchedule.namePlaceholder', { defaultValue: 'Net name (e.g. ARES check-in)' })}
            aria-label={t('netSchedule.namePlaceholder', { defaultValue: 'Net name (e.g. ARES check-in)' })}
            autoFocus
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <select
              style={{ ...inputStyle, flex: 1 }}
              value={String(form.day)}
              onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
              aria-label={t('netSchedule.dayLabel', { defaultValue: 'Day' })}
            >
              <option value="daily">{t('netSchedule.daily', { defaultValue: 'Daily' })}</option>
              {dayNames.map((name, i) => (
                <option key={i} value={String(i)}>
                  {name}
                </option>
              ))}
            </select>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={form.time_utc}
              maxLength={4}
              inputMode="numeric"
              onChange={(e) => {
                setForm((f) => ({ ...f, time_utc: e.target.value.replace(/\D/g, '') }));
                setFormError(false);
              }}
              placeholder={t('netSchedule.timePlaceholder', { defaultValue: 'UTC HHMM' })}
              aria-label={t('netSchedule.timePlaceholder', { defaultValue: 'UTC HHMM' })}
              aria-invalid={formError && !isValidTimeUtc(form.time_utc)}
            />
            <input
              style={{ ...inputStyle, flex: '0 0 60px', width: 'auto' }}
              value={form.duration_min}
              maxLength={3}
              inputMode="numeric"
              onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value.replace(/\D/g, '') }))}
              placeholder={t('netSchedule.durationPlaceholder', { defaultValue: 'min' })}
              aria-label={t('netSchedule.durationLabel', { defaultValue: 'Duration (minutes)' })}
              title={t('netSchedule.durationLabel', { defaultValue: 'Duration (minutes)' })}
            />
          </div>
          {localPreview && (
            <div style={{ color: 'var(--accent-cyan)', fontSize: '9px' }}>
              {t('netSchedule.localPreview', { defaultValue: '≈ {{time}} your time', time: localPreview })}
            </div>
          )}
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={form.freq_mhz}
              inputMode="decimal"
              onChange={(e) => {
                setForm((f) => ({ ...f, freq_mhz: e.target.value }));
                setFormError(false);
              }}
              placeholder={t('netSchedule.freqPlaceholder', { defaultValue: 'MHz (optional)' })}
              aria-label={t('netSchedule.freqPlaceholder', { defaultValue: 'MHz (optional)' })}
            />
            <select
              style={{ ...inputStyle, flex: '0 0 70px', width: 'auto' }}
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
              aria-label={t('netSchedule.modeLabel', { defaultValue: 'Mode' })}
            >
              <option value="">{t('netSchedule.modeAny', { defaultValue: '(mode)' })}</option>
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <input
            style={inputStyle}
            value={form.notes}
            maxLength={120}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={t('netSchedule.notesPlaceholder', { defaultValue: 'Notes (optional)' })}
            aria-label={t('netSchedule.notesPlaceholder', { defaultValue: 'Notes (optional)' })}
          />
          {formError && (
            <div style={{ color: 'var(--accent-red, #f44)', fontSize: '9px' }}>
              {t('netSchedule.invalidForm', {
                defaultValue: 'Enter a name, a UTC time as HHMM (e.g. 1930), and a valid frequency in MHz',
              })}
            </div>
          )}
          <div>
            <button
              type="submit"
              disabled={!formValid}
              style={{
                background: formValid ? 'rgba(0, 255, 136, 0.15)' : 'rgba(100,100,100,0.3)',
                border: `1px solid ${formValid ? 'var(--accent-green)' : '#666'}`,
                color: formValid ? 'var(--accent-green)' : '#888',
                padding: '2px 10px',
                borderRadius: '4px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                cursor: formValid ? 'pointer' : 'default',
              }}
            >
              {t('netSchedule.save', { defaultValue: 'Save' })}
            </button>
          </div>
        </form>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {tab === 'live' ? (
          live.loading && live.nets.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <div className="loading-spinner" />
            </div>
          ) : live.nets.length === 0 ? (
            <div style={{ color: live.error ? 'var(--accent-red, #f44)' : 'var(--text-muted)', padding: '10px 4px' }}>
              {live.error
                ? t('netSchedule.liveError', { defaultValue: 'NetLogger is not answering — retrying every minute.' })
                : t('netSchedule.liveEmpty', { defaultValue: 'No nets are being logged on NetLogger right now.' })}
            </div>
          ) : (
            live.nets.map((net) => {
              const key = `${net.server}|${net.name}`;
              const open = expandedNet === key;
              const ci = checkins[key];
              const tunable = canTune && net.freq != null;
              return (
                <div
                  key={key}
                  style={{
                    padding: '5px 6px',
                    marginBottom: '3px',
                    borderRadius: '4px',
                    background: open ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                    border: '1px solid transparent',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleExpand(net)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(net);
                      }
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                    title={t('netSchedule.liveExpand', { defaultValue: 'Show check-ins' })}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: '8px' }}>{open ? '▼' : '▶'}</span>
                    <span
                      style={{
                        color: 'var(--text-primary)',
                        fontWeight: '600',
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {net.name}
                    </span>
                    <span
                      style={{
                        background: 'rgba(74, 222, 128, 0.2)',
                        color: '#4ade80',
                        border: '1px solid #4ade80',
                        padding: '0 5px',
                        borderRadius: '3px',
                        fontSize: '8px',
                        fontWeight: '700',
                        flexShrink: 0,
                      }}
                      title={t('netSchedule.liveCheckins', { defaultValue: 'Check-ins' })}
                    >
                      {net.checkins}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '6px',
                      marginTop: '2px',
                      color: 'var(--text-muted)',
                      fontSize: '9px',
                      paddingLeft: '14px',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {net.ncs ? `NCS ${net.ncs}` : ''}
                      {net.started ? (
                        <span style={{ marginLeft: net.ncs ? '6px' : 0 }}>
                          {t('netSchedule.liveSince', {
                            defaultValue: 'since {{time}}z',
                            time: net.started.slice(11, 16),
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {net.freq != null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLiveTune(net);
                          }}
                          disabled={!tunable}
                          title={
                            tunable
                              ? t('netSchedule.tuneTooltip', {
                                  defaultValue: 'Tune rig to {{freq}} MHz',
                                  freq: formatMemoryFreq(net.freq),
                                })
                              : undefined
                          }
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            color: 'var(--accent-amber)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '9px',
                            cursor: tunable ? 'pointer' : 'default',
                            textDecoration: tunable ? 'underline dotted' : 'none',
                          }}
                        >
                          {formatMemoryFreq(net.freq)}
                        </button>
                      ) : net.freqRaw ? (
                        <span>{net.freqRaw}</span>
                      ) : null}
                      {net.mode && <span style={{ marginLeft: '4px' }}>{net.mode}</span>}
                      {net.band && <span style={{ marginLeft: '4px', opacity: 0.7 }}>{net.band}</span>}
                    </span>
                  </div>
                  {open && (
                    <div style={{ marginTop: '4px', paddingLeft: '14px', fontSize: '9px' }}>
                      {ci?.loading ? (
                        <span style={{ color: 'var(--text-muted)' }}>…</span>
                      ) : ci?.error ? (
                        <span style={{ color: 'var(--accent-red, #f44)' }}>
                          {t('netSchedule.liveCheckinsError', { defaultValue: 'Could not load check-ins' })}
                        </span>
                      ) : ci?.data?.checkins?.length ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2px 8px' }}>
                          {ci.data.checkins.map((c) => (
                            <div key={`${c.serial}-${c.call}`} style={{ display: 'contents' }}>
                              <span
                                style={{
                                  color:
                                    c.status && /nc/i.test(c.status) ? 'var(--accent-amber)' : 'var(--text-primary)',
                                  fontWeight: '600',
                                }}
                                title={c.status || ''}
                              >
                                {c.call}
                              </span>
                              <span
                                style={{
                                  color: 'var(--text-muted)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {[c.name, c.city, c.state || c.country].filter(Boolean).join(', ')}
                                {c.remarks ? ` — ${c.remarks}` : ''}
                              </span>
                              <span style={{ color: 'var(--text-secondary)' }}>{c.grid || ''}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {t('netSchedule.liveNoCheckins', { defaultValue: 'No check-ins yet' })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : nets.length === 0 && !showForm ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px 4px', lineHeight: 1.5 }}>
            {t('netSchedule.empty', {
              defaultValue:
                'No nets yet. Add your regular nets with the + button — the list sorts by next start time with a live countdown, and nets with a frequency click-to-tune when rig control is on.',
            })}
          </div>
        ) : (
          sorted.map(({ net, next }) => {
            const onNow = !!next?.onNow;
            const tunable = canTune && net.freq_mhz != null;
            return (
              <div
                key={net.id}
                onClick={() => handleRowTune(net)}
                title={
                  tunable
                    ? t('netSchedule.tuneTooltip', {
                        defaultValue: 'Tune rig to {{freq}} MHz',
                        freq: formatMemoryFreq(net.freq_mhz),
                      })
                    : net.notes || undefined
                }
                style={{
                  padding: '5px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: onNow ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255,255,255,0.03)',
                  border: onNow ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid transparent',
                  cursor: tunable ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: '600',
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {net.name}
                  </span>
                  {onNow ? (
                    <span
                      style={{
                        background: 'rgba(74, 222, 128, 0.25)',
                        color: '#4ade80',
                        border: '1px solid #4ade80',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '8px',
                        fontWeight: '700',
                        flexShrink: 0,
                      }}
                    >
                      {t('netSchedule.onNow', { defaultValue: 'ON NOW' })}
                    </span>
                  ) : next ? (
                    <span style={{ color: 'var(--accent-amber)', fontSize: '9px', flexShrink: 0 }}>
                      {t('netSchedule.countdown', {
                        defaultValue: 'in {{time}}',
                        time: formatCountdown(next.start.getTime() - now.getTime()),
                      })}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--accent-red, #f44)', fontSize: '9px', flexShrink: 0 }}>
                      {t('netSchedule.invalidNet', { defaultValue: 'invalid' })}
                    </span>
                  )}
                  <span style={{ display: 'flex', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      style={iconBtnStyle}
                      onClick={() => openEdit(net)}
                      title={t('netSchedule.edit', { defaultValue: 'Edit' })}
                      aria-label={t('netSchedule.edit', { defaultValue: 'Edit' })}
                    >
                      ✎
                    </button>
                    <button
                      style={iconBtnStyle}
                      onClick={() => handleDelete(net.id)}
                      title={t('netSchedule.delete', { defaultValue: 'Delete' })}
                      aria-label={t('netSchedule.delete', { defaultValue: 'Delete' })}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                    marginTop: '2px',
                    color: 'var(--text-muted)',
                    fontSize: '9px',
                  }}
                >
                  <span>
                    {net.day === 'daily'
                      ? t('netSchedule.daily', { defaultValue: 'Daily' })
                      : dayNames[Number(net.day)] || '?'}{' '}
                    {net.time_utc}z
                    {next && (
                      <span style={{ marginLeft: '5px', color: 'var(--text-secondary)' }}>
                        {next.start.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {net.freq_mhz != null && (
                      <span style={{ color: 'var(--accent-amber)' }}>{formatMemoryFreq(net.freq_mhz)}</span>
                    )}
                    {net.mode && <span style={{ marginLeft: '4px' }}>{net.mode}</span>}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
          paddingTop: '2px',
        }}
      >
        {tab === 'live'
          ? t('netSchedule.liveFooter', {
              defaultValue: 'NetLogger · refreshes every minute · click a net for check-ins',
            })
          : t('netSchedule.footer', { defaultValue: 'times in UTC · gray preview in your local time' })}
      </div>
    </div>
  );
};

export default NetSchedulePanel;
