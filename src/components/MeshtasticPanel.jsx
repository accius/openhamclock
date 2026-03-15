/**
 * MeshtasticPanel — Dockable panel for Meshtastic mesh network.
 * Shows connected nodes, messages, device status, and setup UI.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL = 10000;

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

// ── Setup / Config screen ──
function SetupView({ status, onConnect }) {
  const [host, setHost] = useState(status?.host || 'http://meshtastic.local');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setTesting(true);
    setError(null);
    try {
      const res = await fetch('/api/meshtastic/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, host: host.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onConnect();
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (e) {
      setError(`Request failed: ${e.message}`);
    }
    setTesting(false);
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '40px', marginBottom: '8px' }}>📡</div>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '16px' }}>Meshtastic</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
          Connect to your Meshtastic device
        </div>
      </div>

      {/* How it works */}
      <div
        style={{
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          padding: '10px',
          marginBottom: '16px',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Setup:</div>
        1. Connect your Meshtastic device to WiFi
        <br />
        2. Find its IP address (check your router or the Meshtastic app)
        <br />
        3. Enter the address below and click Connect
      </div>

      {/* Host input */}
      <label
        style={{
          display: 'block',
          marginBottom: '4px',
          color: 'var(--text-muted)',
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Device Address
      </label>
      <input
        type="text"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !testing && handleConnect()}
        placeholder="http://meshtastic.local or http://192.168.1.x"
        style={{
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
        }}
      />

      {/* Error */}
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

      {/* Connect button */}
      <button
        onClick={handleConnect}
        disabled={testing || !host.trim()}
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

export default function MeshtasticPanel() {
  const [tab, setTab] = useState('nodes');
  const [status, setStatus] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [sendText, setSendText] = useState('');
  const [sending, setSending] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const msgEndRef = useRef(null);
  const lastMsgTs = useRef(0);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/meshtastic/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        // Show setup if not enabled
        if (!data.enabled) setShowSetup(true);
        else setShowSetup(false);
      }
    } catch {}
  }, []);

  const fetchNodes = useCallback(async () => {
    try {
      const res = await fetch('/api/meshtastic/nodes');
      if (res.ok) {
        const data = await res.json();
        setNodes(data.nodes || []);
      }
    } catch {}
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/meshtastic/messages?since=${lastMsgTs.current}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages?.length > 0) {
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            const newMsgs = data.messages.filter((m) => !ids.has(m.id));
            const combined = [...prev, ...newMsgs].slice(-200);
            if (newMsgs.length > 0) lastMsgTs.current = Math.max(...combined.map((m) => m.timestamp));
            return combined;
          });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchNodes();
    fetchMessages();
    const interval = setInterval(() => {
      fetchStatus();
      if (status?.enabled) {
        fetchNodes();
        fetchMessages();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchNodes, fetchMessages, status?.enabled]);

  useEffect(() => {
    if (tab === 'messages') msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tab]);

  const handleSend = async () => {
    if (!sendText.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/meshtastic/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sendText.trim() }),
      });
      if (res.ok) {
        setSendText('');
        setTimeout(fetchMessages, 1000);
      }
    } catch {}
    setSending(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/meshtastic/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      setNodes([]);
      setMessages([]);
      fetchStatus();
    } catch {}
  };

  // Show setup if not enabled or user clicked settings
  if (showSetup || (status && !status.enabled)) {
    return (
      <SetupView
        status={status}
        onConnect={() => {
          setShowSetup(false);
          fetchStatus();
          fetchNodes();
          fetchMessages();
        }}
      />
    );
  }

  // Loading state
  if (!status) {
    return (
      <div className="panel" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  const isConnected = status.connected;

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
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Meshtastic</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isConnected ? `${nodes.length} nodes` : status.lastError ? 'Error' : 'Connecting...'}
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

      {/* Connection error banner */}
      {!isConnected && status.lastError && (
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
          <span>{status.lastError}</span>
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
            }}
          >
            Reconfigure
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
        {/* Nodes tab */}
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

        {/* Messages tab */}
        {tab === 'messages' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
              {messages.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No messages yet...
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{msg.fromName}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{timeAgo(msg.timestamp)}</span>
                  </div>
                  <div style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>{msg.text}</div>
                  {msg.channel > 0 && (
                    <div style={{ fontSize: '9px', color: 'var(--accent-purple)', marginTop: '2px' }}>
                      CH {msg.channel}
                    </div>
                  )}
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>

            {isConnected && (
              <div style={{ display: 'flex', gap: '4px', padding: '6px', borderTop: '1px solid var(--border-color)' }}>
                <input
                  type="text"
                  value={sendText}
                  onChange={(e) => setSendText(e.target.value.slice(0, 228))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Type a message..."
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
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
            )}
          </div>
        )}

        {/* Info tab */}
        {tab === 'info' && (
          <div style={{ padding: '12px', fontSize: '11px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              {[
                ['Status', isConnected ? '🟢 Connected' : '🔴 Disconnected'],
                ['Host', status.host || 'N/A'],
                [
                  'Config',
                  status.configSource === 'env'
                    ? 'From .env'
                    : status.configSource === 'saved'
                      ? 'Saved in UI'
                      : 'Not configured',
                ],
                ['Firmware', status.deviceInfo?.firmwareVersion || 'N/A'],
                ['Hardware', status.deviceInfo?.hwModel || 'N/A'],
                ['Region', status.deviceInfo?.region || 'N/A'],
                ['Modem', status.deviceInfo?.modemPreset || 'N/A'],
                ['Owner', status.deviceInfo?.longName || status.deviceInfo?.shortName || 'N/A'],
                ['Nodes', `${nodes.length}`],
                ['Messages', `${messages.length}`],
                ['Last Seen', status.lastSeen ? timeAgo(status.lastSeen) : 'Never'],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: '4px 0', color: 'var(--text-muted)', width: '35%' }}>{label}</td>
                  <td style={{ padding: '4px 0', color: 'var(--text-primary)' }}>{value}</td>
                </tr>
              ))}
            </table>

            {/* Disconnect button */}
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
