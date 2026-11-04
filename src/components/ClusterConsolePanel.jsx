/**
 * ClusterConsolePanel — the raw text of your own telnet cluster session
 * (custom DX cluster source) with a one-line command input. Shows what the
 * node actually said: filter confirmations, sh/dx tables, talk/announce
 * traffic, WWV, login banners. Disabled with an explanation when the active
 * DX cluster source is not a telnet cluster.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useClusterConsole } from '../hooks/useClusterConsole.js';
import { CLUSTER_COMMAND_MAX_LENGTH, validateClusterCommand } from '../utils/clusterCommands.js';

const SOURCE_LABELS = {
  'dxspider-proxy': 'DX Spider Proxy',
  proxy: 'DX Spider Proxy',
  hamqth: 'HamQTH',
  dxwatch: 'DXWatch',
  auto: 'Auto',
  ohc: 'OpenHamClock Cluster',
  udp: 'UDP spots',
  dxspider: 'DX Spider direct',
  custom: 'Custom telnet',
};

export const ClusterConsolePanel = ({ config, isLocalInstall = true }) => {
  const { t } = useTranslation();
  const { available, lines, status, error, sending, send, clear, host, port } = useClusterConsole(config, {
    enabled: isLocalInstall,
  });
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState(null); // { ok, msg }
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const listRef = useRef(null);
  const pinnedRef = useRef(true); // auto-scroll unless the user scrolled up

  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    const v = validateClusterCommand(input);
    if (!v.ok) {
      setFeedback({ ok: false, msg: v.reason });
      return;
    }
    const r = await send(v.command);
    if (r.ok) {
      setFeedback(null);
      setHistory((h) => [v.command, ...h.filter((c) => c !== v.command)].slice(0, 20));
      setHistoryIdx(-1);
      setInput('');
      pinnedRef.current = true;
    } else {
      setFeedback({ ok: false, msg: r.error });
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = Math.min(history.length - 1, historyIdx + 1);
      setHistoryIdx(next);
      setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(-1, historyIdx - 1);
      setHistoryIdx(next);
      setInput(next === -1 ? '' : history[next]);
    }
  };

  const sourceName = SOURCE_LABELS[config?.dxClusterSource] || config?.dxClusterSource || '—';
  const stateColor =
    status.connected && status.authenticated
      ? 'var(--accent-green)'
      : status.parked
        ? 'var(--accent-red)'
        : 'var(--accent-amber)';
  const stateLabel = !status.exists
    ? t('clusterConsole.state.noSession', { defaultValue: 'no session' })
    : status.parked
      ? t('clusterConsole.state.parked', { defaultValue: 'parked' })
      : status.connected && status.authenticated
        ? t('clusterConsole.state.connected', { defaultValue: 'connected' })
        : status.connected
          ? t('clusterConsole.state.loggingIn', { defaultValue: 'logging in' })
          : t('clusterConsole.state.reconnecting', { defaultValue: 'reconnecting' });

  const inputOk = input.trim() === '' || validateClusterCommand(input).ok;
  const canSend = available && status.connected && status.authenticated && !sending;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        className="panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
          fontSize: '12px',
          fontWeight: '700',
          color: 'var(--accent-green)',
        }}
      >
        <span>
          {t('clusterConsole.title', { defaultValue: 'CLUSTER CONSOLE' })}{' '}
          {available && (
            <span style={{ color: stateColor, fontSize: '10px', fontWeight: '600' }} aria-live="polite">
              ● {stateLabel}
            </span>
          )}
        </span>
        {available && (
          <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {host}:{port}
            </span>
            <button
              type="button"
              onClick={clear}
              title={t('clusterConsole.clear', { defaultValue: 'Clear console' })}
              aria-label={t('clusterConsole.clear', { defaultValue: 'Clear console' })}
              style={{
                background: 'rgba(100, 100, 100, 0.3)',
                border: '1px solid #666',
                color: '#888',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              CLR
            </button>
          </span>
        )}
      </div>

      {!available ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '16px',
            color: 'var(--text-muted)',
            fontSize: '12px',
            lineHeight: 1.5,
          }}
        >
          {!isLocalInstall
            ? t('clusterConsole.hosted', {
                defaultValue:
                  'The hosted site has no telnet cluster sessions. Run your own OpenHamClock with a custom telnet cluster to use the console.',
              })
            : t('clusterConsole.notTelnet', {
                defaultValue:
                  'The console shows your own telnet cluster session. The active DX cluster source is "{{source}}" — choose Custom Telnet Server in Settings → Station and set a host to enable it.',
                source: sourceName,
              })}
        </div>
      ) : (
        <>
          <div
            ref={listRef}
            onScroll={onScroll}
            role="log"
            aria-label={t('clusterConsole.logLabel', { defaultValue: 'Cluster session output' })}
            aria-live="off"
            tabIndex={0}
            style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '6px 8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              lineHeight: 1.35,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {error && (
              <div style={{ color: 'var(--accent-red)', marginBottom: '4px' }} role="alert">
                {error}
              </div>
            )}
            {lines.length === 0 && !error && (
              <div style={{ color: 'var(--text-muted)' }}>
                {status.exists
                  ? t('clusterConsole.waiting', { defaultValue: 'Waiting for text from the node…' })
                  : t('clusterConsole.noSessionHelp', {
                      defaultValue:
                        'No session yet — the DX Cluster panel opens the telnet connection; keep it in your layout.',
                    })}
              </div>
            )}
            {lines.map((l) => (
              <div
                key={l.seq}
                style={{
                  color: l.dir === 'tx' ? 'var(--accent-cyan)' : 'var(--text-primary)',
                  opacity: l.text ? 1 : 0.4,
                }}
              >
                {l.dir === 'tx' ? '> ' : ''}
                {l.text || ' '}
              </div>
            ))}
          </div>
          <form onSubmit={submit} style={{ display: 'flex', gap: '4px', marginTop: '6px', alignItems: 'center' }}>
            <label htmlFor="cluster-console-input" className="visually-hidden">
              {t('clusterConsole.inputLabel', { defaultValue: 'Cluster command' })}
            </label>
            <input
              id="cluster-console-input"
              type="text"
              value={input}
              maxLength={CLUSTER_COMMAND_MAX_LENGTH}
              onChange={(e) => {
                setInput(e.target.value);
                if (feedback) setFeedback(null);
              }}
              onKeyDown={onKeyDown}
              placeholder={t('clusterConsole.placeholder', { defaultValue: 'sh/dx 10, set/filter dxbm/pass 20,15 …' })}
              spellCheck={false}
              autoComplete="off"
              style={{
                flex: 1,
                padding: '4px 8px',
                background: 'var(--bg-secondary)',
                border: `1px solid ${inputOk ? 'var(--border-color)' : 'var(--accent-red)'}`,
                borderRadius: '3px',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <button
              type="submit"
              disabled={!canSend || !input.trim() || !inputOk}
              title={
                canSend
                  ? t('clusterConsole.send', { defaultValue: 'Send command (1 per second)' })
                  : t('clusterConsole.sendDisabled', { defaultValue: 'Session not connected' })
              }
              aria-label={t('clusterConsole.send', { defaultValue: 'Send command' })}
              style={{
                background: canSend ? 'rgba(0, 255, 136, 0.2)' : 'rgba(100,100,100,0.2)',
                border: `1px solid ${canSend ? 'var(--accent-green)' : '#555'}`,
                color: canSend ? 'var(--accent-green)' : '#666',
                padding: '3px 10px',
                borderRadius: '3px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                cursor: canSend ? 'pointer' : 'not-allowed',
              }}
            >
              {sending ? '…' : t('clusterConsole.sendButton', { defaultValue: 'Send' })}
            </button>
          </form>
          {feedback && (
            <div
              role="status"
              style={{
                fontSize: '10px',
                marginTop: '3px',
                color: feedback.ok ? 'var(--accent-green)' : 'var(--accent-red)',
              }}
            >
              {feedback.msg}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ClusterConsolePanel;
