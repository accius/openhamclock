#!/usr/bin/env node
/**
 * OpenHamClock Rig Control Daemon
 *
 * Bridges a local rigctld (TCP) OR flrig (XML-RPC) instance
 * to a local HTTP API that the OpenHamClock frontend can consume directly.
 *
 * Usages:
 *   node rig-daemon.js --type rigctld --rig-host 127.0.0.1 --rig-port 4532 --http-port 5555
 *   node rig-daemon.js --type flrig   --rig-host 127.0.0.1 --rig-port 12345 --http-port 5555
 */

const express = require("express");
const cors = require("cors");
const net = require("net");
const xmlrpc = require("xmlrpc");

// Configuration Defaults
const fs = require("fs");
const path = require("path");

let CONFIG = {
  server: { host: "0.0.0.0", port: 5555 },
  radio: {
    type: "rigctld",
    host: "127.0.0.1",
    rigPort: 4532,
    pollInterval: 1000,
    pttEnabled: false,
  },
};

// Load Config File
const configPath = path.join(__dirname, "rig-config.json");
if (fs.existsSync(configPath)) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log(`[Config] Loaded configuration from ${configPath}`);

    // Merge Server Config
    if (fileConfig.server) {
      CONFIG.server = { ...CONFIG.server, ...fileConfig.server };
    }

    // Merge Radio Config
    if (fileConfig.radio) {
      CONFIG.radio = { ...CONFIG.radio, ...fileConfig.radio };
      // Map 'port' from config to 'rigPort' internal key if needed, or unify keys
      if (fileConfig.radio.port) CONFIG.radio.rigPort = fileConfig.radio.port;
    }
  } catch (e) {
    console.error(`[Config] Error loading ${configPath}:`, e.message);
  }
}

// Legacy CLI Args (Prioritize over config file if provided)
const ARGS = process.argv.slice(2);
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] === "--type") CONFIG.radio.type = ARGS[++i];
  if (ARGS[i] === "--rig-host") CONFIG.radio.host = ARGS[++i];
  if (ARGS[i] === "--rig-port") CONFIG.radio.rigPort = parseInt(ARGS[++i]);
  if (ARGS[i] === "--http-port") CONFIG.server.port = parseInt(ARGS[++i]);
}

// Adjust default port if flrig and not manually set (heuristic)
if (
  CONFIG.radio.type === "flrig" &&
  CONFIG.radio.rigPort === 4532 &&
  !process.argv.includes("--rig-port") &&
  !fs.existsSync(configPath)
) {
  CONFIG.radio.rigPort = 12345;
}

console.log(`[Config] Type: ${CONFIG.radio.type}`);
console.log(`[Config] Rig: ${CONFIG.radio.host}:${CONFIG.radio.rigPort}`);
console.log(`[Config] HTTP: ${CONFIG.server.port}`);

// State
const state = {
  freq: 0,
  mode: "",
  width: 0,
  ptt: false,
  connected: false,
  lastUpdate: 0,
};

const getTuneDelay = () => {
  const parsed = Number(CONFIG?.radio?.tuneDelay);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
};

// SSE Clients
let clients = [];

// Broadcast helper
const broadcast = (data) => {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((c) => c.res.write(msg));
};

