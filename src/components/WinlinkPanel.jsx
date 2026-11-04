/**
 * WinlinkPanel Component
 * Winlink gateway discovery, Pat client inbox/outbox, and compose.
 * Interfaces with the winlink-gateway rig-bridge plugin.
 *
 * The Reachable view (predicted HF reachability of nearby gateways) needs
 * only the gateway list, so it is available even without Rig Bridge.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useWinlink } from '../hooks/useWinlink';
import WinlinkReachView from './WinlinkReachView.jsx';

const TAB_STORAGE_KEY = 'ohc_winlinkPanelTab';

function loadTab() {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) || 'reach';
  } catch {
    return 'reach';
  }
}

const WinlinkPanel = ({ deLocation, propConfig, solarIndices, units, onSelectGateway } = {}) => {
  const { t } = useTranslation();
  const {
    status,
    inbox,
    outbox,
    gateways,
    loading,
    mailLoading,
    refreshMail,
    searchGateways,
    compose,
    connectGateway,
  } = useWinlink();

  const [tab, setTab] = useState(loadTab); // reach | inbox | outbox | gateways | compose
  // The Reachable view stays mounted once opened so the map layer keeps its
  // reachability colouring while the operator reads mail.
  const [reachOn, setReachOn] = useState(false);
  const [search, setSearch] = useState('');
  const [gwGrid, setGwGrid] = useState('');
  const [gwRange, setGwRange] = useState('500');
  const [gwMode, setGwMode] = useState('');
  const [gwLoading, setGwLoading] = useState(false);
  const [composeForm, setComposeForm] = useState({ to: '', cc: '', subject: '', body: '' });
  const [composing, setComposing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [expandedMsg, setExpandedMsg] = useState(null);
  const [connecting, setConnecting] = useState(null);

  const showFeedback = useCallback((message, isError = false) => {
    setFeedback({ message, isError });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  const handleSearch = useCallback(async () => {
    setGwLoading(true);
    await searchGateways(gwGrid || undefined, gwRange || undefined, gwMode || undefined);
    setGwLoading(false);
  }, [searchGateways, gwGrid, gwRange, gwMode]);

  const handleCompose = useCallback(async () => {
    if (!composeForm.to.trim() || !composeForm.subject.trim()) {
      showFeedback('To and Subject are required', true);
      return;
    }
    setComposing(true);
    const result = await compose(composeForm);
    setComposing(false);
    if (result.error) {
      showFeedback(result.error, true);
    } else {
      showFeedback('Message queued');
      setComposeForm({ to: '', cc: '', subject: '', body: '' });
      setTab('outbox');
    }
  }, [compose, composeForm, showFeedback]);

  const handleConnect = useCallback(
    async (callsign) => {
      setConnecting(callsign);
      const result = await connectGateway(callsign, 'telnet');
      setConnecting(null);
      if (result.error) showFeedback(result.error, true);
      else showFeedback(`Connected to ${callsign}`);
    },
    [connectGateway, showFeedback],
  );

  const filteredInbox = useMemo(() => {
    if (!search.trim()) return inbox;
    const q = search.toUpperCase();
    return inbox.filter((m) => (m.subject || '').toUpperCase().includes(q) || (m.from || '').toUpperCase().includes(q));
  }, [inbox, search]);

  const filteredOutbox = useMemo(() => {
    if (!search.trim()) return outbox;
    const q = search.toUpperCase();
    return outbox.filter(
      (m) => (m.subject || '').toUpperCase().includes(q) || (m.to || []).some((t) => t.toUpperCase().includes(q)),
    );
  }, [outbox, search]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '--';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const rigBridgeOn = !!status.enabled;
  const tabs = [
    { key: 'reach', label: t('winlinkReach.tab', { defaultValue: 'Reachable' }), show: true },
    { key: 'inbox', label: `Inbox (${inbox.length})`, show: rigBridgeOn && status.patEnabled },
    { key: 'outbox', label: `Outbox (${outbox.length})`, show: rigBridgeOn && status.patEnabled },
    { key: 'gateways', label: 'Gateways', show: rigBridgeOn && status.gatewayDiscovery },
    { key: 'compose', label: 'Compose', show: rigBridgeOn && status.patEnabled },
  ].filter((x) => x.show);
  const activeTab = tabs.some((x) => x.key === tab) ? tab : 'reach';

  useEffect(() => {
    if (activeTab === 'reach') setReachOn(true);
  }, [activeTab]);

  const chooseTab = useCallback((key) => {
    setTab(key);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, key);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Only block on the rig-bridge status for tabs that need it; the Reachable
  // view runs from the gateway list alone.
  if (loading && activeTab !== 'reach') {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
        Loading...
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
          <span style={{ fontSize: '14px' }}>📬</span>
          <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>Winlink</span>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: status.running ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '10px' }}>
          {status.gatewayDiscovery && <span style={{ color: 'var(--text-muted)' }}>{status.gatewayCount} GW</span>}
          {status.patEnabled && (
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '3px',
                background: status.patReachable ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: status.patReachable ? '#22c55e' : '#ef4444',
                fontSize: '10px',
              }}
            >
              Pat {status.patReachable ? 'OK' : 'Down'}
            </span>
          )}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            background: feedback.isError ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
            color: feedback.isError ? '#ef4444' : '#22c55e',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          {feedback.message}
        </div>
      )}

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
        {tabs.map((x) => (
          <button
            key={x.key}
            onClick={() => chooseTab(x.key)}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              borderRadius: '3px',
              border: activeTab === x.key ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
              background: activeTab === x.key ? 'var(--accent-cyan)' : 'transparent',
              color: activeTab === x.key ? '#000' : 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: activeTab === x.key ? '600' : '400',
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      {/* Search (inbox/outbox) */}
      {(activeTab === 'inbox' || activeTab === 'outbox') && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            style={{
              width: '100%',
              padding: '5px 8px',
              fontSize: '11px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
        {/* Reachable — predicted HF reachability of nearby gateways */}
        {reachOn && (
          <WinlinkReachView
            hidden={activeTab !== 'reach'}
            deLocation={deLocation}
            propConfig={propConfig}
            solarIndices={solarIndices}
            units={units}
            onSelectGateway={onSelectGateway}
          />
        )}
        {activeTab === 'reach' && !rigBridgeOn && (
          <div style={{ padding: '8px 4px 2px', fontSize: '10px', color: 'var(--text-muted)' }}>
            {t('winlinkReach.rigBridgeHint', {
              defaultValue:
                'Inbox, outbox and compose need the Rig Bridge Winlink plugin (winlink.enabled: true, with Pat for messaging).',
            })}
          </div>
        )}
        {/* Inbox */}
        {activeTab === 'inbox' && (
          <>
            {mailLoading && inbox.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Loading mail...</div>
            ) : filteredInbox.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                {inbox.length === 0 ? 'Inbox empty' : 'No messages match'}
              </div>
            ) : (
              filteredInbox.map((msg, i) => (
                <div
                  key={msg.mid || i}
                  onClick={() => setExpandedMsg(expandedMsg === msg.mid ? null : msg.mid)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '3px',
                    marginBottom: '2px',
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '11px' }}>
                      {msg.subject || '(no subject)'}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>
                      {formatDate(msg.date)}
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--accent-cyan)' }}>From: {msg.from || 'Unknown'}</div>
                  {expandedMsg === msg.mid && msg.body && (
                    <div
                      style={{
                        marginTop: '6px',
                        padding: '6px 8px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '3px',
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--font-mono)',
                        maxHeight: '200px',
                        overflow: 'auto',
                      }}
                    >
                      {msg.body}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {/* Outbox */}
        {activeTab === 'outbox' && (
          <>
            {filteredOutbox.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                {outbox.length === 0 ? 'Outbox empty' : 'No messages match'}
              </div>
            ) : (
              filteredOutbox.map((msg, i) => (
                <div
                  key={msg.mid || i}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '3px',
                    marginBottom: '2px',
                    background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '11px' }}>
                      {msg.subject || '(no subject)'}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '8px' }}>
                      {formatDate(msg.date)}
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--accent-amber)' }}>
                    To: {Array.isArray(msg.to) ? msg.to.join(', ') : msg.to || '--'}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* Gateways */}
        {activeTab === 'gateways' && (
          <>
            {/* Search controls */}
            <div
              style={{
                padding: '6px 4px',
                marginBottom: '4px',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <input
                  value={gwGrid}
                  onChange={(e) => setGwGrid(e.target.value.toUpperCase())}
                  placeholder="Grid (e.g. FN20)"
                  style={{
                    width: '80px',
                    padding: '4px 6px',
                    fontSize: '11px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '3px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
                <input
                  value={gwRange}
                  onChange={(e) => setGwRange(e.target.value)}
                  placeholder="Range km"
                  style={{
                    width: '60px',
                    padding: '4px 6px',
                    fontSize: '11px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '3px',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                  }}
                />
                <select
                  value={gwMode}
                  onChange={(e) => setGwMode(e.target.value)}
                  style={{
                    padding: '4px',
                    fontSize: '11px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '3px',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="">All modes</option>
                  <option value="Packet">Packet</option>
                  <option value="Winmor">Winmor</option>
                  <option value="ARDOP">ARDOP</option>
                  <option value="VARA">VARA</option>
                  <option value="VARA FM">VARA FM</option>
                  <option value="VARA HF">VARA HF</option>
                </select>
                <button
                  onClick={handleSearch}
                  disabled={gwLoading}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    background: 'var(--accent-cyan)',
                    border: 'none',
                    borderRadius: '3px',
                    color: '#000',
                    cursor: gwLoading ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: '600',
                  }}
                >
                  {gwLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{gateways.length} gateways found</div>
            </div>

            {/* Gateway list */}
            {gateways.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                Search for gateways by grid square
              </div>
            ) : (
              gateways.slice(0, 100).map((gw, i) => {
                const callsign = gw.Callsign || gw.callsign || '--';
                const freq = gw.Frequency || gw.frequency;
                const mode = gw.Mode || gw.ServiceCode || '';
                const distance = gw.Distance || gw.distance;

                return (
                  <div
                    key={`${callsign}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 6px',
                      borderRadius: '3px',
                      marginBottom: '2px',
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            fontWeight: '700',
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {callsign}
                        </span>
                        {mode && (
                          <span
                            style={{
                              padding: '1px 4px',
                              borderRadius: '2px',
                              background: 'var(--bg-tertiary)',
                              color: 'var(--accent-amber)',
                              fontSize: '9px',
                            }}
                          >
                            {mode}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {freq ? `${(freq / 1e6).toFixed(3)} MHz` : ''}
                        {distance ? ` - ${distance} km` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnect(callsign)}
                      disabled={connecting === callsign}
                      style={{
                        padding: '3px 8px',
                        fontSize: '10px',
                        background: 'var(--accent-cyan)',
                        border: 'none',
                        borderRadius: '3px',
                        color: '#000',
                        cursor: connecting === callsign ? 'wait' : 'pointer',
                        fontFamily: 'inherit',
                        fontWeight: '600',
                        flexShrink: 0,
                      }}
                    >
                      {connecting === callsign ? '...' : 'Connect'}
                    </button>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* Compose */}
        {activeTab === 'compose' && (
          <div style={{ padding: '4px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                To
              </label>
              <input
                value={composeForm.to}
                onChange={(e) => setComposeForm((p) => ({ ...p, to: e.target.value }))}
                placeholder="CALLSIGN"
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  fontSize: '11px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                CC (optional)
              </label>
              <input
                value={composeForm.cc}
                onChange={(e) => setComposeForm((p) => ({ ...p, cc: e.target.value }))}
                placeholder="CALLSIGN"
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  fontSize: '11px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                Subject
              </label>
              <input
                value={composeForm.subject}
                onChange={(e) => setComposeForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="Message subject"
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  fontSize: '11px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                Body
              </label>
              <textarea
                value={composeForm.body}
                onChange={(e) => setComposeForm((p) => ({ ...p, body: e.target.value }))}
                placeholder="Message body..."
                rows={6}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  fontSize: '11px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </div>
            <button
              onClick={handleCompose}
              disabled={composing || !composeForm.to.trim() || !composeForm.subject.trim()}
              style={{
                padding: '6px 16px',
                fontSize: '12px',
                background:
                  composeForm.to.trim() && composeForm.subject.trim() ? 'var(--accent-cyan)' : 'var(--bg-tertiary)',
                border: 'none',
                borderRadius: '4px',
                color: composeForm.to.trim() && composeForm.subject.trim() ? '#000' : 'var(--text-muted)',
                cursor: composeForm.to.trim() && composeForm.subject.trim() ? 'pointer' : 'default',
                fontFamily: 'inherit',
                fontWeight: '600',
              }}
            >
              {composing ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        )}

        {/* No features available */}
        {activeTab === 'reach' && rigBridgeOn && !status.patEnabled && !status.gatewayDiscovery && (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
            <div style={{ marginBottom: '8px' }}>Winlink plugin is running but no features are configured.</div>
            <div style={{ fontSize: '11px' }}>
              Set{' '}
              <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: '3px' }}>
                winlink.apiKey
              </code>{' '}
              for gateway discovery or{' '}
              <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: '3px' }}>
                winlink.pat.enabled: true
              </code>{' '}
              for messaging.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WinlinkPanel;
