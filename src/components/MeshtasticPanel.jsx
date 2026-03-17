/**
 * MeshtasticPanel — Dockable panel for Meshtastic mesh network.
 * Three connection modes:
 *   1. Direct (Browser) — browser fetches from device on LAN
 *   2. MQTT Broker — server subscribes to MQTT for remote access
 *   3. Server Proxy — server proxies to device HTTP API
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL = 10000;
const DIRECT_POLL_MS = 10000;

// Per-user MQTT session ID — persisted in localStorage so it survives page reloads
function getMeshSessionId() {
  const key = 'openhamclock_mesh_session';
  let id;
  try {
    id = localStorage.getItem(key);
  } catch {}
  if (id && /^[a-zA-Z0-9_-]{8,64}$/.test(id)) return id;
  id = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
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
  const [mode, setMode] = useState(status?.mode || 'direct');
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

    if (mode === 'direct') {
      // Test browser-direct connection
      try {
        const testRes = await fetch(`${host.trim().replace(/\/+$/, '')}/api/v1/nodes`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (!testRes.ok) throw new Error(`Device returned HTTP ${testRes.status}`);
      } catch (e) {
        setError(
          `Cannot reach ${host} from your browser — ${e.message}. Make sure you're on the same network as the device.`,
        );
        setTesting(false);
        return;
      }
      // Save config on server (just stores the mode + host for persistence)
      try {
        await fetch('/api/meshtastic/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...meshHeaders },
          body: JSON.stringify({ enabled: true, mode: 'direct', host: host.trim() }),
        });
      } catch {}
      // Save to localStorage for browser-direct polling
      try {
        localStorage.setItem(
          'openhamclock_meshtastic',
          JSON.stringify({ mode: 'direct', host: host.trim().replace(/\/+$/, ''), enabled: true }),
        );
      } catch {}
      onConnect();
      setTesting(false);
      return;
    }

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
        {modeBtn('direct', '🌐', 'Direct (Browser)', 'Browser connects to device on your WiFi — works on hosted sites')}
        {modeBtn('mqtt', '📡', 'MQTT Broker', 'Server subscribes to MQTT — works from anywhere, even remote')}
        {modeBtn('proxy', '🖥️', 'Server Proxy', 'Server connects to device — for self-hosted/Pi installs only')}
      </div>

      {/* Mode-specific fields */}
      {(mode === 'direct' || mode === 'proxy') && (
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
          {mode === 'direct' && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
              Your browser will connect directly to the device. You must be on the same network.
            </div>
          )}
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

// ── Browser-direct polling hook ──
function useDirectMeshtastic(enabled, deviceHost) {
  const [nodes, setNodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const lastMsgTs = useRef(0);

  const fetchDirect = useCallback(async () => {
    if (!enabled || !deviceHost) return;
    try {
      // Fetch nodes
      const nodesRes = await fetch(`${deviceHost}/api/v1/nodes`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!nodesRes.ok) throw new Error(`HTTP ${nodesRes.status}`);
      const nodesData = await nodesRes.json();
      const nodeList = nodesData.nodes || nodesData;
      const parsed = (Array.isArray(nodeList) ? nodeList : Object.values(nodeList || {}))
        .map((n) => ({
          num: n.num || n.nodeNum,
          id: n.user?.id || `!${(n.num || 0).toString(16)}`,
          longName: n.user?.longName || '',
          shortName: n.user?.shortName || '',
          hwModel: n.user?.hwModel || '',
          lat: n.position?.latitudeI != null ? n.position.latitudeI / 1e7 : (n.position?.latitude ?? null),
          lon: n.position?.longitudeI != null ? n.position.longitudeI / 1e7 : (n.position?.longitude ?? null),
          alt: n.position?.altitude ?? null,
          batteryLevel: n.deviceMetrics?.batteryLevel ?? null,
          snr: n.snr ?? null,
          lastHeard: n.lastHeard ? n.lastHeard * 1000 : Date.now(),
          hopsAway: n.hopsAway ?? null,
          hasPosition: n.position?.latitudeI != null || n.position?.latitude != null,
        }))
        .filter((n) => n.num);
      setNodes(parsed);
      setConnected(true);
      setLastError(null);

      // Fetch messages
      try {
        const msgsRes = await fetch(`${deviceHost}/api/v1/messages`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (msgsRes.ok) {
          const msgsData = await msgsRes.json();
          const msgList = msgsData.messages || msgsData;
          if (Array.isArray(msgList)) {
            setMessages((prev) => {
              const ids = new Set(prev.map((m) => m.id));
              const newMsgs = msgList
                .filter((m) => !ids.has(m.id || m.packetId))
                .map((m) => ({
                  id: m.id || m.packetId || `${m.from}-${m.rxTime || Date.now()}`,
                  from: m.from,
                  to: m.to,
                  text: m.text || m.payload || '',
                  timestamp: m.rxTime ? m.rxTime * 1000 : Date.now(),
                  channel: m.channel ?? 0,
                  fromName: parsed.find((n) => n.num === m.from)?.longName || `!${(m.from || 0).toString(16)}`,
                }));
              return [...prev, ...newMsgs].slice(-200);
            });
          }
        }
      } catch {}

      // Fetch device info (less frequently)
      if (!deviceInfo) {
        try {
          const infoRes = await fetch(`${deviceHost}/api/v1/config`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (infoRes.ok) {
            const d = await infoRes.json();
            setDeviceInfo({
              firmwareVersion: d.firmwareVersion || d.version || null,
              hwModel: d.hwModel || null,
              region: d.lora?.region || null,
              longName: d.owner?.longName || null,
              shortName: d.owner?.shortName || null,
            });
          }
        } catch {}
      }
    } catch (e) {
      setConnected(false);
      setLastError(e.message);
    }
  }, [enabled, deviceHost, deviceInfo]);

  useEffect(() => {
    if (!enabled || !deviceHost) return;
    fetchDirect();
    const interval = setInterval(fetchDirect, DIRECT_POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, deviceHost, fetchDirect]);

  const sendDirect = useCallback(
    async (text, to, channel) => {
      const payload = { text: text.trim(), to: to || 0xffffffff, channel: channel || 0 };
      const res = await fetch(`${deviceHost}/api/v1/sendtext`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Device returned ${res.status}`);
    },
    [deviceHost],
  );

  return { nodes, messages, connected, lastError, deviceInfo, sendDirect };
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

  const isDirectMode = meshConfig.mode === 'direct' && meshConfig.enabled;

  // Server-side state (for proxy/mqtt modes)
  const [serverStatus, setServerStatus] = useState(null);
  const [serverNodes, setServerNodes] = useState([]);
  const [serverMessages, setServerMessages] = useState([]);
  const serverLastMsgTs = useRef(0);

  // Browser-direct state
  const direct = useDirectMeshtastic(isDirectMode, meshConfig.host);

  // Pick active data source
  const nodes = isDirectMode ? direct.nodes : serverNodes;
  const messages = isDirectMode ? direct.messages : serverMessages;
  const isConnected = isDirectMode ? direct.connected : serverStatus?.connected;
  const lastError = isDirectMode ? direct.lastError : serverStatus?.lastError;
  const deviceInfo = isDirectMode ? direct.deviceInfo : serverStatus?.deviceInfo;
  const activeMode = isDirectMode ? 'direct' : serverStatus?.mode || meshConfig.mode || '';
  const isEnabled = isDirectMode ? true : serverStatus?.enabled;

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
    if (!isDirectMode) {
      fetchServerNodes();
      fetchServerMessages();
    }
    const interval = setInterval(() => {
      fetchServerStatus();
      if (!isDirectMode && serverStatus?.enabled) {
        fetchServerNodes();
        fetchServerMessages();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchServerStatus, fetchServerNodes, fetchServerMessages, isDirectMode, serverStatus?.enabled]);

  // Show setup if nothing configured
  useEffect(() => {
    if (!isEnabled && !isDirectMode && serverStatus && !serverStatus.enabled) setShowSetup(true);
  }, [isEnabled, isDirectMode, serverStatus]);

  useEffect(() => {
    if (tab === 'messages') msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tab]);

  // Send handler
  const handleSend = async () => {
    if (!sendText.trim() || sending) return;
    setSending(true);
    try {
      if (isDirectMode) {
        await direct.sendDirect(sendText.trim(), sendTo?.num, sendChannel);
        setSendText('');
      } else {
        const res = await fetch('/api/meshtastic/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...meshHeaders },
          body: JSON.stringify({ text: sendText.trim(), to: sendTo?.num || 0xffffffff, channel: sendChannel }),
        });
        if (res.ok) setSendText('');
      }
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
  if (showSetup || (!isEnabled && !isDirectMode)) {
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

  if (!serverStatus && !isDirectMode) {
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

  const modeLabel = activeMode === 'direct' ? '🌐 Direct' : activeMode === 'mqtt' ? '📡 MQTT' : '🖥️ Proxy';

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
                [
                  'Mode',
                  activeMode === 'direct'
                    ? '🌐 Direct (Browser)'
                    : activeMode === 'mqtt'
                      ? '📡 MQTT Broker'
                      : '🖥️ Server Proxy',
                ],
                ['Status', isConnected ? '🟢 Connected' : '🔴 Disconnected'],
                ...(activeMode === 'proxy' ? [['Host', serverStatus?.host || 'N/A']] : []),
                ...(activeMode === 'mqtt'
                  ? [
                      ['Broker', serverStatus?.mqttBroker || 'N/A'],
                      ['Topic', serverStatus?.mqttTopic || 'N/A'],
                    ]
                  : []),
                ...(activeMode === 'direct' ? [['Device', meshConfig.host || 'N/A']] : []),
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