// ==========================================
// ADAPTER: RIGCTLD (TCP)
// ==========================================
const RigaAdapter = {
  socket: null,
  queue: [],
  pending: null,

  init: () => {
    RigaAdapter.connect();
    // Poll loop
    setInterval(() => {
      if (!state.connected || CONFIG.radio.type !== "rigctld") return;
      RigaAdapter.send("f");
      RigaAdapter.send("m");
      RigaAdapter.send("t");
    }, CONFIG.radio.pollInterval);
  },

  connect: () => {
    if (RigaAdapter.socket) return;
    console.log(
      `[Rigctld] Connecting to ${CONFIG.radio.host}:${CONFIG.radio.rigPort}...`,
    );
    const s = new net.Socket();
    s.connect(CONFIG.radio.rigPort, CONFIG.radio.host, () => {
      console.log("[Rigctld] Connected");
      state.connected = true;
      RigaAdapter.socket = s;
    });
    s.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        RigaAdapter.handleResponse(line.trim());
      }
    });
    s.on("close", () => {
      console.log("[Rigctld] Disconnected");
      state.connected = false;
      RigaAdapter.socket = null;
      setTimeout(RigaAdapter.connect, 5000);
    });
    s.on("error", (err) => {
      console.error(`[Rigctld] Error: ${err.message}`);
      s.destroy();
    });
  },

  send: (cmd, cb) => {
    if (!RigaAdapter.socket) {
      if (cb) cb(new Error("Not connected"));
      return;
    }
    RigaAdapter.queue.push({ cmd, cb });
    RigaAdapter.process();
  },

  process: () => {
    if (
      RigaAdapter.pending ||
      RigaAdapter.queue.length === 0 ||
      !RigaAdapter.socket
    )
      return;
    const req = RigaAdapter.queue.shift();
    RigaAdapter.pending = req;
    RigaAdapter.socket.write(req.cmd + "\n");
  },

  handleResponse: (line) => {
    if (!RigaAdapter.pending) return;
    const req = RigaAdapter.pending;
    RigaAdapter.pending = null;

    if (req.cmd === "f" || req.cmd.startsWith("F")) {
      const newFreq = parseInt(line);
      if (newFreq !== state.freq) {
        state.freq = newFreq;
        broadcast({ type: "update", prop: "freq", value: state.freq });
      }
    } else if (req.cmd === "m" || req.cmd.startsWith("M")) {
      const parts = line.split(" ");
      const newMode = parts[0];
      const newWidth = parseInt(parts[1] || "0");

      if (newMode !== state.mode || newWidth !== state.width) {
        state.mode = newMode;
        state.width = newWidth;
        broadcast({ type: "update", prop: "mode", value: state.mode });
      }
    } else if (req.cmd === "t" || req.cmd.startsWith("T")) {
      const newPTT = line === "1";
      if (newPTT !== state.ptt) {
        state.ptt = newPTT;
        broadcast({ type: "update", prop: "ptt", value: state.ptt });
      }
    }

    if (req.cb) req.cb(null, line);
    state.lastUpdate = Date.now();
    RigaAdapter.process();
  },
};

