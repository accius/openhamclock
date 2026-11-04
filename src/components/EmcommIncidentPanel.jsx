/**
 * EmComm rail → Incident panel: create / join / leave a shared incident,
 * the incident board (name, IC, net frequency, notes), the invite (QR + id
 * + key), manual check-ins into the shared roster, and — for the holder of
 * the admin key — the admin key itself and join-key rotation.
 *
 * All sync logic lives in useSharedIncident; this component only renders
 * the hook's state and calls its actions.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QrCode } from './RemoteControlSettings.jsx';
import { formatCode } from '../utils/incidentSync.js';

const INPUT = {
  background: '#1a1a1a',
  color: '#ddd',
  border: '1px solid #333',
  borderRadius: '3px',
  fontSize: '11px',
  padding: '3px 6px',
  width: '100%',
  boxSizing: 'border-box',
};
const BTN = {
  background: 'transparent',
  color: '#ccc',
  border: '1px solid #444',
  borderRadius: '3px',
  fontSize: '10px',
  padding: '2px 8px',
  cursor: 'pointer',
};
const BTN_PRIMARY = { ...BTN, color: '#38bdf8', border: '1px solid #38bdf866' };
const BTN_DANGER = { ...BTN, color: '#ef4444', border: '1px solid #ef444455' };
const LABEL = { color: '#777', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: '4px' };
const MONO = { fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.5px' };
const TINY_BTN = {
  background: 'none',
  border: '1px solid #333',
  borderRadius: '3px',
  color: '#888',
  fontSize: '9px',
  padding: '0 4px',
  cursor: 'pointer',
  flexShrink: 0,
};

const STATUS_STYLE = {
  live: { color: '#22c55e', key: 'emcomm.incident.status.live', label: 'LIVE' },
  connecting: { color: '#f59e0b', key: 'emcomm.incident.status.connecting', label: 'CONNECTING' },
  offline: { color: '#f59e0b', key: 'emcomm.incident.status.offline', label: 'OFFLINE' },
  error: { color: '#ef4444', key: 'emcomm.incident.status.error', label: 'ERROR' },
  idle: { color: '#666', key: 'emcomm.incident.status.idle', label: 'LOCAL' },
};

/** Small coloured status word for the panel header. */
export function IncidentStatusPill({ status }) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[status] || STATUS_STYLE.idle;
  return (
    <span
      data-testid="incident-status"
      style={{
        color: s.color,
        border: `1px solid ${s.color}66`,
        borderRadius: '3px',
        fontSize: '9px',
        fontWeight: 700,
        padding: '0 4px',
        letterSpacing: '0.5px',
      }}
    >
      ● {t(s.key, { defaultValue: s.label })}
    </span>
  );
}

/** ✎ / ✕ for an admin on a shared Event Log or Field Report row. */
export function IncidentAdminButtons({ onEdit, onDelete }) {
  const { t } = useTranslation();
  return (
    <span style={{ display: 'inline-flex', gap: '3px', marginLeft: 'auto', flexShrink: 0 }}>
      <button
        type="button"
        style={TINY_BTN}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title={t('emcomm.incident.editRecord', { defaultValue: 'Correct this entry for everyone (admin)' })}
        aria-label={t('emcomm.incident.editRecord', { defaultValue: 'Correct this entry for everyone (admin)' })}
      >
        ✎
      </button>
      <button
        type="button"
        style={{ ...TINY_BTN, color: '#ef4444', borderColor: '#ef444455' }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t('emcomm.incident.deleteRecord', { defaultValue: 'Delete this entry for everyone (admin)' })}
        aria-label={t('emcomm.incident.deleteRecord', { defaultValue: 'Delete this entry for everyone (admin)' })}
      >
        ✕
      </button>
    </span>
  );
}

const EMPTY_FORM = { name: '', ic: '', netFreq: '', notes: '', site: '', id: '', key: '' };

