/**
 * Admin routes — health dashboard, update, security.txt.
 * Lines ~9806-10700, 10888-10921 of original server.js
 */

const { formatBytes, formatDuration } = require('../utils/helpers');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = function (app, ctx) {
  const {
    CONFIG,
    APP_VERSION,
    ROOT_DIR,
    logDebug,
    logInfo,
    logWarn,
    logErrorOnce,
    writeLimiter,
    requireWriteAuth,
    endpointStats,
    upstream,
    API_WRITE_KEY,
    visitorStats,
    sessionTracker,
    saveVisitorStats,
    STATS_FILE,
    rolloverVisitorStats,
    autoUpdateState,
    autoUpdateTick,
    hasGitUpdates,
    AUTO_UPDATE_ENABLED,
    WSJTX_ENABLED,
    WSJTX_UDP_PORT,
    WSJTX_RELAY_KEY,
    N1MM_ENABLED,
    N1MM_UDP_PORT,
    pskMqtt,
  } = ctx;

  // ============================================
  // HEALTH CHECK & STATUS DASHBOARD
  // ============================================

  // Generate HTML status dashboard
  function generateStatusDashboard() {
    rolloverVisitorStats();

    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const uptimeStr = `${days}d ${hours}h ${minutes}m`;

    // Calculate time since first deployment
    const firstStart = new Date(visitorStats.serverFirstStarted);
    const trackingDays = Math.floor((Date.now() - firstStart.getTime()) / 86400000);

    const avg =
      visitorStats.history.length > 0
        ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
        : visitorStats.uniqueVisitorsToday;

    // Get last 14 days for the chart
    const chartData = [...visitorStats.history].slice(-14);
    // Add today if we have data
    if (visitorStats.uniqueVisitorsToday > 0) {
      chartData.push({
        date: visitorStats.today,
        uniqueVisitors: visitorStats.uniqueVisitorsToday,
        totalRequests: visitorStats.totalRequestsToday,
      });
    }

    const maxVisitors = Math.max(...chartData.map((d) => d.uniqueVisitors), 1);

    // Generate bar chart
    const bars = chartData
      .map((d) => {
        const height = Math.max((d.uniqueVisitors / maxVisitors) * 100, 2);
        const date = new Date(d.date);
        const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
        const isToday = d.date === visitorStats.today;
        return `
      <div class="bar-container" title="${d.date}: ${d.uniqueVisitors} visitors, ${d.totalRequests} requests">
        <div class="bar ${isToday ? 'today' : ''}" style="height: ${height}%">
          <span class="bar-value">${d.uniqueVisitors}</span>
        </div>
        <div class="bar-label">${dayLabel}</div>
      </div>
    `;
      })
      .join('');

    // Calculate week-over-week growth
    const thisWeek = chartData.slice(-7).reduce((sum, d) => sum + d.uniqueVisitors, 0);
    const lastWeek = chartData.slice(-14, -7).reduce((sum, d) => sum + d.uniqueVisitors, 0);
    const growth = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
    const growthIcon = growth > 0 ? '📈' : growth < 0 ? '📉' : '➡️';
    const growthColor = growth > 0 ? '#00ff88' : growth < 0 ? '#ff4466' : '#888';

    // Get API traffic stats
    const apiStats = endpointStats.getStats();
    const estimatedMonthlyGB =
      apiStats.uptimeHours > 0
        ? (((apiStats.totalBytes / parseFloat(apiStats.uptimeHours)) * 24 * 30) / (1024 * 1024 * 1024)).toFixed(2)
        : '0.00';

    // Get session stats
    const sessionStats = sessionTracker.getStats();

    // Generate API traffic table rows (top 15 by bandwidth)
    const apiTableRows = apiStats.endpoints
      .slice(0, 15)
      .map((ep, i) => {
        const bytesFormatted = formatBytes(ep.totalBytes);
        const avgBytesFormatted = formatBytes(ep.avgBytes);
        const bandwidthBar = Math.min((ep.totalBytes / (apiStats.totalBytes || 1)) * 100, 100);
        return `
      <tr>
        <td style="color: #888">${i + 1}</td>
        <td><code style="color: #00ccff">${ep.path}</code></td>
        <td style="text-align: right">${ep.requests.toLocaleString()}</td>
        <td style="text-align: right">${ep.requestsPerHour}/hr</td>
        <td style="text-align: right; color: #ffb347">${bytesFormatted}</td>
        <td style="text-align: right">${avgBytesFormatted}</td>
        <td style="text-align: right">${ep.avgDuration}ms</td>
        <td style="width: 100px">
          <div style="background: rgba(255,179,71,0.2); border-radius: 4px; height: 8px; width: 100%">
            <div style="background: linear-gradient(90deg, #ffb347, #ff6b35); height: 100%; width: ${bandwidthBar}%; border-radius: 4px"></div>
          </div>
        </td>
      </tr>
    `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>OpenHamClock Status</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', monospace;
      background: linear-gradient(135deg, #0a0f1a 0%, #1a1f2e 50%, #0d1117 100%);
      color: #e2e8f0;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 30px;
      background: rgba(0, 255, 136, 0.05);
      border: 1px solid rgba(0, 255, 136, 0.2);
      border-radius: 16px;
    }
    .logo {
      font-family: 'Orbitron', sans-serif;
      font-size: 2.5rem;
      font-weight: 900;
      background: linear-gradient(135deg, #00ff88, #00ccff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 8px;
    }
    .version {
      color: #00ff88;
      font-size: 1rem;
      opacity: 0.8;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 255, 136, 0.15);
      border: 1px solid rgba(0, 255, 136, 0.4);
      padding: 8px 16px;
      border-radius: 20px;
      margin-top: 15px;
      font-weight: 600;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(0, 255, 136, 0.4); }
      50% { opacity: 0.8; box-shadow: 0 0 0 8px rgba(0, 255, 136, 0); }
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      transition: all 0.3s ease;
    }
    .stat-card:hover {
      border-color: rgba(0, 255, 136, 0.3);
      transform: translateY(-2px);
    }
    .stat-icon { font-size: 1.5rem; margin-bottom: 8px; }
    .stat-value {
      font-family: 'Orbitron', sans-serif;
      font-size: 2rem;
      font-weight: 700;
      color: #00ccff;
      margin-bottom: 4px;
    }
    .stat-value.amber { color: #ffb347; }
    .stat-value.green { color: #00ff88; }
    .stat-value.purple { color: #a78bfa; }
    .stat-label {
      font-size: 0.75rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .chart-section {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .chart-title {
      font-size: 1rem;
      color: #00ff88;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chart-growth {
      font-size: 0.85rem;
      padding: 4px 10px;
      border-radius: 12px;
      background: rgba(0, 255, 136, 0.1);
    }
    .chart {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      height: 150px;
      gap: 8px;
      padding: 10px 0;
    }
    .bar-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
    }
    .bar {
      width: 100%;
      max-width: 40px;
      background: linear-gradient(180deg, #00ccff 0%, #0066cc 100%);
      border-radius: 4px 4px 0 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 4px;
      transition: all 0.3s ease;
      position: relative;
    }
    .bar.today {
      background: linear-gradient(180deg, #00ff88 0%, #00aa55 100%);
    }
    .bar:hover {
      filter: brightness(1.2);
      transform: scaleY(1.02);
    }
    .bar-value {
      position: absolute;
      top: -22px;
      font-size: 0.7rem;
      color: #888;
      font-weight: 600;
    }
    .bar-label {
      font-size: 0.65rem;
      color: #666;
      margin-top: 6px;
      text-transform: uppercase;
    }
    .info-section {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #888; }
    .info-value { color: #e2e8f0; font-weight: 600; }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      color: #555;
      font-size: 0.8rem;
    }
    .footer a {
      color: #00ccff;
      text-decoration: none;
    }
    .footer a:hover { text-decoration: underline; }
    .json-link {
      display: inline-block;
      margin-top: 10px;
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: #888;
      text-decoration: none;
      font-size: 0.75rem;
      transition: all 0.2s;
    }
    .json-link:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
    }
    .api-section {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
      overflow-x: auto;
    }
    .api-title {
      font-size: 1rem;
      color: #e2e8f0;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .api-summary {
      display: flex;
      gap: 24px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .api-stat {
      background: rgba(255, 179, 71, 0.1);
      border: 1px solid rgba(255, 179, 71, 0.3);
      padding: 12px 16px;
      border-radius: 8px;
    }
    .api-stat-value {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.2rem;
      color: #ffb347;
    }
    .api-stat-label {
      font-size: 0.7rem;
      color: #888;
      text-transform: uppercase;
    }
    .api-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .api-table th {
      text-align: left;
      padding: 8px 12px;
      color: #888;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.7rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .api-table td {
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .api-table tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }
    .api-table code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
    }
    @media (max-width: 600px) {
      .logo { font-size: 1.8rem; }
      .stat-value { font-size: 1.5rem; }
      .chart { height: 120px; gap: 4px; }
      .bar-value { font-size: 0.6rem; top: -18px; }
      .api-table { font-size: 0.7rem; }
      .api-summary { gap: 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">📡 OpenHamClock</div>
      <div class="version">v${APP_VERSION}</div>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span>All Systems Operational</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🟢</div>
        <div class="stat-value green">${sessionStats.concurrent}</div>
        <div class="stat-label">Online Now</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">👥</div>
        <div class="stat-value">${visitorStats.uniqueVisitorsToday}</div>
        <div class="stat-label">Visitors Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🌍</div>
        <div class="stat-value amber">${visitorStats.allTimeVisitors.toLocaleString()}</div>
        <div class="stat-label">All-Time Visitors</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-value green">${avg}</div>
        <div class="stat-label">Daily Average</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🏔️</div>
        <div class="stat-value purple">${sessionStats.peakConcurrent}</div>
        <div class="stat-label">Peak Concurrent</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⏱️</div>
        <div class="stat-value purple">${uptimeStr}</div>
        <div class="stat-label">Uptime</div>
      </div>
    </div>

    <!-- Session Duration Analytics -->
    <div class="chart-section">
      <div class="chart-title">
        <span>⏱️ Session Duration Analytics</span>
        <span style="color: #888; font-size: 0.75rem">${sessionStats.completedSessions} completed sessions</span>
      </div>

      <div class="api-summary" style="margin-bottom: 20px">
        <div class="api-stat">
          <div class="api-stat-value" style="color: #00ccff">${sessionStats.avgDurationFormatted || '--'}</div>
          <div class="api-stat-label">Avg Duration</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: #a78bfa">${sessionStats.medianDurationFormatted || '--'}</div>
          <div class="api-stat-label">Median</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: #ffb347">${sessionStats.p90DurationFormatted || '--'}</div>
          <div class="api-stat-label">90th Percentile</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: #00ff88">${sessionStats.maxDurationFormatted || '--'}</div>
          <div class="api-stat-label">Longest</div>
        </div>
      </div>

      <!-- Duration Distribution Bars -->
      ${
        sessionStats.completedSessions > 0
          ? (() => {
              const b = sessionStats.durationBuckets;
              const total = Object.values(b).reduce((s, v) => s + v, 0) || 1;
              const bucketLabels = [
                { key: 'under1m', label: '<1m', color: '#ff4466' },
                { key: '1to5m', label: '1-5m', color: '#ffb347' },
                { key: '5to15m', label: '5-15m', color: '#ffdd00' },
                { key: '15to30m', label: '15-30m', color: '#88cc00' },
                { key: '30to60m', label: '30m-1h', color: '#00ff88' },
                { key: 'over1h', label: '1h+', color: '#00ccff' },
              ];
              return `
          <div style="margin-bottom: 8px; font-size: 0.75rem; color: #888">Session Length Distribution</div>
          <div style="display: flex; gap: 6px; align-items: flex-end; height: 80px; margin-bottom: 4px">
            ${bucketLabels
              .map(({ key, label, color }) => {
                const count = b[key] || 0;
                const pct = Math.max((count / total) * 100, 2);
                return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%" title="${label}: ${count} sessions (${Math.round((count / total) * 100)}%)">
                  <div style="font-size: 0.65rem; color: #888; margin-bottom: 4px">${count}</div>
                  <div style="width: 100%; max-width: 50px; background: ${color}; border-radius: 4px 4px 0 0; height: ${pct}%; min-height: 3px; opacity: 0.85"></div>
                  <div style="font-size: 0.6rem; color: #666; margin-top: 4px">${label}</div>
                </div>
              `;
              })
              .join('')}
          </div>
        `;
            })()
          : '<div style="color: #666; text-align: center; padding: 16px">No completed sessions yet — data will appear as users visit and leave</div>'
      }
    </div>

    <!-- Active Users Table -->
    ${
      sessionStats.activeSessions.length > 0
        ? `
    <div class="api-section">
      <div class="api-title">
        <span>🟢 Active Users (${sessionStats.concurrent})</span>
        <span style="color: #888; font-size: 0.75rem">${sessionStats.peakConcurrentTime ? 'Peak: ' + sessionStats.peakConcurrent + ' at ' + new Date(sessionStats.peakConcurrentTime).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
      <table class="api-table">
        <thead>
          <tr>
            <th>#</th>
            <th style="text-align: right">Session Duration</th>
            <th style="text-align: right">Requests</th>
          </tr>
        </thead>
        <tbody>
          ${sessionStats.activeSessions
            .map(
              (s, i) => `
            <tr>
              <td style="color: #888">${i + 1}</td>
              <td style="text-align: right; color: #00ff88; font-weight: 600">${s.durationFormatted}</td>
              <td style="text-align: right">${s.requests}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    `
        : ''
    }

    <div class="chart-section">
      <div class="chart-title">
        <span>📈 Visitor Trend (${chartData.length} days)</span>
        <span class="chart-growth" style="color: ${growthColor}">${growthIcon} ${growth > 0 ? '+' : ''}${growth}% week/week</span>
      </div>
      <div class="chart">
        ${bars || '<div style="color: #666; text-align: center; width: 100%;">No historical data yet</div>'}
      </div>
    </div>

    <div class="info-section">
      <div class="info-row">
        <span class="info-label">Tracking Since</span>
        <span class="info-value">${new Date(visitorStats.serverFirstStarted).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Days Tracked</span>
        <span class="info-value">${trackingDays} days</span>
      </div>
      <div class="info-row">
        <span class="info-label">Deployment Count</span>
        <span class="info-value">#${visitorStats.deploymentCount}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Last Deployment</span>
        <span class="info-value">${new Date(visitorStats.lastDeployment).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Total Requests</span>
        <span class="info-value">${visitorStats.allTimeRequests.toLocaleString()}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Persistence</span>
        <span class="info-value" style="color: ${STATS_FILE ? '#00ff88' : '#ff4466'}">${STATS_FILE ? '✓ Working' : '✗ Memory Only'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Stats Location</span>
        <span class="info-value" style="font-size: 0.75rem; color: #888">${STATS_FILE || 'Memory only (no writable storage)'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Last Saved</span>
        <span class="info-value">${visitorStats.lastSaved ? new Date(visitorStats.lastSaved).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not yet'}</span>
      </div>
    </div>


    <div class="api-section">
      <div class="api-title">
        <span>📊 API Traffic Monitor</span>
        <span style="color: #888; font-size: 0.75rem">Since last restart (${apiStats.uptimeHours}h ago)</span>
      </div>

      <div class="api-summary">
        <div class="api-stat">
          <div class="api-stat-value">${apiStats.totalRequests.toLocaleString()}</div>
          <div class="api-stat-label">Total Requests</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value">${formatBytes(apiStats.totalBytes)}</div>
          <div class="api-stat-label">Total Egress</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value" style="color: ${parseFloat(estimatedMonthlyGB) > 100 ? '#ff4466' : '#00ff88'}">${estimatedMonthlyGB} GB</div>
          <div class="api-stat-label">Est. Monthly</div>
        </div>
        <div class="api-stat">
          <div class="api-stat-value">${apiStats.endpoints.length}</div>
          <div class="api-stat-label">Active Endpoints</div>
        </div>
      </div>

      ${
        apiStats.endpoints.length > 0
          ? `
      <table class="api-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Endpoint</th>
            <th style="text-align: right">Requests</th>
            <th style="text-align: right">Rate</th>
            <th style="text-align: right">Total</th>
            <th style="text-align: right">Avg Size</th>
            <th style="text-align: right">Avg Time</th>
            <th>Bandwidth</th>
          </tr>
        </thead>
        <tbody>
          ${apiTableRows}
        </tbody>
      </table>
      `
          : '<div style="color: #666; text-align: center; padding: 20px">No API requests recorded yet</div>'
      }
    </div>

    <div class="api-section">
      <h2>🔗 Upstream Services</h2>
      <table>
        <thead><tr><th>Service</th><th>Status</th><th>Backoff</th><th>Consecutive Failures</th><th>In-Flight</th></tr></thead>
        <tbody>
          ${['pskreporter']
            .map((svc) => {
              const backedOff = upstream.isBackedOff(svc);
              const remaining = upstream.backoffRemaining(svc);
              const consecutive = upstream.backoffs.get(svc)?.consecutive || 0;
              const prefix = svc === 'pskreporter' ? ['psk:', 'wspr:'] : ['weather:'];
              const inFlight = [...upstream.inFlight.keys()].filter((k) => prefix.some((p) => k.startsWith(p))).length;
              const label = 'PSKReporter (WSPR Heatmap)';
              return `<tr>
              <td>${label}</td>
              <td style="color: ${backedOff ? '#ff4444' : '#00ff88'}">${backedOff ? '⛔ Backoff' : '✅ OK'}</td>
              <td>${backedOff ? remaining + 's' : '—'}</td>
              <td>${consecutive || '—'}</td>
              <td>${inFlight}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <p style="font-size: 11px; color: #888; margin-top: 8px">
        Weather: client-direct (Open-Meteo, per-user rate limits) · In-flight deduped: ${upstream.inFlight.size}
      </p>

      <h2>📡 PSKReporter MQTT Proxy</h2>
      <table>
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Broker Connection</td><td style="color: ${pskMqtt.connected ? '#00ff88' : '#ff4444'}">${pskMqtt.connected ? '✅ Connected' : '⛔ Disconnected'}</td></tr>
          <tr><td>Active Callsigns</td><td>${pskMqtt.subscribedCalls.size}</td></tr>
          <tr><td>SSE Clients</td><td>${[...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0)}</td></tr>
          <tr><td>Spots Received</td><td>${pskMqtt.stats.spotsReceived.toLocaleString()}</td></tr>
          <tr><td>Spots Relayed</td><td>${pskMqtt.stats.spotsRelayed.toLocaleString()}</td></tr>
          <tr><td>Messages Dropped</td><td>${pskMqtt.stats.messagesDropped}</td></tr>
          <tr><td>Buffered Spots</td><td>${[...pskMqtt.spotBuffer.values()].reduce((n, b) => n + b.length, 0)}</td></tr>
          <tr><td>Recent Spots Cache</td><td>${[...pskMqtt.recentSpots.values()].reduce((n, s) => n + s.length, 0)}</td></tr>
          <tr><td>Last Spot</td><td>${pskMqtt.stats.lastSpotTime ? new Date(pskMqtt.stats.lastSpotTime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—'}</td></tr>
        </tbody>
      </table>
      ${pskMqtt.subscribedCalls.size > 0 ? `<p style="font-size: 11px; color: #888; margin-top: 8px">Subscribed: ${[...pskMqtt.subscribedCalls].join(', ')}</p>` : ''}
    </div>

    <div class="footer">
      <div>🔧 Built with ❤️ for Amateur Radio</div>
      <div style="margin-top: 8px">
        <a href="https://openhamclock.com">openhamclock.com</a> •
        <a href="https://github.com/accius/OpenHamClock">GitHub</a>
      </div>
      <a href="/api/health?format=json" class="json-link">📋 View as JSON</a>
    </div>
  </div>
</body>
</html>`;
  }

  // /.well-known/security.txt — standard security contact disclosure (RFC 9116)
  // Presence of this file signals a legitimate, maintained project to AV scanners
  // and security researchers.
  app.get(['/.well-known/security.txt', '/security.txt'], (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(
      [
        'Contact: https://github.com/accius/openhamclock/security/advisories',
        'Contact: https://github.com/accius/openhamclock/issues',
        'Preferred-Languages: en',
        'Canonical: https://openhamclock.com/.well-known/security.txt',
        `Expires: ${new Date(Date.now() + 365 * 86400000).toISOString()}`,
        '',
        '# OpenHamClock is an open-source amateur radio dashboard.',
        '# Source: https://github.com/accius/openhamclock',
        '# If an antivirus product flagged this site, it is a false positive.',
        '# The app polls its own API endpoints for real-time ham radio data.',
      ].join('\n'),
    );
  });

  app.get('/api/health', (req, res) => {
    rolloverVisitorStats();

    // SECURITY: Check if request is authenticated for full details
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.key || '';
    const isAuthed = API_WRITE_KEY && token === API_WRITE_KEY;

    // Check if browser wants HTML or explicitly requesting JSON
    const wantsJSON =
      req.query.format === 'json' ||
      req.headers.accept?.includes('application/json') ||
      !req.headers.accept?.includes('text/html');

    if (wantsJSON) {
      // JSON response for API consumers
      const avg =
        visitorStats.history.length > 0
          ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
          : visitorStats.uniqueVisitorsToday;

      // Get endpoint monitoring stats
      const apiStats = endpointStats.getStats();

      res.json({
        status: 'ok',
        version: APP_VERSION,
        uptime: process.uptime(),
        uptimeFormatted: `${Math.floor(process.uptime() / 86400)}d ${Math.floor((process.uptime() % 86400) / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
        timestamp: new Date().toISOString(),
        // SECURITY: Only expose file paths and detailed internals to authenticated requests
        persistence: isAuthed
          ? {
              enabled: !!STATS_FILE,
              file: STATS_FILE || null,
              lastSaved: visitorStats.lastSaved,
            }
          : { enabled: !!STATS_FILE },
        // SECURITY: Session details include partially anonymized IPs — only expose to authenticated requests.
        // Unauthenticated requests get aggregate counts only.
        sessions: isAuthed
          ? sessionTracker.getStats()
          : { concurrent: sessionTracker.activeSessions.size, peakConcurrent: sessionTracker.peakConcurrent },
        visitors: {
          today: {
            date: visitorStats.today,
            uniqueVisitors: visitorStats.uniqueVisitorsToday,
            totalRequests: visitorStats.totalRequestsToday,
          },
          allTime: {
            since: visitorStats.serverFirstStarted,
            uniqueVisitors: visitorStats.allTimeVisitors,
            totalRequests: visitorStats.allTimeRequests,
            deployments: visitorStats.deploymentCount,
          },
          dailyAverage: avg,
          history: visitorStats.history.slice(-30),
        },
        apiTraffic: {
          monitoringStarted: new Date(endpointStats.startTime).toISOString(),
          uptimeHours: apiStats.uptimeHours,
          totalRequests: apiStats.totalRequests,
          totalBytes: apiStats.totalBytes,
          totalBytesFormatted: formatBytes(apiStats.totalBytes),
          estimatedMonthlyGB: (
            ((apiStats.totalBytes / parseFloat(apiStats.uptimeHours)) * 24 * 30) /
            (1024 * 1024 * 1024)
          ).toFixed(2),
          endpoints: apiStats.endpoints.slice(0, 20), // Top 20 by bandwidth
        },
        upstream: {
          pskreporter: {
            status: upstream.isBackedOff('pskreporter') ? 'backoff' : 'ok',
            backoffRemaining: upstream.backoffRemaining('pskreporter'),
            consecutive: upstream.backoffs.get('pskreporter')?.consecutive || 0,
            inFlightRequests: [...upstream.inFlight.keys()].filter((k) => k.startsWith('psk:')).length,
          },
          wspr: {
            status: upstream.isBackedOff('wspr') ? 'backoff' : 'ok',
            backoffRemaining: upstream.backoffRemaining('wspr'),
            consecutive: upstream.backoffs.get('wspr')?.consecutive || 0,
            inFlightRequests: [...upstream.inFlight.keys()].filter((k) => k.startsWith('wspr:')).length,
          },
          weather: {
            status: 'client-direct',
            note: 'All weather fetched directly by user browsers from Open-Meteo (per-user rate limits)',
          },
          totalInFlight: upstream.inFlight.size,
          pskMqttProxy: {
            connected: pskMqtt.connected,
            // SECURITY: Only expose active callsigns to authenticated requests
            activeCallsigns: isAuthed ? [...pskMqtt.subscribedCalls] : pskMqtt.subscribedCalls.size,
            sseClients: [...pskMqtt.subscribers.values()].reduce((n, s) => n + s.size, 0),
            spotsReceived: pskMqtt.stats.spotsReceived,
            spotsRelayed: pskMqtt.stats.spotsRelayed,
            messagesDropped: pskMqtt.stats.messagesDropped,
            bufferedSpots: [...pskMqtt.spotBuffer.values()].reduce((n, b) => n + b.length, 0),
            recentSpotsCache: [...pskMqtt.recentSpots.values()].reduce((n, s) => n + s.length, 0),
            lastSpotTime: pskMqtt.stats.lastSpotTime ? new Date(pskMqtt.stats.lastSpotTime).toISOString() : null,
          },
        },
      });
    } else {
      // HTML dashboard for browsers
      res.type('html').send(generateStatusDashboard());
    }
  });

  // ============================================
  // RESET UPSTREAM BACKOFF
  // ============================================
  app.post('/api/admin/reset-backoff', writeLimiter, requireWriteAuth, (req, res) => {
    const service = req.query.service || req.body?.service;
    if (!service) {
      // Reset all backoffs
      upstream.backoffs.clear();
      logInfo('[Admin] All upstream backoffs cleared');
      return res.json({ ok: true, reset: 'all' });
    }
    upstream.resetBackoff(service);
    logInfo(`[Admin] Upstream backoff cleared for: ${service}`);
    res.json({ ok: true, reset: service });
  });

  // ============================================
  // MANUAL UPDATE ENDPOINT
  // ============================================
  app.post('/api/update', writeLimiter, requireWriteAuth, async (req, res) => {
    if (autoUpdateState.inProgress) {
      return res.status(409).json({ error: 'Update already in progress' });
    }

    try {
      if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) {
        return res.status(503).json({ error: 'Not a git repository' });
      }
      await new Promise((resolve, reject) => {
        execFile('git', ['--version'], (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      return res.status(500).json({ error: 'Update preflight failed: ' + (err.message || 'git not found') });
    }

    // Respond immediately; update runs asynchronously
    res.json({ ok: true, started: true, timestamp: Date.now() });

    setTimeout(() => {
      autoUpdateTick('manual', true);
    }, 100);
  });

  app.get('/api/update/status', (req, res) => {
    res.json({
      enabled: AUTO_UPDATE_ENABLED,
      inProgress: autoUpdateState.inProgress,
      lastCheck: autoUpdateState.lastCheck,
      lastResult: autoUpdateState.lastResult,
    });
  });
};