// ==========================================
// ADAPTER: FLRIG (XML-RPC)
// ==========================================
const FlrigAdapter = {
  client: null,

  init: () => {
    FlrigAdapter.client = xmlrpc.createClient({
      host: CONFIG.radio.host,
      port: CONFIG.radio.rigPort,
      path: "/",
    });
    state.connected = true; // Assume connected as it's connectionless (HTTP), validation happens on poll
    console.log("[Flrig] Client initialized (XML-RPC is connectionless)");

    // Poll loop
    setInterval(FlrigAdapter.poll, CONFIG.radio.pollInterval);

    // FEATURE: Log supported modes
    FlrigAdapter.client.methodCall("rig.get_modes", [], (err, val) => {
      if (!err && val) {
        console.log("[Flrig] Supported Modes:", val);
      } else if (err) {
        console.warn("[Flrig] Could not fetch modes:", err.message);
      }
    });
  },

  poll: () => {
    // Get Freq
    FlrigAdapter.client.methodCall("rig.get_vfo", [], (err, val) => {
      if (err) {
        if (state.connected) console.error("[Flrig] Poll Error:", err.message);
        state.connected = false;
      } else {
        if (!state.connected) {
          state.connected = true;
          broadcast({ type: "update", prop: "connected", value: true });
        }
        const newFreq = parseFloat(val);
        if (newFreq !== state.freq) {
          state.freq = newFreq;
          broadcast({ type: "update", prop: "freq", value: state.freq });
        }
        state.lastUpdate = Date.now();
      }
    });
    // Get Mode
    FlrigAdapter.client.methodCall("rig.get_mode", [], (err, val) => {
      if (!err && val !== state.mode) {
        state.mode = val;
        broadcast({ type: "update", prop: "mode", value: state.mode });
      }
    });
    // Get PTT
    FlrigAdapter.client.methodCall("rig.get_ptt", [], (err, val) => {
      if (!err) {
        const newPTT = !!val;
        if (newPTT !== state.ptt) {
          state.ptt = newPTT;
          broadcast({ type: "update", prop: "ptt", value: state.ptt });
        }
      }
    });
  },

  setFreq: (freq, cb) => {
    // flrig expects a double. If we pass an integer (e.g. 14000000),
    // the xmlrpc lib sends <int> and flrig throws a type error.
    // We add a tiny fraction to force <double> serialization.
    FlrigAdapter.client.methodCall(
      "rig.set_frequency",
      [parseFloat(freq) + 0.1],
      cb,
    );
  },

  setMode: (mode, cb) => {
    // flrig set_mode just takes mode string
    FlrigAdapter.client.methodCall("rig.set_mode", [mode], cb);
  },

  setPTT: (ptt, cb) => {
    // flrig set_ptt takes integer 0 or 1
    FlrigAdapter.client.methodCall("rig.set_ptt", [ptt ? 1 : 0], cb);
  },

  tune: () => {
    console.log("[Flrig] Sending Tune command...");
    // Try rig.tune first
    FlrigAdapter.client.methodCall("rig.tune", [1], (err, _val) => {
      if (err) {
        console.warn(
          "[Flrig] rig.tune failed, trying fallback (PTT toggle):",
          err.message,
        );
        // Fallback: Toggle PTT if TUNE command not supported/failed
        FlrigAdapter.setPTT(true, () => {
          const delay = getTuneDelay();
          setTimeout(() => {
            FlrigAdapter.setPTT(false, () => {
              console.log("[Flrig] Fallback Tune (PTT) completed");
            });
          }, delay); // Transmit for configured duration
        });
      } else {
        console.log("[Flrig] Tune command sent successfully");
        // If rig.tune is momentary, we might need to turn it off?
        // Usually tune starts a cycle. Let's assume it triggers the tuner.
      }
    });
  },
};

// ==========================================
// ADAPTER: UNIFIED API
// ==========================================

// ==========================================
// ADAPTER: MOCK (SIMULATION)
// ==========================================
const MockAdapter = {
  init: () => {
    console.log("[Mock] Initializing Simulation Mode...");
    state.connected = true;
    state.freq = 14074000;
    state.mode = "USB";
    state.width = 2400;
    state.ptt = false;
    state.lastUpdate = Date.now();

    // Simulate polling updates (just keeping timestamp fresh)
    setInterval(() => {
      state.lastUpdate = Date.now();
    }, 1000);
  },

  setFreq: (freq, cb) => {
    console.log(`[Mock] SET FREQ: ${freq}`);
    state.freq = parseInt(freq);
    broadcast({ type: "update", prop: "freq", value: state.freq });
    if (cb) cb(null);
  },

  setMode: (mode, cb) => {
    console.log(`[Mock] SET MODE: ${mode}`);
    state.mode = mode;
    broadcast({ type: "update", prop: "mode", value: state.mode });
    if (cb) cb(null);
  },

  setPTT: (ptt, cb) => {
    console.log(`[Mock] SET PTT: ${ptt}`);
    state.ptt = !!ptt;
    broadcast({ type: "update", prop: "ptt", value: state.ptt });
    if (cb) cb(null);
  },

  tune: () => {
    console.log("[Mock] TUNE COMMAND RECEIVED");
    console.log("[Mock] Simulating tuner cycle (3s)...");
    setTimeout(() => {
      console.log("[Mock] TUNE COMPLETED");
    }, 3000);
  },
};

// ==========================================
// UNIFIED API
// ==========================================

// Initialize selected adapter
// Initialize selected adapter
if (CONFIG.radio.type === "flrig") {
  FlrigAdapter.init();
} else if (CONFIG.radio.type === "mock") {
  MockAdapter.init();
} else {
  RigaAdapter.init();
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/status", (_req, res) => {
  res.json({
    connected: state.connected,
    freq: state.freq,
    mode: state.mode,
    width: state.width,
    ptt: state.ptt,
    timestamp: state.lastUpdate,
  });
});