export default function EmcommIncidentPanel({ incident, callsign }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [boardDraft, setBoardDraft] = useState(null); // non-null while editing
  const [showInvite, setShowInvite] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [checkinCall, setCheckinCall] = useState('');
  const [checkinStatus, setCheckinStatus] = useState('');
  const [copied, setCopied] = useState(false);

  // An invite link opened this page (or the join key changed): pre-fill Join.
  const invite = incident.invite;
  useEffect(() => {
    if (!invite) return;
    setMode('join');
    setForm((f) => ({ ...f, id: invite.id, key: invite.key || '', site: invite.site || f.site }));
  }, [invite]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      if (mode === 'create') await incident.create(form);
      else await incident.join(form.id, form.key, form.site);
      setMode(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(incident.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the id and key are on screen */
    }
  };

  const leave = () => {
    const msg = incident.pending
      ? t('emcomm.incident.leavePending', {
          count: incident.pending,
          defaultValue:
            'Leave this incident? {{count}} update(s) have not reached the server yet and will be discarded.',
        })
      : t('emcomm.incident.leaveConfirm', {
          defaultValue: "Leave this incident? This browser goes back to its own log and this server's roster.",
        });
    if (!window.confirm(msg)) return;
    setShowInvite(false);
    setShowAdminKey(false);
    setBoardDraft(null);
    incident.leave();
  };

  const rotate = async () => {
    if (
      !window.confirm(
        t('emcomm.incident.rotateConfirm', {
          defaultValue:
            'Make a new join key? Every operator is disconnected until they join again with the new key. Use this if the key reached someone it should not have.',
        }),
      )
    )
      return;
    try {
      await incident.rotateJoinKey();
      setShowInvite(true);
    } catch (err) {
      window.alert(err?.message || String(err));
    }
  };

  const doCheckIn = () => {
    if (!checkinCall.trim()) return;
    incident.checkIn({ call: checkinCall, status: checkinStatus });
    setCheckinCall('');
    setCheckinStatus('');
  };

  // ── Not joined ────────────────────────────────────────────────────────────
  if (!incident.joined) {
    return (
      <div data-testid="incident-panel-local" style={{ padding: '4px 8px 6px', fontSize: '11px' }}>
        {incident.error && <div style={{ color: '#f59e0b', marginBottom: '6px' }}>{incident.error}</div>}
        {!mode && (
          <>
            <div style={{ color: '#777', lineHeight: 1.5, marginBottom: '6px' }}>
              {t('emcomm.incident.localOnly', {
                defaultValue:
                  'Local only: the roster, event log and reports stay in this browser. Create an incident to share them with other operators and sites, or join one.',
              })}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" style={BTN_PRIMARY} onClick={() => setMode('create')}>
                {t('emcomm.incident.create', { defaultValue: 'Create' })}
              </button>
              <button type="button" style={BTN} onClick={() => setMode('join')}>
                {t('emcomm.incident.join', { defaultValue: 'Join' })}
              </button>
            </div>
          </>
        )}
        {mode && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
          >
            {invite?.key && mode === 'join' && (
              <div style={{ color: '#38bdf8', marginBottom: '4px' }}>
                {t('emcomm.incident.inviteFound', {
                  defaultValue: 'Invite link opened. Check the details and press Join.',
                })}
              </div>
            )}
            {mode === 'create' ? (
              <>
                <div style={LABEL}>{t('emcomm.incident.name', { defaultValue: 'Incident name' })}</div>
                <input
                  style={INPUT}
                  name="incident-name"
                  value={form.name}
                  onChange={set('name')}
                  maxLength={80}
                  autoFocus
                />
                <div style={LABEL}>{t('emcomm.incident.ic', { defaultValue: 'Incident commander' })}</div>
                <input style={INPUT} name="incident-ic" value={form.ic} onChange={set('ic')} maxLength={80} />
                <div style={LABEL}>{t('emcomm.incident.netFreq', { defaultValue: 'Net frequency' })}</div>
                <input
                  style={INPUT}
                  name="incident-netfreq"
                  value={form.netFreq}
                  onChange={set('netFreq')}
                  maxLength={40}
                />
              </>
            ) : (
              <>
                <div style={LABEL}>{t('emcomm.incident.id', { defaultValue: 'Incident id' })}</div>
                <input
                  style={{ ...INPUT, ...MONO }}
                  name="incident-id"
                  value={form.id}
                  onChange={set('id')}
                  maxLength={12}
                  autoFocus={!form.id}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <div style={LABEL}>{t('emcomm.incident.keyOrAdmin', { defaultValue: 'Join key (or admin key)' })}</div>
                <input
                  style={{ ...INPUT, ...MONO }}
                  name="incident-key"
                  value={form.key}
                  onChange={set('key')}
                  maxLength={24}
                  autoFocus={!!form.id && !form.key}
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoComplete="off"
                />
              </>
            )}
            <div style={LABEL}>{t('emcomm.incident.site', { defaultValue: 'Your site (optional)' })}</div>
            <input
              style={INPUT}
              name="incident-site"
              value={form.site}
              onChange={set('site')}
              maxLength={40}
              placeholder={callsign || ''}
            />
            {formError && <div style={{ color: '#ef4444', marginTop: '4px' }}>{formError}</div>}
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              <button type="submit" style={BTN_PRIMARY} disabled={busy}>
                {mode === 'create'
                  ? t('emcomm.incident.create', { defaultValue: 'Create' })
                  : t('emcomm.incident.join', { defaultValue: 'Join' })}
              </button>
              <button
                type="button"
                style={BTN}
                onClick={() => {
                  setMode(null);
                  setFormError(null);
                  incident.clearInvite();
                }}
              >
                {t('emcomm.incident.cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // ── Joined ────────────────────────────────────────────────────────────────
  const board = incident.board || {};
  const s = incident.session;
  const isAdmin = incident.isAdmin;
  return (
    <div
      data-testid="incident-panel"
      style={{ padding: '4px 8px 6px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px' }}>
        <span>
          <span data-testid="incident-id" style={{ color: '#38bdf8', ...MONO }}>
            {formatCode(s.id)}
          </span>
          <span
            data-testid="incident-role"
            style={{
              marginLeft: '6px',
              fontSize: '9px',
              fontWeight: 700,
              color: isAdmin ? '#eab308' : '#888',
              border: `1px solid ${isAdmin ? '#eab30866' : '#444'}`,
              borderRadius: '3px',
              padding: '0 4px',
            }}
          >
            {isAdmin
              ? t('emcomm.incident.roleAdmin', { defaultValue: 'ADMIN' })
              : t('emcomm.incident.roleOperator', { defaultValue: 'OPERATOR' })}
          </span>
        </span>
        <span style={{ color: '#888', fontSize: '10px' }}>
          <span data-testid="incident-participants">
            {t('emcomm.incident.participants', {
              count: incident.participants,
              defaultValue: '{{count}} connected',
            })}
          </span>
          {incident.pending > 0 && (
            <span data-testid="incident-pending" style={{ color: '#f59e0b', marginLeft: '6px' }}>
              {t('emcomm.incident.pending', { count: incident.pending, defaultValue: '{{count}} waiting to send' })}
            </span>
          )}
        </span>
      </div>
      {incident.error && <div style={{ color: '#ef4444' }}>{incident.error}</div>}

      {/* Incident board */}
      {boardDraft ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {[
            ['name', t('emcomm.incident.name', { defaultValue: 'Incident name' }), 80],
            ['ic', t('emcomm.incident.ic', { defaultValue: 'Incident commander' }), 80],
            ['netFreq', t('emcomm.incident.netFreq', { defaultValue: 'Net frequency' }), 40],
          ].map(([field, label, max]) => (
            <div key={field}>
              <div style={LABEL}>{label}</div>
              <input
                style={INPUT}
                name={`board-${field}`}
                value={boardDraft[field] || ''}
                maxLength={max}
                onChange={(e) => setBoardDraft((d) => ({ ...d, [field]: e.target.value }))}
              />
            </div>
          ))}
          <div style={LABEL}>{t('emcomm.incident.notes', { defaultValue: 'Notes' })}</div>
          <textarea
            style={{ ...INPUT, minHeight: '54px', resize: 'vertical', fontFamily: 'inherit' }}
            name="board-notes"
            value={boardDraft.notes || ''}
            maxLength={2000}
            onChange={(e) => setBoardDraft((d) => ({ ...d, notes: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <button
              type="button"
              style={BTN_PRIMARY}
              onClick={() => {
                incident.updateBoard(boardDraft);
                setBoardDraft(null);
              }}
            >
              {t('emcomm.incident.save', { defaultValue: 'Save' })}
            </button>
            <button type="button" style={BTN} onClick={() => setBoardDraft(null)}>
              {t('emcomm.incident.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      ) : (
        <div
          data-testid="incident-board"
          style={{ background: '#0d1117', borderLeft: '2px solid #38bdf8', borderRadius: '4px', padding: '4px 8px' }}
        >
          {board.name || board.ic || board.netFreq || board.notes ? (
            <>
              {board.name && <div style={{ color: '#ddd', fontWeight: 600 }}>{board.name}</div>}
              {(board.ic || board.netFreq) && (
                <div style={{ color: '#aaa', fontSize: '10px' }}>
                  {board.ic && <span>IC {board.ic}</span>}
                  {board.ic && board.netFreq && <span> · </span>}
                  {board.netFreq && <span style={MONO}>{board.netFreq}</span>}
                </div>
              )}
              {board.notes && (
                <div style={{ color: '#999', fontSize: '10px', marginTop: '2px', whiteSpace: 'pre-wrap' }}>
                  {board.notes}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#666', fontStyle: 'italic' }}>
              {t('emcomm.incident.noBoard', { defaultValue: 'No incident details yet.' })}
            </div>
          )}
        </div>
      )}

      {/* Manual check-in */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <input
          style={{ ...INPUT, width: '34%', minWidth: '80px', flex: '0 0 auto', ...MONO }}
          name="checkin-call"
          value={checkinCall}
          placeholder={t('emcomm.incident.checkinCall', { defaultValue: 'Callsign' })}
          maxLength={20}
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCheckinCall(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doCheckIn()}
        />
        <input
          style={{ ...INPUT, flex: 1, width: 'auto', minWidth: '100px' }}
          name="checkin-status"
          value={checkinStatus}
          placeholder={t('emcomm.incident.checkinStatus', { defaultValue: 'Status / resources' })}
          maxLength={80}
          onChange={(e) => setCheckinStatus(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doCheckIn()}
        />
        <button
          type="button"
          style={BTN_PRIMARY}
          onClick={doCheckIn}
          disabled={!checkinCall.trim()}
          title={t('emcomm.incident.checkinHint', {
            defaultValue: 'Voice or in-person check-in, straight into the shared roster.',
          })}
        >
          {t('emcomm.incident.checkIn', { defaultValue: 'Check in' })}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        {!boardDraft && isAdmin && (
          <button type="button" style={BTN} onClick={() => setBoardDraft({ ...board })}>
            {t('emcomm.incident.edit', { defaultValue: 'Edit' })}
          </button>
        )}
        <button type="button" style={BTN} onClick={() => setShowInvite((v) => !v)}>
          {t('emcomm.incident.invite', { defaultValue: 'Invite' })}
        </button>
        {isAdmin && (
          <button type="button" style={BTN} onClick={rotate}>
            {t('emcomm.incident.rotate', { defaultValue: 'New key' })}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" style={BTN_DANGER} onClick={leave}>
          {t('emcomm.incident.leave', { defaultValue: 'Leave' })}
        </button>
      </div>

      {showInvite && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '2px', flexWrap: 'wrap' }}>
          {incident.joinUrl ? (
            <QrCode
              text={incident.joinUrl}
              size={112}
              ariaLabel={t('emcomm.incident.invite', { defaultValue: 'Invite' })}
            />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
            <div style={LABEL}>{t('emcomm.incident.id', { defaultValue: 'Incident id' })}</div>
            <div style={{ color: '#ddd', ...MONO }}>{formatCode(s.id)}</div>
            <div style={LABEL}>{t('emcomm.incident.key', { defaultValue: 'Join key' })}</div>
            {s.joinKey ? (
              <div data-testid="incident-join-key" style={{ color: '#ddd', ...MONO, wordBreak: 'break-all' }}>
                {formatCode(s.joinKey)}
              </div>
            ) : (
              <div style={{ color: '#888', fontSize: '10px' }}>
                {t('emcomm.incident.joinKeyUnknown', {
                  defaultValue: 'Not known on this device. Press New key to make one to hand out.',
                })}
              </div>
            )}
            {incident.joinUrl && (
              <button type="button" style={{ ...BTN, marginTop: '4px', alignSelf: 'flex-start' }} onClick={copyLink}>
                {copied
                  ? t('emcomm.incident.copied', { defaultValue: 'Copied' })
                  : t('emcomm.incident.copyLink', { defaultValue: 'Copy link' })}
              </button>
            )}
            <div style={{ color: '#666', fontSize: '9px', lineHeight: 1.4 }}>
              {t('emcomm.incident.inviteHint', {
                defaultValue:
                  'Scan with a phone, or read the id and key over the air. Anyone with both can read and add to this incident.',
              })}
            </div>
            {isAdmin && (
              <div style={{ marginTop: '4px' }}>
                <button type="button" style={{ ...BTN, fontSize: '9px' }} onClick={() => setShowAdminKey((v) => !v)}>
                  {showAdminKey
                    ? t('emcomm.incident.hideAdminKey', { defaultValue: 'Hide admin key' })
                    : t('emcomm.incident.showAdminKey', { defaultValue: 'Show admin key' })}
                </button>
                {showAdminKey && (
                  <>
                    <div data-testid="incident-admin-key" style={{ color: '#eab308', ...MONO, marginTop: '2px' }}>
                      {formatCode(s.key)}
                    </div>
                    <div style={{ color: '#888', fontSize: '9px', lineHeight: 1.4 }}>
                      {t('emcomm.incident.adminKeyHint', {
                        defaultValue:
                          'The admin key can edit and delete entries, change the board and make a new join key. Keep it to yourself and a deputy; it is shown nowhere else.',
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
