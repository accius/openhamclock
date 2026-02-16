/**
 * DX Spider Telnet Proxy Service
 * 
 * A microservice that maintains a persistent telnet connection to DX Spider,
 * accumulates spots, and serves them via HTTP API.
 * 
 * Designed to run on Railway as a standalone service.
 */

const net = require('net');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  // DX Spider nodes to try (in order)
  nodes: [
    { host: 'dxspider.co.uk', port: 7300, name: 'DX Spider UK (G6NHU)' },
    { host: 'dxc.nc7j.com', port: 7373, name: 'NC7J' },
    { host: 'dxc.ai9t.com', port: 7373, name: 'AI9T' },
    { host: 'dxc.w6cua.org', port: 7300, name: 'W6CUA' }
  ],
  // Callsign with SSID - use env var as-is, or default to OPENHAMCLOCK-56
  // Set CALLSIGN=YOURCALL-56 for production, CALLSIGN=YOURCALL-57 for staging
  callsign: process.env.CALLSIGN || 'OPENHAMCLOCK-56',
  spotRetentionMs: 30 * 60 * 1000, // 30 minutes
  reconnectDelayMs: 10000, // 10 seconds between reconnect attempts
  maxReconnectAttempts: 3,
  cleanupIntervalMs: 60000, // 1 minute
  keepAliveIntervalMs: 120000 // 2 minutes - send keepalive
};

// State
let spots = [];
let client = null;
let connected = false;
let connecting = false;  // NEW: Prevent concurrent connection attempts
let currentNode = null;
let currentNodeIndex = 0;
let reconnectAttempts = 0;
let lastSpotTime = null;
let totalSpotsReceived = 0;
let connectionStartTime = null;
let buffer = '';
let reconnectTimer = null;
let keepAliveTimer = null;

// Logging helper with log levels
// LOG_LEVEL: 'debug' = verbose, 'info' = normal, 'warn' = warnings+errors only
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

// Map log categories to levels
const CATEGORY_LEVELS = {
  'SPOT': 'debug',     // Per-spot logging is debug-only
  'CLEANUP': 'debug',  // Periodic cleanup is debug-only
  'KEEPALIVE': 'debug', // Keepalive pings are debug-only
  'CMD': 'debug',      // Command logging is debug-only
  'AUTH': 'info',      // Auth events are informational
  'CONNECT': 'info',   // Connection events are informational
  'CLOSE': 'info',
  'RECONNECT': 'info',
  'FAILOVER': 'info',
  'API': 'info',
  'START': 'info',
  'CONFIG': 'info',
  'SHUTDOWN': 'info',
  'ERROR': 'warn',
  'TIMEOUT': 'warn',
};

