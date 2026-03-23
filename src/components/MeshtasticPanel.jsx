/**
 * MeshtasticPanel — Dockable panel for Meshtastic mesh network.
 * Three connection modes:
 *   1. Direct (Browser) — browser fetches from device on LAN
 *   2. MQTT Broker — server subscribes to MQTT for remote access
 *   3. Server Proxy — server proxies to device HTTP API
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL = 10000;

// Polyfill for crypto.randomUUID — not available over plain HTTP (non-secure context)
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // crypto.getRandomValues is available even in non-secure contexts
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
    );
  }
  // Last-resort fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Per-user MQTT session ID — persisted in localStorage so it survives page reloads
function getMeshSessionId() {
  const key = 'openhamclock_mesh_session';
  let id;
  try {
    id = localStorage.getItem(key);
  } catch {}
  if (id && /^[a-zA-Z0-9_-]{8,64}$/.test(id)) return id;
  id = generateUUID().replace(/-/g, '').slice(0, 32);
  try {
    localStorage.setItem(key, id);
  } catch {}
  return id;
}
const meshSessionId = getMeshSessionId();
const meshHeaders = { 'x-mesh-session': meshSessionId };

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function BatteryIcon({ level }) {
  if (level == null) return null;
  const color = level > 50 ? '#00ff88' : level > 20 ? '#ffaa00' : '#ff4444';
  return (
    <span title={`Battery: ${level}%`} style={{ color, fontSize: '10px' }}>
      {level > 75 ? '🔋' : level > 25 ? '🪫' : '🔴'} {level}%
    </span>
  );
}

// ── Shared styles ──
const inputStyle = {
  width: '100%',
  padding: '10px',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  fontFamily: 'JetBrains Mono, monospace',
  boxSizing: 'border-box',
  marginBottom: '10px',
};
const labelStyle = {
  display: 'block',
  marginBottom: '4px',
  color: 'var(--text-muted)',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

// ── Setup screen with mode selector ──
function SetupView({ status, onConnect }) {
  const [mode, setMode] = useState(status?.mode === 'direct' ? 'mqtt' : status?.mode || 'mqtt');
  const [host, setHost] = useState(status?.host || 'http://meshtastic.local');
  const [mqttBroker, setMqttBroker] = useState(status?.mqttBroker || 'mqtt://mqtt.meshtastic.org');
  const [mqttTopic, setMqttTopic] = useState(status?.mqttTopic || 'msh/US/#');
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setTesting(true);
    setError(null);

    // MQTT or Proxy — configure via server
    try {
      const body =
        mode === 'mqtt'
          ? {
              enabled: true,
              mode: 'mqtt',
              mqttBroker: mqttBroker.trim(),
              mqttTopic: mqttTopic.trim(),
              mqttUsername,
              mqttPassword,
            }
          : { enabled: true, mode: 'proxy', host: host.trim() };
      const res = await fetch('/api/meshtastic/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...meshHeaders },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        try {
          localStorage.setItem('openhamclock_meshtastic', JSON.stringify({ mode, enabled: true }));
        } catch {}
        onConnect();
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (e) {
      setError(`Request failed: ${e.message}`);
    }
    setTesting(false);
  };

  const modeBtn = (id, icon, label, desc) => (
    <button
      key={id}
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      style={{
        padding: '10px',
        background: mode === id ? 'rgba(255,170,0,0.15)' : 'var(--bg-tertiary)',
        border: `1px solid ${mode === id ? 'var(--accent-amber)' : 'var(--border-color)'}`,
        borderRadius: '6px',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <div
        style={{
          fontSize: '13px',
          color: mode === id ? 'var(--accent-amber)' : 'var(--text-primary)',
          fontWeight: 600,
        }}
      >
        {icon} {label}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{desc}</div>
    </button>
  );

  return (
    <div
      style={{
        padding: '16px',
        fontFamily: 'JetBrains Mono, monospace',
        overflowY: 'auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '40px', marginBottom: '8px' }}>📡</div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '16px' }}>Meshtastic</div>
      </div>

      {/* Mode selector */}
      <label style={labelStyle}>Connection Mode</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
        {modeBtn('mqtt', '📡', 'MQTT Broker', 'Server subscribes to MQTT — works from anywhere, even remote')}
        {modeBtn('proxy', '🖥️', 'Server Proxy', 'Server connects to device — for self-hosted/Pi installs only')}
      </div>

      {/* Mode-specific fields */}
      {mode === 'proxy' && (
        <>
          <label style={labelStyle}>Device Address</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !testing && handleConnect()}
            placeholder="http://meshtastic.local or http://192.168.1.x"
            style={inputStyle}
          />
        </>
      )}

      {mode === 'mqtt' && (
        <>
          <label style={labelStyle}>MQTT Broker URL</label>
          <input
            type="text"
            value={mqttBroker}
            onChange={(e) => setMqttBroker(e.target.value)}
            placeholder="mqtt://mqtt.meshtastic.org"
            style={inputStyle}
          />
          <label style={labelStyle}>Topic Filter</label>
          <input
            type="text"
            value={mqttTopic}
            onChange={(e) => setMqttTopic(e.target.value)}
            placeholder="msh/US/#"
            style={inputStyle}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label style={labelStyle}>Username (optional)</label>
              <input
                type="text"
                value={mqttUsername}
                onChange={(e) => setMqttUsername(e.target.value)}
                placeholder="username"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Password (optional)</label>
              <input
                type="password"
                value={mqttPassword}
                onChange={(e) => setMqttPassword(e.target.value)}
                placeholder="password"
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
            Enable MQTT on your Meshtastic device (Settings → MQTT) and set JSON output enabled. The default public
            broker is mqtt.meshtastic.org.
          </div>
        </>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(255,68,68,0.1)',
            border: '1px solid rgba(255,68,68,0.3)',
            borderRadius: '6px',
            padding: '8px',
            fontSize: '11px',
            color: '#ff6666',
            marginBottom: '10px',
            wordBreak: 'break-word',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={handleConnect}
        disabled={testing}
        style={{
          width: '100%',
          padding: '10px',
          background: testing ? 'var(--bg-tertiary)' : 'var(--accent-amber)',
          border: 'none',
          borderRadius: '6px',
          color: testing ? 'var(--text-muted)' : '#000',
          fontSize: '13px',
          fontWeight: 700,
          cursor: testing ? 'wait' : 'pointer',
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        {testing ? 'Testing connection...' : 'Connect'}
      </button>
    </div>
  );
}

// ── Main panel ──
export default function MeshtasticPanel() {
  const [tab, setTab] = useState('nodes');
  const [showSetup, setShowSetup] = useState(false);
  const [sendText, setSendText] = useState('');
  const [sendTo, setSendTo] = useState(null);
  const [sendChannel, setSendChannel] = useState(0);
  const [sending, setSending] = useState(false);
  const msgEndRef = useRef(null);

  // Determine active mode from localStorage
  const [meshConfig, setMeshConfig] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('openhamclock_meshtastic') || '{}');
    } catch {
      return {};
    }
  });

  // Server-side state (for proxy/mqtt modes)
  const [serverStatus, setServerStatus] = useState(null);
  const [serverNodes, setServerNodes] = useState([]);
  const [serverMessages, setServerMessages] = useState([]);
  const serverLastMsgTs = useRef(0);

  // Pick active data source
  const nodes = serverNodes;
  const messages = serverMessages;
  const isConnected = serverStatus?.connected;
  const lastError = serverStatus?.lastError;
  const deviceInfo = serverStatus?.deviceInfo;
  const activeMode = serverStatus?.mode || meshConfig.mode || '';
  const isEnabled = serverStatus?.enabled;

  // Server polling (for proxy/mqtt modes)
  const fetchServerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/meshtastic/status', { headers: meshHeaders });
      if (res.ok) setServerStatus(await res.json());
    } catch {}
  }, []);

  const fetchServerNodes = useCallback(async () => {
    try {
      const res = await fetch('/api/meshtastic/nodes', { headers: meshHeaders });
      if (res.ok) {
        const d = await res.json();
        setServerNodes(d.nodes || []);
      }
    } catch {}
  }, []);

  const fetchServerMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/meshtastic/messages?since=${serverLastMsgTs.current}`, { headers: meshHeaders });
      if (res.ok) {
        const d = await res.json();
        if (d.messages?.length > 0) {
          setServerMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            const newMsgs = d.messages.filter((m) => !ids.has(m.id));
            const combined = [...prev, ...newMsgs].slice(-200);
            if (newMsgs.length > 0) serverLastMsgTs.current = Math.max(...combined.map((m) => m.timestamp));
            return combined;
          });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchServerStatus();
    fetchServerNodes();
    fetchServerMessages();
    const interval = setInterval(() => {
      fetchServerStatus();
      if (serverStatus?.enabled) {
        fetchServerNodes();
        fetchServerMessages();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchServerStatus, fetchServerNodes, fetchServerMessages, serverStatus?.enabled]);

  // Show setup if nothing configured
  useEffect(() => {
    if (!isEnabled && serverStatus && !serverStatus.enabled) setShowSetup(true);
  }, [isEnabled, serverStatus]);

  useEffect(() => {
    if (tab === 'messages') msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tab]);

  // Send handler
  const handleSend = async () => {
    if (!sendText.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/meshtastic/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...meshHeaders },
        body: JSON.stringify({ text: sendText.trim(), to: sendTo?.num || 0xffffffff, channel: sendChannel }),
      });
      if (res.ok) setSendText('');
    } catch {}
    setSending(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/meshtastic/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...meshHeaders },
        body: JSON.stringify({ enabled: false }),
      });
    } catch {}
    try {
      localStorage.removeItem('openhamclock_meshtastic');
    } catch {}
    setMeshConfig({});
    setServerNodes([]);
    setServerMessages([]);
    fetchServerStatus();
    setShowSetup(true);
  };

  // Setup screen
  if (showSetup || !isEnabled) {
    return (
      <SetupView
        status={serverStatus}
        onConnect={() => {
          try {
            setMeshConfig(JSON.parse(localStorage.getItem('openhamclock_meshtastic') || '{}'));
          } catch {}
          setShowSetup(false);
          fetchServerStatus();
          fetchServerNodes();
          fetchServerMessages();
        }}
      />
    );
  }

  if (!serverStatus) {
    return (
      <div className="panel" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  const tabStyle = (active) => ({
    flex: 1,
    padding: '6px',
    background: active ? 'var(--accent-amber)' : 'transparent',
    border: 'none',
    color: active ? '#000' : 'var(--text-secondary)',
    fontSize: '11px',
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
  });

  const modeLabel = activeMode === 'mqtt' ? '📡 MQTT' : '🖥️ Proxy';

  return (
    <div
      className="panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'JetBrains Mono, monospace' }}
    >
      {/* Status bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '11px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isConnected ? '#00ff88' : '#ff4444',
              display: 'inline-block',
            }}
          />
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Mesh</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{modeLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isConnected ? `${nodes.length} nodes` : lastError ? 'Error' : 'Connecting...'}
          </span>
          <button
            onClick={() => setShowSetup(true)}
            title="Settings"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '0 2px',
            }}
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Error banner */}
      {!isConnected && lastError && (
        <div
          style={{
            padding: '6px 10px',
            background: 'rgba(255,68,68,0.1)',
            borderBottom: '1px solid rgba(255,68,68,0.2)',
            fontSize: '10px',
            color: '#ff6666',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastError}</span>
          <button
            onClick={() => setShowSetup(true)}
            style={{
              background: 'none',
              border: '1px solid #ff6666',
              borderRadius: '3px',
              color: '#ff6666',
              fontSize: '9px',
              padding: '2px 6px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Fix
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
        <button style={tabStyle(tab === 'nodes')} onClick={() => setTab('nodes')}>
          📍 Nodes ({nodes.length})
        </button>
        <button style={tabStyle(tab === 'messages')} onClick={() => setTab('messages')}>
          💬 Msgs ({messages.length})
        </button>
        <button style={tabStyle(tab === 'info')} onClick={() => setTab('info')}>
          ℹ️ Info
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {tab === 'nodes' && (
          <div style={{ padding: '4px' }}>
            {nodes.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                {isConnected ? 'No nodes discovered yet...' : 'Waiting for connection...'}
              </div>
            )}
            {nodes
              .sort((a, b) => (b.lastHeard || 0) - (a.lastHeard || 0))
              .map((node) => (
                <div
                  key={node.num}
                  style={{ padding: '8px', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>
                      {node.longName || node.shortName || node.id}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{timeAgo(node.lastHeard)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '10px' }}>
                    {node.hasPosition && (
                      <span style={{ color: 'var(--accent-cyan)' }}>
                        📍 {node.lat?.toFixed(4)}°, {node.lon?.toFixed(4)}°
                      </span>
                    )}
                    {node.alt != null && <span style={{ color: 'var(--text-secondary)' }}>Alt: {node.alt}m</span>}
                    {node.snr != null && (
                      <span style={{ color: node.snr > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        SNR: {node.snr}dB
                      </span>
                    )}
                    {node.hopsAway != null && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {node.hopsAway} hop{node.hopsAway !== 1 ? 's' : ''}
                      </span>
                    )}
                    <BatteryIcon level={node.batteryLevel} />
                  </div>
                  {node.hwModel && (
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>{node.hwModel}</div>
                  )}
                </div>
              ))}
          </div>
        )}

        {tab === 'messages' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
              {messages.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No messages yet...
                </div>
              )}
              {messages.map((msg) => {
                const isBroadcast = !msg.to || msg.to === 0xffffffff || msg.to === 4294967295;
                return (
                  <div
                    key={msg.id}
                    style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span>
                        <span
                          style={{ color: 'var(--accent-amber)', fontWeight: 600, cursor: 'pointer' }}
                          onClick={() =>
                            msg.from && setSendTo({ num: msg.from, name: msg.fromName || `!${msg.from.toString(16)}` })
                          }
                          title="Click to DM"
                        >
                          {msg.fromName}
                        </span>
                        {!isBroadcast && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}> → DM</span>}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{timeAgo(msg.timestamp)}</span>
                    </div>
                    <div style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{msg.text}</div>
                    {msg.channel > 0 && (
                      <div style={{ fontSize: '9px', color: 'var(--accent-purple)', marginTop: '2px' }}>
                        CH {msg.channel}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={msgEndRef} />
            </div>

            {isConnected && (
              <div
                style={{
                  borderTop: '1px solid var(--border-color)',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '10px' }}>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>To:</span>
                  <select
                    value={sendTo ? String(sendTo.num) : 'broadcast'}
                    onChange={(e) => {
                      if (e.target.value === 'broadcast') setSendTo(null);
                      else {
                        const num = parseInt(e.target.value);
                        const n = nodes.find((x) => x.num === num);
                        setSendTo({ num, name: n?.longName || n?.shortName || `!${num.toString(16)}` });
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '3px',
                      color: sendTo ? 'var(--accent-cyan)' : 'var(--text-primary)',
                      fontSize: '10px',
                      fontFamily: 'JetBrains Mono, monospace',
                      minWidth: 0,
                    }}
                  >
                    <option value="broadcast">📢 Broadcast</option>
                    {nodes
                      .filter((n) => n.longName || n.shortName)
                      .sort((a, b) => (a.longName || a.shortName || '').localeCompare(b.longName || b.shortName || ''))
                      .map((n) => (
                        <option key={n.num} value={String(n.num)}>
                          💬 {n.longName || n.shortName}
                        </option>
                      ))}
                  </select>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>CH:</span>
                  <select
                    value={sendChannel}
                    onChange={(e) => setSendChannel(parseInt(e.target.value))}
                    style={{
                      width: '45px',
                      padding: '4px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '3px',
                      color: sendChannel > 0 ? 'var(--accent-purple)' : 'var(--text-primary)',
                      fontSize: '10px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </div>
                {sendTo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                    <span style={{ color: 'var(--accent-cyan)' }}>DM → {sendTo.name}</span>
                    <button
                      onClick={() => setSendTo(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        padding: '0 2px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="text"
                    value={sendText}
                    onChange={(e) => setSendText(e.target.value.slice(0, 228))}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={sendTo ? `Message to ${sendTo.name}...` : 'Broadcast message...'}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      background: 'var(--bg-tertiary)',
                      border: `1px solid ${sendTo ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!sendText.trim() || sending}
                    style={{
                      padding: '6px 10px',
                      background: sendText.trim() ? 'var(--accent-amber)' : 'var(--bg-tertiary)',
                      border: 'none',
                      borderRadius: '4px',
                      color: sendText.trim() ? '#000' : 'var(--text-muted)',
                      fontSize: '11px',
                      cursor: sendText.trim() ? 'pointer' : 'default',
                      fontWeight: 600,
                    }}
                  >
                    {sending ? '...' : 'Send'}
                  </button>
                </div>
                {sendText.length > 0 && (
                  <div
                    style={{
                      textAlign: 'right',
                      fontSize: '9px',
                      color: sendText.length > 200 ? 'var(--accent-red)' : 'var(--text-muted)',
                    }}
                  >
                    {sendText.length}/228
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'info' && (
          <div style={{ padding: '12px', fontSize: '11px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              {[
                ['Mode', activeMode === 'mqtt' ? '📡 MQTT Broker' : '🖥️ Server Proxy'],
                ['Status', isConnected ? '🟢 Connected' : '🔴 Disconnected'],
                ...(activeMode === 'proxy' ? [['Host', serverStatus?.host || 'N/A']] : []),
                ...(activeMode === 'mqtt'
                  ? [
                      ['Broker', serverStatus?.mqttBroker || 'N/A'],
                      ['Topic', serverStatus?.mqttTopic || 'N/A'],
                    ]
                  : []),
                ['Firmware', deviceInfo?.firmwareVersion || 'N/A'],
                ['Hardware', deviceInfo?.hwModel || 'N/A'],
                ['Region', deviceInfo?.region || 'N/A'],
                ['Owner', deviceInfo?.longName || deviceInfo?.shortName || 'N/A'],
                ['Nodes', `${nodes.length}`],
                ['Messages', `${messages.length}`],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: '4px 0', color: 'var(--text-muted)', width: '35%' }}>{label}</td>
                  <td style={{ padding: '4px 0', color: 'var(--text-primary)' }}>{value}</td>
                </tr>
              ))}
            </table>
            <button
              onClick={handleDisconnect}
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '8px',
                background: 'rgba(255,68,68,0.1)',
                border: '1px solid rgba(255,68,68,0.3)',
                borderRadius: '6px',
                color: '#ff6666',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              Disconnect & Disable
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
