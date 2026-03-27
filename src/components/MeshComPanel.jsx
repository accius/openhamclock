/**
 * MeshComPanel Component
 * Displays MeshCom mesh nodes, messages and weather/telemetry data
 * received via the rig-bridge UDP plugin on port 1799.
 *
 * Three tabs: Nodes | Messages | Info
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshCom } from '../hooks/useMeshCom.js';
import CallsignLink from './CallsignLink.jsx';
import { primaryCall } from '../utils/callsign.js';
import { IconMap } from './Icons.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAge(ageMin) {
  if (ageMin < 1) return 'now';
  if (ageMin < 60) return `${ageMin}m`;
  return `${Math.floor(ageMin / 60)}h`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function BatteryBar({ batt }) {
  if (batt == null) return null;
  const pct = Math.max(0, Math.min(100, Math.round(batt)));
  const color = pct < 20 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#22c55e';
  return (
    <span
      title={`Battery: ${pct}%`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        fontSize: '10px',
        color: 'var(--text-muted)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '22px',
          height: '8px',
          border: '1px solid var(--border-color)',
          borderRadius: '2px',
          overflow: 'hidden',
          background: 'var(--bg-tertiary)',
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: color,
            borderRadius: '1px',
          }}
        />
      </span>
      {pct}%
    </span>
  );
}

function WeatherRow({ wx }) {
  if (!wx) return null;
  const parts = [];
  if (wx.tempC != null) parts.push(`${wx.tempC.toFixed(1)}°C`);
  if (wx.humidity != null) parts.push(`${Math.round(wx.humidity)}%`);
  if (wx.pressureHpa != null) parts.push(`${Math.round(wx.pressureHpa)}hPa`);
  if (wx.co2ppm != null) parts.push(`${Math.round(wx.co2ppm)}ppm CO₂`);
  if (parts.length === 0) return null;
  return <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{parts.join(' · ')}</div>;
}

// ── Tab: Nodes ────────────────────────────────────────────────────────────────

function NodesTab({ nodes, loading, onSpotClick, onHoverSpot }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
        {t('meshcomPanel.loading')}
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
        {t('meshcomPanel.noNodes')}
        <div style={{ fontSize: '11px', marginTop: '8px' }}>{t('meshcomPanel.noNodesHint')}</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
      {nodes.map((node, i) => {
        const hasPos = node.lat != null && node.lon != null;
        const isAged = (node.ageMin ?? 0) > 30;
        return (
          <div
            key={`${node.call}-${i}`}
            onMouseEnter={() => hasPos && onHoverSpot?.({ call: primaryCall(node.call), lat: node.lat, lon: node.lon })}
            onMouseLeave={() => onHoverSpot?.(null)}
            onClick={() => hasPos && onSpotClick?.({ call: primaryCall(node.call), lat: node.lat, lon: node.lon })}
            style={{
              padding: '5px 6px',
              borderRadius: '3px',
              marginBottom: '2px',
              background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
              cursor: hasPos ? 'pointer' : 'default',
              transition: 'background 0.15s',
              borderLeft: `2px solid ${isAged ? 'var(--border-color)' : '#2dd4bf'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <CallsignLink call={primaryCall(node.call)} color="var(--text-primary)" fontWeight="700" />
                {!hasPos && (
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {t('meshcomPanel.noPosition')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatAge(node.ageMin ?? 0)}</span>
                <BatteryBar batt={node.batt} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '1px' }}>
              {node.alt != null && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{Math.round(node.alt)}m</span>
              )}
              {node.weather?.rssi != null && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  RSSI {Math.round(node.weather.rssi)}
                </span>
              )}
              {node.weather?.snr != null && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>SNR {node.weather.snr.toFixed(1)}</span>
              )}
            </div>
            <WeatherRow wx={node.weather} />
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Messages ─────────────────────────────────────────────────────────────

function MessagesTab({ messages, nodes, sendMessage }) {
  const { t } = useTranslation();
  const [toField, setToField] = useState('*');
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [selectedMsg, setSelectedMsg] = useState(null); // message being replied to
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!msgText.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(toField || '*', msgText.trim());
      setMsgText('');
      setSelectedMsg(null);
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  }, [msgText, toField, sendMessage, sending]);

  const handleSelectMsg = useCallback((msg) => {
    setSelectedMsg((prev) => (prev === msg ? null : msg));
  }, []);

  // Activate a reply target — set To: field and focus the input
  const handleReplyTarget = useCallback((target) => {
    setToField(target);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleCancelReply = useCallback(() => {
    setSelectedMsg(null);
    setToField('*');
  }, []);

  const nodeCalls = nodes.map((n) => primaryCall(n.call));

  // Ensure the reply-to sender appears in the dropdown even if not a known node
  const dropdownCalls = selectedMsg ? [...new Set([...nodeCalls, primaryCall(selectedMsg.src)])] : nodeCalls;

  // Determine the "group/broadcast" reply target for a given message
  const groupTarget = (msg) => {
    if (!msg) return '*';
    const { dst } = msg;
    // Groups 0–5 or broadcast: reply to same destination
    if (dst === '*' || (dst >= '0' && dst <= '5')) return dst;
    // Direct message: reply direct to sender
    return primaryCall(msg.src);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message list */}
      <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
            {t('meshcomPanel.noMessages')}
          </div>
        ) : (
          [...messages].reverse().map((msg, i) => {
            const isSelected = selectedMsg === msg;
            const src = primaryCall(msg.src);
            const isDirect = msg.dst && msg.dst !== '*' && (msg.dst < '0' || msg.dst > '5');
            const gTarget = groupTarget(msg);

            return (
              <div
                key={i}
                onClick={() => handleSelectMsg(msg)}
                style={{
                  padding: '4px 0 4px 4px',
                  borderBottom: '1px solid var(--border-color)',
                  borderLeft: isSelected ? '2px solid #8B1A2A' : '2px solid transparent',
                  fontSize: '11px',
                  cursor: 'pointer',
                  background: isSelected ? 'rgba(139,26,42,0.07)' : 'transparent',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>
                    <span
                      style={{
                        fontWeight: '700',
                        color: 'var(--accent-cyan)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {src}
                    </span>
                    {msg.dst && msg.dst !== '*' && (
                      <span style={{ color: 'var(--text-muted)' }}> → {primaryCall(msg.dst)}</span>
                    )}
                    {msg.dst === '*' && <span style={{ color: 'var(--text-muted)' }}> → ALL</span>}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatTime(msg.timestamp)}</span>
                </div>
                <div style={{ color: 'var(--text-primary)', marginTop: '2px' }}>{msg.text}</div>

                {/* Inline reply buttons — only shown on selected message */}
                {isSelected && (
                  <div style={{ display: 'flex', gap: '4px', marginTop: '5px', flexWrap: 'wrap' }}>
                    {/* Group / broadcast reply */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReplyTarget(gTarget);
                      }}
                      style={{
                        padding: '2px 7px',
                        fontSize: '10px',
                        background: 'rgba(139,26,42,0.12)',
                        border: '1px solid #8B1A2A',
                        borderRadius: '3px',
                        color: '#c0394e',
                        cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {gTarget === '*'
                        ? t('meshcomPanel.replyToBroadcast')
                        : gTarget >= '0' && gTarget <= '5'
                          ? t('meshcomPanel.replyToGroup', { n: gTarget })
                          : t('meshcomPanel.replyToDirect', { call: gTarget })}
                    </button>

                    {/* Direct reply to sender — only show when group/broadcast target differs from sender */}
                    {gTarget !== src && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReplyTarget(src);
                        }}
                        style={{
                          padding: '2px 7px',
                          fontSize: '10px',
                          background: 'rgba(139,26,42,0.12)',
                          border: '1px solid #8B1A2A',
                          borderRadius: '3px',
                          color: '#c0394e',
                          cursor: 'pointer',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {t('meshcomPanel.replyToDirect', { call: src })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* "Replying to" context strip */}
      {selectedMsg && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 8px',
            background: 'rgba(139,26,42,0.1)',
            borderTop: '1px solid rgba(139,26,42,0.3)',
            fontSize: '10px',
            color: '#c0394e',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          <span>{t('meshcomPanel.replyingTo', { call: primaryCall(selectedMsg.src) })}</span>
          <button
            onClick={handleCancelReply}
            title={t('meshcomPanel.replyCancel')}
            style={{
              background: 'none',
              border: 'none',
              color: '#c0394e',
              cursor: 'pointer',
              fontSize: '12px',
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Send form */}
      <div
        style={{
          padding: '6px 8px',
          borderTop: selectedMsg ? 'none' : '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {t('meshcomPanel.sendTo')}
          </span>
          <select
            value={toField}
            onChange={(e) => setToField(e.target.value)}
            style={{
              flex: 1,
              padding: '3px 4px',
              fontSize: '11px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
            }}
          >
            <option value="*">{t('meshcomPanel.sendBroadcast')}</option>
            {[0, 1, 2, 3, 4, 5].map((g) => (
              <option key={g} value={String(g)}>
                {t('meshcomPanel.sendGroup', { n: g })}
              </option>
            ))}
            {dropdownCalls.map((call) => (
              <option key={call} value={call}>
                {call}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            ref={inputRef}
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={t('meshcomPanel.messagePlaceholder')}
            maxLength={150}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '11px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!msgText.trim() || sending}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: msgText.trim() && !sending ? '#8B1A2A' : 'var(--bg-tertiary)',
              border: 'none',
              borderRadius: '3px',
              color: msgText.trim() && !sending ? '#fff' : 'var(--text-muted)',
              cursor: msgText.trim() && !sending ? 'pointer' : 'default',
              fontFamily: 'inherit',
              fontWeight: '600',
              whiteSpace: 'nowrap',
            }}
          >
            {sending ? '…' : t('meshcomPanel.sendButton')}
          </button>
        </div>
        {sendError && <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '4px' }}>{sendError}</div>}
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', textAlign: 'right' }}>
          {msgText.length}/150
        </div>
      </div>
    </div>
  );
}

// ── Tab: Info ─────────────────────────────────────────────────────────────────

function InfoTab({ connected, nodes, messages }) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '12px', fontSize: '12px' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          {t('meshcomPanel.infoStatus')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#6b7280',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          {connected ? t('meshcomPanel.infoActive') : t('meshcomPanel.infoInactive')}
        </div>
        <div style={{ marginTop: '6px', color: 'var(--text-muted)' }}>
          {t('meshcomPanel.infoStats', { nodes: nodes.length, messages: messages.length })}
        </div>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          {t('meshcomPanel.infoSetup')}
        </div>
        <div style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}>
          {t('meshcomPanel.infoSetupRigbridge')}
          <pre
            style={{
              background: 'var(--bg-tertiary)',
              padding: '6px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              marginTop: '4px',
              overflowX: 'auto',
            }}
          >
            {`"meshcom": {\n  "enabled": true,\n  "bindPort": 1799\n}`}
          </pre>
          {t('meshcomPanel.infoSetupNode')}
          <pre
            style={{
              background: 'var(--bg-tertiary)',
              padding: '6px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              marginTop: '4px',
            }}
          >
            {`--extudp on\n--extudpip 255.255.255.255`}
          </pre>
        </div>
      </div>
      <div>
        <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
          {t('meshcomPanel.infoAbout')}
        </div>
        <div style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}>{t('meshcomPanel.infoAboutText')}</div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TAB_IDS = ['nodes', 'messages', 'info'];

const MeshComPanel = ({ showOnMap, onToggleMap, onSpotClick, onHoverSpot }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('nodes');
  const { nodes, messages, connected, loading, sendMessage } = useMeshCom();

  const tabLabels = {
    nodes: t('meshcomPanel.tabNodes'),
    messages: t('meshcomPanel.tabMessages'),
    info: t('meshcomPanel.tabInfo'),
  };

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
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* MeshCom logo — mesh network: centre node + 6 outer nodes + ring, brand crimson */}
          <svg width="18" height="18" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            {/* outer ring */}
            <line x1="11" y1="3.5" x2="17.5" y2="7.25" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="17.5" y1="7.25" x2="17.5" y2="14.75" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="17.5" y1="14.75" x2="11" y2="18.5" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="11" y1="18.5" x2="4.5" y2="14.75" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="4.5" y1="14.75" x2="4.5" y2="7.25" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="4.5" y1="7.25" x2="11" y2="3.5" stroke="#8B1A2A" strokeWidth="1.3" />
            {/* spokes */}
            <line x1="11" y1="11" x2="11" y2="3.5" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="11" y1="11" x2="17.5" y2="7.25" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="11" y1="11" x2="17.5" y2="14.75" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="11" y1="11" x2="11" y2="18.5" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="11" y1="11" x2="4.5" y2="14.75" stroke="#8B1A2A" strokeWidth="1.3" />
            <line x1="11" y1="11" x2="4.5" y2="7.25" stroke="#8B1A2A" strokeWidth="1.3" />
            {/* outer open nodes (drawn after lines so they sit on top) */}
            <circle cx="11" cy="3.5" r="2" fill="var(--bg-panel,#1a1a2e)" stroke="#8B1A2A" strokeWidth="1.3" />
            <circle cx="17.5" cy="7.25" r="2" fill="var(--bg-panel,#1a1a2e)" stroke="#8B1A2A" strokeWidth="1.3" />
            <circle cx="17.5" cy="14.75" r="2" fill="var(--bg-panel,#1a1a2e)" stroke="#8B1A2A" strokeWidth="1.3" />
            <circle cx="11" cy="18.5" r="2" fill="var(--bg-panel,#1a1a2e)" stroke="#8B1A2A" strokeWidth="1.3" />
            <circle cx="4.5" cy="14.75" r="2" fill="var(--bg-panel,#1a1a2e)" stroke="#8B1A2A" strokeWidth="1.3" />
            <circle cx="4.5" cy="7.25" r="2" fill="var(--bg-panel,#1a1a2e)" stroke="#8B1A2A" strokeWidth="1.3" />
            {/* central filled node */}
            <circle cx="11" cy="11" r="3.5" fill="#8B1A2A" />
          </svg>
          <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{t('meshcomPanel.title')}</span>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#6b7280',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {t('meshcomPanel.nodeCount', { count: nodes.length })}
          </span>
        </div>
        <button
          onClick={onToggleMap}
          title={showOnMap ? t('meshcomPanel.mapToggleHide') : t('meshcomPanel.mapToggleShow')}
          style={{
            background: showOnMap ? 'rgba(139, 26, 42, 0.25)' : 'rgba(100, 100, 100, 0.3)',
            border: `1px solid ${showOnMap ? '#8B1A2A' : '#666'}`,
            color: showOnMap ? '#c0394e' : '#888',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontFamily: 'JetBrains Mono',
            cursor: 'pointer',
          }}
        >
          <IconMap size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
          {showOnMap ? t('meshcomPanel.mapToggleOn') : t('meshcomPanel.mapToggleOff')}
        </button>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: '2px',
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}
      >
        {TAB_IDS.map((tabId) => (
          <button
            key={tabId}
            onClick={() => setActiveTab(tabId)}
            style={{
              padding: '3px 10px',
              fontSize: '10px',
              borderRadius: '3px',
              border: activeTab === tabId ? '1px solid #2dd4bf' : '1px solid var(--border-color)',
              background: activeTab === tabId ? '#2dd4bf' : 'transparent',
              color: activeTab === tabId ? '#000' : 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: activeTab === tabId ? '600' : '400',
            }}
          >
            {tabLabels[tabId]}
            {tabId === 'messages' && messages.length > 0 && (
              <span
                style={{
                  marginLeft: '4px',
                  background: activeTab === tabId ? 'rgba(0,0,0,0.2)' : 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  padding: '0 4px',
                  fontSize: '9px',
                }}
              >
                {messages.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'nodes' && (
          <NodesTab nodes={nodes} loading={loading} onSpotClick={onSpotClick} onHoverSpot={onHoverSpot} />
        )}
        {activeTab === 'messages' && <MessagesTab messages={messages} nodes={nodes} sendMessage={sendMessage} />}
        {activeTab === 'info' && <InfoTab connected={connected} nodes={nodes} messages={messages} />}
      </div>
    </div>
  );
};

export default MeshComPanel;