const log = (level, message, data = null) => {
  const categoryLevel = LOG_LEVELS[CATEGORY_LEVELS[level] || 'info'] ?? LOG_LEVELS.info;
  if (categoryLevel < currentLogLevel) return;
  
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}`;
  if (data) {
    console.log(logLine, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(logLine);
  }
};

// Parse a DX spot line from telnet
// Format: DX de SPOTTER: FREQ DXCALL comment time
const parseSpotLine = (line) => {
  try {
    // Match: DX de W3ABC:     14025.0  JA1XYZ       CW 599           1234Z
    const match = line.match(/^DX de\s+([A-Z0-9/]+):\s+(\d+\.?\d*)\s+([A-Z0-9/]+)\s+(.*)$/i);
    
    if (!match) return null;
    
    const spotter = match[1].toUpperCase();
    const freqKhz = parseFloat(match[2]);
    const dxCall = match[3].toUpperCase();
    let comment = match[4].trim();
    
    // Extract time from end of comment (format: 1234Z or 1234z)
    let time = '';
    const timeMatch = comment.match(/(\d{4})[Zz]\s*$/);
    if (timeMatch) {
      time = timeMatch[1].substring(0, 2) + ':' + timeMatch[1].substring(2, 4) + 'z';
      comment = comment.replace(/\d{4}[Zz]\s*$/, '').trim();
    } else {
      // Use current UTC time
      const now = new Date();
      time = String(now.getUTCHours()).padStart(2, '0') + ':' + 
             String(now.getUTCMinutes()).padStart(2, '0') + 'z';
    }
    
    // Detect mode from comment
    let mode = null;
    const upperComment = comment.toUpperCase();
    if (upperComment.includes('FT8')) mode = 'FT8';
    else if (upperComment.includes('FT4')) mode = 'FT4';
    else if (upperComment.includes('CW')) mode = 'CW';
    else if (upperComment.includes('SSB') || upperComment.includes('USB') || upperComment.includes('LSB')) mode = 'SSB';
    else if (upperComment.includes('RTTY')) mode = 'RTTY';
    else if (upperComment.includes('PSK')) mode = 'PSK';
    else if (upperComment.includes('FM')) mode = 'FM';
    else if (upperComment.includes('AM')) mode = 'AM';
    
    // Extract grid squares from comment
    // Pattern: Look for 4 or 6 char grids, possibly in format "GRID1<>GRID2" or "GRID1->GRID2"
    let spotterGrid = null;
    let dxGrid = null;
    
    // Check for dual grid format: FN20<>EM79 or FN20->EM79 or FN20/EM79
    const dualGridMatch = comment.match(/\b([A-R]{2}[0-9]{2}(?:[A-X]{2})?)\s*(?:<>|->|\/|<)\s*([A-R]{2}[0-9]{2}(?:[A-X]{2})?)\b/i);
    if (dualGridMatch) {
      spotterGrid = dualGridMatch[1].toUpperCase();
      dxGrid = dualGridMatch[2].toUpperCase();
    } else {
      // Look for single grid - assume it's the DX station
      const singleGridMatch = comment.match(/\b([A-R]{2}[0-9]{2}(?:[A-X]{2})?)\b/i);
      if (singleGridMatch) {
        const grid = singleGridMatch[1].toUpperCase();
        // Validate it's a real grid (not something like "CQ00")
        const firstChar = grid.charCodeAt(0);
        const secondChar = grid.charCodeAt(1);
        if (firstChar >= 65 && firstChar <= 82 && secondChar >= 65 && secondChar <= 82) {
          dxGrid = grid;
        }
      }
    }
    
    return {
      spotter,
      spotterGrid,
      freq: (freqKhz / 1000).toFixed(3), // Convert kHz to MHz string
      freqKhz,
      call: dxCall,
      dxGrid,
      comment,
      time,
      mode,
      timestamp: Date.now(),
      source: 'DX Spider'
    };
  } catch (err) {
    log('ERROR', 'Failed to parse spot line', { line, error: err.message });
    return null;
  }
};

// Add a spot to the accumulator
const addSpot = (spot) => {
  if (!spot) return;
  
  // Check for duplicate (same call + freq within 2 minutes)
  const isDuplicate = spots.some(existing =>
    existing.call === spot.call &&
    existing.freq === spot.freq &&
    (spot.timestamp - existing.timestamp) < 120000
  );
  
  if (!isDuplicate) {
    spots.unshift(spot); // Add to beginning (newest first)
    totalSpotsReceived++;
    lastSpotTime = new Date();
    log('SPOT', `${spot.call} on ${spot.freq} MHz by ${spot.spotter}`);
  }
};

// Clean up old spots
const cleanupSpots = () => {
  const cutoff = Date.now() - CONFIG.spotRetentionMs;
  const before = spots.length;
  spots = spots.filter(s => s.timestamp > cutoff);
  const removed = before - spots.length;
  if (removed > 0) {
    log('CLEANUP', `Removed ${removed} expired spots, ${spots.length} remaining`);
  }
};

// Connect to DX Spider
const connect = () => {
  // Prevent concurrent connection attempts
  if (connecting) {
    log('CONNECT', 'Connection attempt already in progress, skipping');
    return;
  }
  
  connecting = true;
  
  // Clear any pending reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  // Clean up existing client without triggering reconnect
  if (client) {
    try {
      client.removeAllListeners(); // Remove listeners BEFORE destroy to prevent close->reconnect loop
      client.destroy();
    } catch (e) {}
    client = null;
  }
  
  const node = CONFIG.nodes[currentNodeIndex];
  currentNode = node;
  
  log('CONNECT', `Attempting connection to ${node.name} (${node.host}:${node.port})`);
  
  client = new net.Socket();
  client.setTimeout(60000); // 60 second timeout
  
  client.connect(node.port, node.host, () => {
    connected = true;
    connecting = false;
    reconnectAttempts = 0;
    connectionStartTime = new Date();
    buffer = '';
    log('CONNECT', `Connected to ${node.name}`);
    
    // Send login after short delay
    setTimeout(() => {
      if (client && connected) {
        client.write(CONFIG.callsign + '\r\n');
        log('AUTH', `Sent callsign: ${CONFIG.callsign}`);
        
        // After login, enable DX spot announcements
        setTimeout(() => {
          if (client && connected) {
            // Request recent spots first
            client.write('sh/dx 30\r\n');
            log('CMD', 'Sent: sh/dx 30');
            
            // Then enable the spot stream (some nodes need this)
            setTimeout(() => {
              if (client && connected) {
                client.write('set/dx\r\n');
                log('CMD', 'Sent: set/dx (enable spot stream)');
              }
            }, 2000);
          }
        }, 2000);
      }
    }, 1000);
    
    // Start keepalive
    startKeepAlive();
  });
  
  client.on('data', (data) => {
    buffer += data.toString();
    
    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check if it's a DX spot
      if (trimmed.startsWith('DX de ')) {
        const spot = parseSpotLine(trimmed);
        if (spot) {
          addSpot(spot);
        }
      }
    }
  });
  
  client.on('timeout', () => {
    log('TIMEOUT', 'Connection timed out');
    connecting = false;
    handleDisconnect();
  });
  
  client.on('error', (err) => {
    log('ERROR', `Connection error: ${err.message}`);
    connecting = false;
    handleDisconnect();
  });
  
  client.on('close', () => {
    if (connected) {
      log('CLOSE', 'Connection closed');
    }
    connecting = false;
    handleDisconnect();
  });
};

// Start keepalive timer
const startKeepAlive = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }
  
  keepAliveTimer = setInterval(() => {
    if (client && connected) {
      try {
        // Send a harmless command to keep connection alive
        client.write('\r\n');
        log('KEEPALIVE', 'Sent keepalive');
      } catch (e) {
        log('ERROR', 'Keepalive failed', e.message);
      }
    }
  }, CONFIG.keepAliveIntervalMs);
};

// Handle disconnection and reconnection
const handleDisconnect = () => {
  // Prevent re-entrant calls
  if (!connected && !connecting && reconnectTimer) {
    return; // Already disconnected and reconnect scheduled
  }
  
  connected = false;
  connecting = false;
  
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  
  // Don't schedule another reconnect if one is already pending
  if (reconnectTimer) {
    return;
  }
  
  reconnectAttempts++;
  
  if (reconnectAttempts >= CONFIG.maxReconnectAttempts) {
    // Try next node
    currentNodeIndex = (currentNodeIndex + 1) % CONFIG.nodes.length;
    reconnectAttempts = 0;
    log('FAILOVER', `Switching to node: ${CONFIG.nodes[currentNodeIndex].name}`);
  }
  
  log('RECONNECT', `Attempting reconnect in ${CONFIG.reconnectDelayMs}ms (attempt ${reconnectAttempts})`);
  
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, CONFIG.reconnectDelayMs);
};

// ============================================
// HTTP API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connected,
    currentNode: currentNode?.name || 'none',
    spotsInMemory: spots.length,
    totalSpotsReceived,
    lastSpotTime: lastSpotTime?.toISOString() || null,
    connectionUptime: connectionStartTime ? 
      Math.floor((Date.now() - connectionStartTime.getTime()) / 1000) + 's' : null,
    uptime: process.uptime() + 's'
  });
});

// Get spots
app.get('/api/spots', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const since = parseInt(req.query.since) || 0; // Timestamp filter
  
  let filteredSpots = spots;
  
  // Filter by timestamp if provided
  if (since > 0) {
    filteredSpots = spots.filter(s => s.timestamp > since);
  }
  
  res.json({
    spots: filteredSpots.slice(0, limit),
    total: filteredSpots.length,
    connected,
    source: currentNode?.name || 'disconnected',
    timestamp: Date.now()
  });
});

// Get spots in simple format (for compatibility with existing DX cluster endpoint)
app.get('/api/dxcluster/spots', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  
  const formattedSpots = spots.slice(0, limit).map(s => ({
    spotter: s.spotter,
    freq: s.freq,
    call: s.call,
    comment: s.comment,
    time: s.time,
    mode: s.mode,
    source: 'DX Spider Proxy'
  }));
  
  res.json(formattedSpots);
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  // Calculate spots per band
  const bandCounts = {};
  let spotsWithDxGrid = 0;
  let spotsWithSpotterGrid = 0;
  
  spots.forEach(s => {
    if (s.dxGrid) spotsWithDxGrid++;
    if (s.spotterGrid) spotsWithSpotterGrid++;
    
    const freq = s.freqKhz;
    let band = 'other';
    if (freq >= 1800 && freq <= 2000) band = '160m';
    else if (freq >= 3500 && freq <= 4000) band = '80m';
    else if (freq >= 7000 && freq <= 7300) band = '40m';
    else if (freq >= 10100 && freq <= 10150) band = '30m';
    else if (freq >= 14000 && freq <= 14350) band = '20m';
    else if (freq >= 18068 && freq <= 18168) band = '17m';
    else if (freq >= 21000 && freq <= 21450) band = '15m';
    else if (freq >= 24890 && freq <= 24990) band = '12m';
    else if (freq >= 26500 && freq <= 27500) band = '11m';  // CB band
    else if (freq >= 28000 && freq <= 29700) band = '10m';
    else if (freq >= 50000 && freq <= 54000) band = '6m';
    
    bandCounts[band] = (bandCounts[band] || 0) + 1;
  });
  
  // Calculate spots per mode
  const modeCounts = {};
  spots.forEach(s => {
    const mode = s.mode || 'unknown';
    modeCounts[mode] = (modeCounts[mode] || 0) + 1;
  });
  
  res.json({
    connected,
    currentNode: currentNode?.name || 'none',
    totalSpots: spots.length,
    totalReceived: totalSpotsReceived,
    spotsWithDxGrid,
    spotsWithSpotterGrid,
    lastSpotTime: lastSpotTime?.toISOString() || null,
    retentionMinutes: CONFIG.spotRetentionMs / 60000,
    bandCounts,
    modeCounts
  });
});

// Debug endpoint - show spots with grids
app.get('/api/debug/grids', (req, res) => {
  const spotsWithGrids = spots.filter(s => s.dxGrid || s.spotterGrid).slice(0, 20);
  const allGrids = spots.slice(0, 50).map(s => ({
    call: s.call,
    spotter: s.spotter,
    dxGrid: s.dxGrid || null,
    spotterGrid: s.spotterGrid || null,
    comment: s.comment
  }));
  
  res.json({
    totalSpots: spots.length,
    spotsWithDxGrid: spots.filter(s => s.dxGrid).length,
    spotsWithSpotterGrid: spots.filter(s => s.spotterGrid).length,
    spotsWithAnyGrid: spots.filter(s => s.dxGrid || s.spotterGrid).length,
    sampleSpotsWithGrids: spotsWithGrids,
    recentSpots: allGrids
  });
});

// Force reconnect
app.post('/api/reconnect', (req, res) => {
  log('API', 'Force reconnect requested');
  handleDisconnect();
  res.json({ status: 'reconnecting' });
});

// Switch node
app.post('/api/switch-node', (req, res) => {
  const { index } = req.body;
  if (typeof index === 'number' && index >= 0 && index < CONFIG.nodes.length) {
    currentNodeIndex = index;
    reconnectAttempts = 0;
    log('API', `Switching to node index ${index}: ${CONFIG.nodes[index].name}`);
    handleDisconnect();
    res.json({ status: 'switching', node: CONFIG.nodes[index].name });
  } else {
    res.status(400).json({ error: 'Invalid node index', availableNodes: CONFIG.nodes.map(n => n.name) });
  }
});

// List available nodes
app.get('/api/nodes', (req, res) => {
  res.json({
    nodes: CONFIG.nodes.map((n, i) => ({
      index: i,
      name: n.name,
      host: n.host,
      port: n.port,
      active: i === currentNodeIndex
    })),
    currentIndex: currentNodeIndex
  });
});

// ============================================
// STARTUP
// ============================================

const PORT = process.env.PORT || 3001;

// Start cleanup interval
setInterval(cleanupSpots, CONFIG.cleanupIntervalMs);

// Start server
app.listen(PORT, () => {
  log('START', `DX Spider Proxy listening on port ${PORT}`);
  log('CONFIG', `Callsign: ${CONFIG.callsign}`);
  log('CONFIG', `Spot retention: ${CONFIG.spotRetentionMs / 60000} minutes`);
  log('CONFIG', `Available nodes: ${CONFIG.nodes.map(n => n.name).join(', ')}`);
  
  // Connect to DX Spider
  connect();
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log('SHUTDOWN', 'Received SIGTERM, shutting down...');
  if (client) {
    client.destroy();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SHUTDOWN', 'Received SIGINT, shutting down...');
  if (client) {
    client.destroy();
  }
  process.exit(0);
});
