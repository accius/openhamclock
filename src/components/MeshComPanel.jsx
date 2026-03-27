/**
 * MeshComPanel Component
 * Displays MeshCom mesh nodes, messages and weather/telemetry data
 * received via the rig-bridge UDP plugin on port 1799.
 *
 * Three tabs: Nodes | Messages | Info
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useMeshCom } from '../hooks/useMeshCom.js';
import CallsignLink from './CallsignLink.jsx';
import { primaryCall } from '../utils/callsign.js';

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
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Loading…</div>;
  }
  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
        No MeshCom nodes heard yet.
        <div style={{ fontSize: '11px', marginTop: '8px' }}>
          Make sure the MeshCom UDP plugin is enabled in rig-bridge config.
        </div>
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
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontStyle: 'italic' }}>no pos</span>
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
  const [toField, setToField] = useState('*');
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const listRef = useRef(null);

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
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  }, [msgText, toField, sendMessage, sending]);

  const nodeCalls = nodes.map((n) => primaryCall(n.call));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message list */}
      <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
            No messages yet
          </div>
        ) : (
          [...messages].reverse().map((msg, i) => (
            <div
              key={i}
              style={{
                padding: '4px 0',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>
                  <span style={{ fontWeight: '700', color: '#2dd4bf', fontFamily: 'JetBrains Mono, monospace' }}>
                    {primaryCall(msg.src)}
                  </span>
                  {msg.dst && msg.dst !== '*' && (
                    <span style={{ color: 'var(--text-muted)' }}> → {primaryCall(msg.dst)}</span>
                  )}
                  {msg.dst === '*' && <span style={{ color: 'var(--text-muted)' }}> → ALL</span>}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatTime(msg.timestamp)}</span>
              </div>
              <div style={{ color: 'var(--text-primary)', marginTop: '2px' }}>{msg.text}</div>
            </div>
          ))
        )}
      </div>

      {/* Send form */}
      <div
        style={{
          padding: '6px 8px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', alignSelf: 'center', whiteSpace: 'nowrap' }}>
            To:
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
            <option value="*">Broadcast (*)</option>
            {[0, 1, 2, 3, 4, 5].map((g) => (
              <option key={g} value={String(g)}>
                Group {g}
              </option>
            ))}
            {nodeCalls.map((call) => (
              <option key={call} value={call}>
                {call}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Message (max 150 chars)"
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
              background: msgText.trim() && !sending ? '#2dd4bf' : 'var(--bg-tertiary)',
              border: 'none',
              borderRadius: '3px',
              color: msgText.trim() && !sending ? '#000' : 'var(--text-muted)',
              cursor: msgText.trim() && !sending ? 'pointer' : 'default',
              fontFamily: 'inherit',
              fontWeight: '600',
              whiteSpace: 'nowrap',
            }}
          >
            {sending ? '…' : 'Send'}
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
  return (
    <div style={{ padding: '12px', fontSize: '12px' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>Status</div>
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
          {connected ? 'UDP socket active (port 1799)' : 'UDP plugin not connected'}
        </div>
        <div style={{ marginTop: '6px', color: 'var(--text-muted)' }}>
          {nodes.length} node{nodes.length !== 1 ? 's' : ''} · {messages.length} message
          {messages.length !== 1 ? 's' : ''}
        </div>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>Setup</div>
        <div style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}>
          Enable in rig-bridge config:
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
          On each MeshCom node enable UDP output:
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
        <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>About MeshCom</div>
        <div style={{ color: 'var(--text-muted)', lineHeight: '1.5' }}>
          MeshCom is an open LoRa mesh network for amateur radio operators, developed by OE1KBC and the ICSSW team.
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS = ['Nodes', 'Messages', 'Info'];

const MeshComPanel = ({ showOnMap, onToggleMap, onSpotClick, onHoverSpot }) => {
  const [activeTab, setActiveTab] = useState('Nodes');
  const { nodes, messages, connected, loading, sendMessage } = useMeshCom();

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
          {/* MeshCom hexagonal logo mark */}
          <svg width="16" height="18" viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <polygon
              points="8,1 15,4.5 15,13.5 8,17 1,13.5 1,4.5"
              fill="#2dd4bf"
              stroke="#0d9488"
              strokeWidth="1.2"
              opacity="0.95"
            />
            <circle cx="8" cy="9" r="2" fill="#0d9488" />
            <line x1="8" y1="7" x2="8" y2="1.5" stroke="#0d9488" strokeWidth="0.9" />
            <line x1="8" y1="11" x2="8" y2="16.5" stroke="#0d9488" strokeWidth="0.9" />
            <line x1="6.3" y1="8.1" x2="1.5" y2="5" stroke="#0d9488" strokeWidth="0.9" />
            <line x1="9.7" y1="8.1" x2="14.5" y2="5" stroke="#0d9488" strokeWidth="0.9" />
          </svg>
          <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>MeshCom</span>
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
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{nodes.length} nodes</span>
        </div>
        <button
          onClick={onToggleMap}
          title={showOnMap ? 'Hide MeshCom nodes on map' : 'Show MeshCom nodes on map'}
          style={{
            background: showOnMap ? '#2dd4bf' : 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '3px 8px',
            fontSize: '11px',
            color: showOnMap ? '#000' : 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {showOnMap ? 'ON' : 'OFF'}
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
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '3px 10px',
              fontSize: '10px',
              borderRadius: '3px',
              border: activeTab === tab ? '1px solid #2dd4bf' : '1px solid var(--border-color)',
              background: activeTab === tab ? '#2dd4bf' : 'transparent',
              color: activeTab === tab ? '#000' : 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: activeTab === tab ? '600' : '400',
            }}
          >
            {tab}
            {tab === 'Messages' && messages.length > 0 && (
              <span
                style={{
                  marginLeft: '4px',
                  background: activeTab === tab ? 'rgba(0,0,0,0.2)' : 'var(--bg-tertiary)',
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
        {activeTab === 'Nodes' && (
          <NodesTab nodes={nodes} loading={loading} onSpotClick={onSpotClick} onHoverSpot={onHoverSpot} />
        )}
        {activeTab === 'Messages' && <MessagesTab messages={messages} nodes={nodes} sendMessage={sendMessage} />}
        {activeTab === 'Info' && <InfoTab connected={connected} nodes={nodes} messages={messages} />}
      </div>
    </div>
  );
};

export default MeshComPanel;
