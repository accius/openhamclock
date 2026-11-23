/**
 * DigitalModesPanel Component
 * Unified monitoring and control panel for digital mode plugins:
 * MSHV, JTDX, JS8Call (all built on digital-mode-base).
 *
 * Shows connection status, frequency/mode, TX state, and provides
 * control actions (halt TX, send free text) for each connected app.
 */
import { useState, useCallback } from 'react';
import { useDigitalModes } from '../hooks/useDigitalModes';
import { useRigOptional } from '../contexts/RigContext.jsx';
import { directRigUrl } from '../utils/aprsMessageSend.js';

const PLUGIN_LABELS = {
  mshv: 'MSHV',
  jtdx: 'JTDX',
  js8call: 'JS8Call',
};

const formatFreq = (hz) => {
  if (!hz) return '--';
  const mhz = hz / 1e6;
  return `${mhz.toFixed(6)} MHz`;
};

const DigitalModesPanel = ({ apiToken = '' } = {}) => {
  // Local installs: the plugin routes live only on Rig Bridge (#1279)
  const rigUrl = directRigUrl(useRigOptional());
  const { statuses, loading, plugins, haltTx, sendFreeText } = useDigitalModes({ rigUrl, apiToken });
  const [freeTextInputs, setFreeTextInputs] = useState({});
  const [expandedPlugin, setExpandedPlugin] = useState(null);
  const [actionFeedback, setActionFeedback] = useState({});

  const connectedCount = plugins.filter((id) => statuses[id]?.connected).length;
  const enabledCount = plugins.filter((id) => statuses[id]?.enabled).length;

  const showFeedback = useCallback((pluginId, message, isError = false) => {
    setActionFeedback((prev) => ({ ...prev, [pluginId]: { message, isError } }));
    setTimeout(() => setActionFeedback((prev) => ({ ...prev, [pluginId]: null })), 3000);
  }, []);

  const handleHalt = useCallback(
    async (pluginId) => {
      const result = await haltTx(pluginId);
      if (result.error) showFeedback(pluginId, result.error, true);
      else showFeedback(pluginId, 'TX halted');
    },
    [haltTx, showFeedback],
  );

  const handleSendFreeText = useCallback(
    async (pluginId) => {
      const text = freeTextInputs[pluginId]?.trim();
      if (!text) return;
      const result = await sendFreeText(pluginId, text);
      if (result.error) showFeedback(pluginId, result.error, true);
      else {
        showFeedback(pluginId, 'Sent');
        setFreeTextInputs((prev) => ({ ...prev, [pluginId]: '' }));
      }
    },
    [freeTextInputs, sendFreeText, showFeedback],
  );

  if (loading) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
        Loading...
      </div>
    );
  }

  if (enabledCount === 0) {
    return (
      <div
        className="panel"
        style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}
      >
        <div style={{ fontSize: '24px', marginBottom: '10px' }}>📻</div>
        <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
          No Digital Modes Enabled
        </div>
        <div>Enable MSHV, JTDX, or JS8Call in your rig-bridge config to use this panel.</div>
        <div style={{ marginTop: '10px', fontSize: '11px' }}>
          Example:{' '}
          <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>
            mshv.enabled: true
          </code>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: '12px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>📻</span>
          <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>Digital Modes</span>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connectedCount > 0 ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {connectedCount}/{enabledCount}
          </span>
        </div>
      </div>

      {/* Plugin list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
        {plugins.map((id) => {
          const s = statuses[id] || {};
          if (!s.enabled) return null;

          const isExpanded = expandedPlugin === id;
          const feedback = actionFeedback[id];

          return (
            <div
              key={id}
              style={{
                marginBottom: '4px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                overflow: 'hidden',
              }}
            >
              {/* Plugin header row */}
              <div
                onClick={() => setExpandedPlugin(isExpanded ? null : id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: s.connected ? '#22c55e' : s.running ? '#f59e0b' : '#ef4444',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '13px' }}>
                    {PLUGIN_LABELS[id] || id}
                  </span>
                  {s.connected && s.appId && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{s.appId}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {s.transmitting && (
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '3px',
                        background: '#ef4444',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: '700',
                      }}
                    >
                      TX
                    </span>
                  )}
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                    {isExpanded ? '\u25B2' : '\u25BC'}
                  </span>
                </div>
              </div>

              {/* Status row (always visible when connected) */}
              {s.connected && (
                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    padding: '0 10px 6px',
                    fontSize: '11px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Freq: </span>
                    <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                      {formatFreq(s.lastFrequency)}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Mode: </span>
                    <span style={{ color: 'var(--accent-amber)' }}>{s.lastMode || '--'}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Decodes: </span>
                    <span style={{ color: 'var(--text-primary)' }}>{s.decodeCount || 0}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Port: </span>
                    <span style={{ color: 'var(--text-secondary)' }}>{s.udpPort}</span>
                  </div>
                </div>
              )}

              {/* Not connected message */}
              {!s.connected && s.running && (
                <div style={{ padding: '0 10px 6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Listening on UDP {s.udpPort} — waiting for {PLUGIN_LABELS[id]}...
                </div>
              )}

              {/* Expanded controls */}
              {isExpanded && s.connected && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderTop: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                  }}
                >
                  {/* Action feedback */}
                  {feedback && (
                    <div
                      style={{
                        padding: '4px 8px',
                        marginBottom: '6px',
                        borderRadius: '3px',
                        fontSize: '11px',
                        background: feedback.isError ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                        color: feedback.isError ? '#ef4444' : '#22c55e',
                      }}
                    >
                      {feedback.message}
                    </div>
                  )}

                  {/* Halt TX button */}
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                    <button
                      onClick={() => handleHalt(id)}
                      style={{
                        padding: '5px 12px',
                        fontSize: '11px',
                        background: '#ef4444',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: '600',
                      }}
                    >
                      Halt TX
                    </button>
                  </div>

                  {/* Free text input */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      value={freeTextInputs[id] || ''}
                      onChange={(e) => setFreeTextInputs((prev) => ({ ...prev, [id]: e.target.value.toUpperCase() }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendFreeText(id)}
                      placeholder="Free text message..."
                      style={{
                        flex: 1,
                        padding: '5px 8px',
                        fontSize: '11px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '3px',
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                    <button
                      onClick={() => handleSendFreeText(id)}
                      disabled={!freeTextInputs[id]?.trim()}
                      style={{
                        padding: '5px 12px',
                        fontSize: '11px',
                        background: freeTextInputs[id]?.trim() ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                        border: 'none',
                        borderRadius: '3px',
                        color: freeTextInputs[id]?.trim() ? '#000' : 'var(--text-muted)',
                        cursor: freeTextInputs[id]?.trim() ? 'pointer' : 'default',
                        fontFamily: 'inherit',
                        fontWeight: '600',
                      }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DigitalModesPanel;
