/**
 * NbemsPanel — fldigi status, receive text and send box for the EmComm
 * layout, plus a compact ICS-213 form that goes out through fldigi as an
 * flmsg transfer. Everything comes from the Rig Bridge fldigi plugin via
 * useFldigi; received flmsg forms land in the Field Reports panel.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFldigi } from '../hooks/useFldigi.js';

const box = {
  background: '#0d1117',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '11px',
  marginBottom: '4px',
};
const input = {
  background: '#0a0e14',
  border: '1px solid #2a3040',
  borderRadius: '3px',
  color: '#ddd',
  fontSize: '11px',
  padding: '3px 5px',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
const btn = {
  background: '#1a1f2e',
  border: '1px solid #2a3040',
  borderRadius: '3px',
  color: '#ccc',
  fontSize: '10px',
  padding: '3px 8px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const ACCENT = '#38bdf8';

const EMPTY_ICS = { to: '', from: '', subject: '', message: '' };

export default function NbemsPanel({ apiToken = '' }) {
  const { t } = useTranslation();
  const { status, connected, running, rxText, lastForm, viaRelay, sendText, sendIcs213, setMode, abort } = useFldigi({
    apiToken,
  });
  const [text, setText] = useState('');
  const [showIcs, setShowIcs] = useState(false);
  const [ics, setIcs] = useState(EMPTY_ICS);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, msg }
  const rxRef = useRef(null);

  // Keep the receive pane scrolled to the newest text
  useEffect(() => {
    if (rxRef.current) rxRef.current.scrollTop = rxRef.current.scrollHeight;
  }, [rxText]);

  // Opening the ICS-213 form grows the panel downward; bring the whole form,
  // Send button included, into view in the scrolling sidebar (#1261).
  const icsRef = useRef(null);
  useEffect(() => {
    if (showIcs) icsRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [showIcs]);

  const describeError = (r) => {
    if (r.error === 'relay' || r.error === 'relay-inactive')
      return t('nbems.errRelay', { defaultValue: 'Cloud relay is not connected to Rig Bridge' });
    if (r.error === 'relay-unsigned' || (r.status === 401 && viaRelay))
      return t('nbems.errRelayUnsigned', {
        defaultValue: 'Rig Bridge refused an unsigned command — reconnect the Cloud Relay in Settings → Rig Bridge',
      });
    if (r.error === 'relay-timeout')
      return t('nbems.errRelayTimeout', { defaultValue: 'No answer from Rig Bridge through the cloud relay' });
    if (r.status === 401)
      return t('nbems.errToken', { defaultValue: 'Rig Bridge rejected the API token (Settings → Rig Bridge)' });
    if (r.error === 'unreachable' || r.error === 'timeout')
      return t('nbems.errUnreachable', { defaultValue: 'Rig Bridge not reachable' });
    return r.error || t('nbems.errGeneric', { defaultValue: 'Send failed' });
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    setNotice(null);
    const r = await fn();
    setBusy(false);
    setNotice(r.ok ? { ok: true, msg: okMsg } : { ok: false, msg: describeError(r) });
    return r.ok;
  };

  const onSend = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(() => sendText(text), t('nbems.queued', { defaultValue: 'Queued for transmit' }))) setText('');
  };

  const onSendIcs = async (e) => {
    e.preventDefault();
    if (!ics.subject.trim() && !ics.message.trim()) return;
    let folded = false;
    const ok = await run(
      async () => {
        const r = await sendIcs213(ics);
        folded = !!r.folded;
        return r;
      },
      t('nbems.icsQueued', { defaultValue: 'ICS-213 queued for transmit' }),
    );
    if (ok && folded) {
      setNotice({
        ok: true,
        msg: t('nbems.icsQueuedFolded', {
          defaultValue: 'ICS-213 queued; accented and special characters were sent as plain letters',
        }),
      });
    }
    if (ok) {
      setIcs(EMPTY_ICS);
      setShowIcs(false);
    }
  };

  const transmitting = status?.trx === 'tx' || status?.trx === 'tune';
  const freqMHz = status?.freq ? (status.freq / 1e6).toFixed(3) : null;
  const modes = Array.isArray(status?.modes) ? status.modes : [];
  const canSend = connected && !busy;

  if (!running && !status) {
    return (
      <div style={{ padding: '10px 8px', color: '#555', fontSize: '11px', lineHeight: 1.5 }}>
        {viaRelay
          ? t('nbems.relayHint', {
              defaultValue:
                'Waiting for fldigi through the cloud relay. Enable the fldigi + flmsg plugin and Cloud Relay in Rig Bridge.',
            })
          : t('nbems.setupHint', {
              defaultValue:
                'Enable the fldigi + flmsg plugin in Rig Bridge to see fldigi here and get flmsg forms in Field Reports.',
            })}
      </div>
    );
  }

  return (
    <div>
      {/* Status line */}
      <div style={{ ...box, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span
          aria-hidden="true"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: transmitting ? '#ef4444' : connected ? '#22c55e' : '#555',
            flexShrink: 0,
          }}
        />
        <span style={{ color: ACCENT, fontWeight: 600 }}>fldigi</span>
        {connected ? (
          <>
            {modes.length > 0 ? (
              <select
                aria-label={t('nbems.modeLabel', { defaultValue: 'fldigi mode' })}
                value={status?.mode || ''}
                disabled={!canSend}
                onChange={(e) =>
                  run(
                    () => setMode(e.target.value),
                    t('nbems.modeChanged', { defaultValue: 'Mode set to {{mode}}', mode: e.target.value }),
                  )
                }
                style={{ ...input, width: 'auto', padding: '1px 3px', fontFamily: 'var(--font-mono)' }}
              >
                {!modes.includes(status?.mode) && status?.mode && <option value={status.mode}>{status.mode}</option>}
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{status?.mode}</span>
            )}
            {freqMHz && (
              <span style={{ color: '#ddd', fontFamily: 'var(--font-mono)' }}>
                {freqMHz} {t('nbems.mhz', { defaultValue: 'MHz' })}
              </span>
            )}
            {Number.isFinite(status?.carrier) && status.carrier > 0 && (
              <span style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>@{status.carrier} Hz</span>
            )}
            {transmitting && (
              <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '10px' }}>
                {t('nbems.tx', { defaultValue: 'TX' })}
              </span>
            )}
            {status?.txQueued > 0 && (
              <span style={{ color: '#888', fontSize: '10px' }}>
                {t('nbems.queuedCount', { defaultValue: '+{{count}} queued', count: status.txQueued })}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: '#888' }}>{t('nbems.disconnected', { defaultValue: 'not connected' })}</span>
        )}
        {(status?.txActive || transmitting) && (
          <button
            type="button"
            style={{ ...btn, marginLeft: 'auto', color: '#ef4444', borderColor: '#7f1d1d' }}
            onClick={() => run(abort, t('nbems.aborted', { defaultValue: 'Transmit stopped' }))}
          >
            {t('nbems.stopTx', { defaultValue: 'Stop TX' })}
          </button>
        )}
      </div>

      {status?.stationCall === '' && (
        <div
          role="alert"
          style={{ ...box, color: '#f59e0b', border: '1px solid #78350f', fontSize: '10px', lineHeight: 1.4 }}
        >
          {t('nbems.noCallsign', {
            defaultValue:
              'No station callsign in Rig Bridge (fldigi plugin) or in flmsg. Forms saved in flmsg that were sent by a station cannot be told apart from your own, so they appear in Field Reports tagged ORIGIN?. Set your callsign to fix this.',
          })}
        </div>
      )}

      {/* Receive pane */}
      <pre
        ref={rxRef}
        aria-label={t('nbems.rxLabel', { defaultValue: 'fldigi receive text' })}
        style={{
          ...box,
          margin: '0 0 4px',
          height: '90px',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#9ca3af',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
        }}
      >
        {rxText ? rxText.slice(-1500) : t('nbems.rxEmpty', { defaultValue: 'No receive text yet.' })}
      </pre>

      {/* Send box */}
      <form onSubmit={onSend} style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
        <input
          type="text"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('nbems.sendPlaceholder', { defaultValue: 'Text to transmit…' })}
          aria-label={t('nbems.sendLabel', { defaultValue: 'Text to transmit through fldigi' })}
          disabled={!connected}
          style={input}
        />
        <button type="submit" style={btn} disabled={!canSend || !text.trim()}>
          {t('nbems.send', { defaultValue: 'Send' })}
        </button>
        <button
          type="button"
          style={{ ...btn, color: showIcs ? ACCENT : btn.color }}
          onClick={() => setShowIcs((v) => !v)}
          aria-expanded={showIcs}
          disabled={!connected}
        >
          {t('nbems.icsButton', { defaultValue: 'ICS-213' })}
        </button>
      </form>

      {showIcs && (
        <form ref={icsRef} onSubmit={onSendIcs} style={{ ...box, display: 'grid', gap: '4px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            <input
              style={input}
              value={ics.to}
              maxLength={200}
              onChange={(e) => setIcs({ ...ics, to: e.target.value })}
              placeholder={t('nbems.icsTo', { defaultValue: 'To (name / position)' })}
              aria-label={t('nbems.icsTo', { defaultValue: 'To (name / position)' })}
            />
            <input
              style={input}
              value={ics.from}
              maxLength={200}
              onChange={(e) => setIcs({ ...ics, from: e.target.value })}
              placeholder={t('nbems.icsFrom', { defaultValue: 'From (name / position)' })}
              aria-label={t('nbems.icsFrom', { defaultValue: 'From (name / position)' })}
            />
          </div>
          <input
            style={input}
            value={ics.subject}
            maxLength={200}
            onChange={(e) => setIcs({ ...ics, subject: e.target.value })}
            placeholder={t('nbems.icsSubject', { defaultValue: 'Subject' })}
            aria-label={t('nbems.icsSubject', { defaultValue: 'Subject' })}
          />
          <textarea
            style={{ ...input, resize: 'vertical', minHeight: '54px' }}
            value={ics.message}
            maxLength={4000}
            onChange={(e) => setIcs({ ...ics, message: e.target.value })}
            placeholder={t('nbems.icsMessage', { defaultValue: 'Message' })}
            aria-label={t('nbems.icsMessage', { defaultValue: 'Message' })}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#666', fontSize: '9px' }}>
              {t('nbems.icsHint', {
                defaultValue: 'Sent as an flmsg ICS-213 (dated now, UTC) in the current fldigi mode.',
              })}
            </span>
            <button
              type="submit"
              style={{ ...btn, color: ACCENT }}
              disabled={!canSend || (!ics.subject.trim() && !ics.message.trim())}
            >
              {t('nbems.icsSend', { defaultValue: 'Send ICS-213' })}
            </button>
          </div>
        </form>
      )}

      {notice && (
        <div role="status" style={{ fontSize: '10px', color: notice.ok ? '#22c55e' : '#ef4444', padding: '0 2px 4px' }}>
          {notice.msg}
        </div>
      )}
      {status?.lastTxError && (
        <div style={{ fontSize: '10px', color: '#f59e0b', padding: '0 2px 4px' }}>{status.lastTxError}</div>
      )}
      {lastForm && (
        <div style={{ fontSize: '10px', color: '#888', padding: '0 2px' }}>
          {t('nbems.lastForm', {
            defaultValue: 'Last form: {{type}} from {{call}}',
            type: lastForm.formType || 'flmsg',
            call: lastForm.callsign || '?',
          })}
        </div>
      )}
    </div>
  );
}