app.get("/stream", (req, res) => {
  // SSE Headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial state
  const initialData = {
    type: "init",
    connected: state.connected,
    freq: state.freq,
    mode: state.mode,
    width: state.width,
    ptt: state.ptt,
  };
  res.write(`data: ${JSON.stringify(initialData)}\n\n`);

  // Add client
  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  // Cleanup on close
  req.on("close", () => {
    clients = clients.filter((c) => c.id !== clientId);
  });
});

app.post("/freq", (req, res) => {
  const { freq } = req.body;
  if (!freq) return res.status(400).json({ error: "Missing freq" });

  console.log(`[API] Setting Freq: ${freq}`);

  if (CONFIG.radio.type === "flrig") {
    FlrigAdapter.setFreq(freq, (err, _val) => {
      if (err) return res.status(500).json({ error: err.message });

      // Poll update immediately
      setTimeout(FlrigAdapter.poll, 100);

      // Handle delayed Tune if requested
      if (req.body.tune) {
        const delay = getTuneDelay();
        console.log(`[API] Tune requested, scheduling for ${delay}ms...`);
        setTimeout(() => {
          FlrigAdapter.tune();
        }, delay);
      }

      res.json({ success: true });
    });
  } else if (CONFIG.radio.type === "mock") {
    MockAdapter.setFreq(freq, (_err) => {
      if (req.body.tune) MockAdapter.tune();
      res.json({ success: true });
    });
  } else {
    RigaAdapter.send(`F ${freq}`, (err, _val) => {
      if (err) return res.status(500).json({ error: err.message });
      setTimeout(() => RigaAdapter.send("f"), 100);
      res.json({ success: true });
    });
  }
});

app.post("/mode", (req, res) => {
  const { mode } = req.body;
  if (!mode) return res.status(400).json({ error: "Missing mode" });

  // passband is optional, default usually 2400 for SSB (only used for rigctld)
  const passband = req.body.passband || 0;
  console.log(`[API] Setting Mode: ${mode}`);

  if (CONFIG.radio.type === "flrig") {
    FlrigAdapter.setMode(mode, (err, _val) => {
      if (err) return res.status(500).json({ error: err.message });
      setTimeout(FlrigAdapter.poll, 100);
      res.json({ success: true });
    });
  } else if (CONFIG.radio.type === "mock") {
    MockAdapter.setMode(mode, (_err) => {
      res.json({ success: true });
    });
  } else {
    RigaAdapter.send(`M ${mode} ${passband}`, (err, _val) => {
      if (err) return res.status(500).json({ error: err.message });
      setTimeout(() => RigaAdapter.send("m"), 100);
      res.json({ success: true });
    });
  }
});

app.post("/ptt", (req, res) => {
  const { ptt } = req.body;

  if (ptt && !CONFIG.radio.pttEnabled) {
    console.warn(
      `[API] PTT request BLOCKED by configuration (pttEnabled: false)`,
    );
    return res.status(403).json({ error: "PTT disabled in configuration" });
  }

  console.log(`[API] Setting PTT: ${ptt}`);

  if (CONFIG.radio.type === "flrig") {
    FlrigAdapter.setPTT(ptt, (err, _val) => {
      if (err) return res.status(500).json({ error: err.message });
      state.ptt = !!ptt;
      res.json({ success: true });
    });
  } else if (CONFIG.radio.type === "mock") {
    MockAdapter.setPTT(ptt, (_err) => {
      res.json({ success: true });
    });
  } else {
    const cmd = ptt ? "T 1" : "T 0";
    RigaAdapter.send(cmd, (err, _val) => {
      if (err) return res.status(500).json({ error: err.message });
      state.ptt = !!ptt;
      res.json({ success: true });
    });
  }
});

app.listen(CONFIG.server.port, CONFIG.server.host, () => {
  console.log(`[HTTP] Rig Daemon listening on port ${CONFIG.server.port}`);
  console.log(`[HTTP] CORS enabled for all origins`);
  console.log(
    `[HTTP] Connects to ${CONFIG.radio.type} at ${CONFIG.radio.host}:${CONFIG.radio.rigPort}`,
  );
});
