'use strict';
/**
 * plugins/mock.js — Simulated radio plugin
 *
 * Provides a fully functional fake radio for development and testing
 * without any physical hardware. Starts on 14.074 MHz (FT8) in USB mode
 * and slowly drifts the frequency to make the live status display visibly
 * active. All set commands are reflected back into state immediately.
 *
 * Enable by setting radio.type = "mock" in rig-bridge-config.json,
 * or via the setup UI (select "Simulated Radio").
 */

// Bands to drift through during simulation (freq in Hz, mode)
const SIM_WAYPOINTS = [
  { freq: 14074000, mode: 'USB' }, // 20m FT8
  { freq: 7074000, mode: 'USB' }, //  40m FT8
  { freq: 21074000, mode: 'USB' }, // 15m FT8
  { freq: 14225000, mode: 'USB' }, // 20m SSB
  { freq: 3573000, mode: 'USB' }, //  80m FT8
  { freq: 28074000, mode: 'USB' }, // 10m FT8
];

module.exports = {
  id: 'mock',
  name: 'Simulated Radio (Mock)',
  category: 'rig',
  configKey: 'radio',

  create(config, { updateState, state }) {
    let tickTimer = null;
    let waypointIndex = 0;
    let waypointTimer = null;

    function connect() {
      console.log('[Mock] Simulation mode active — no hardware required');

      // Set initial state
      updateState('connected', true);
      updateState('freq', SIM_WAYPOINTS[0].freq);
      updateState('mode', SIM_WAYPOINTS[0].mode);
      updateState('width', 2800);
      updateState('ptt', false);

      // Keep lastUpdate ticking so SSE clients stay warm
      tickTimer = setInterval(() => {
        state.lastUpdate = Date.now();
      }, 1000);

      // Slowly cycle through waypoints so the status display looks alive
      function scheduleNextWaypoint() {
        const interval =
          config.radio && config.radio.pollInterval ? Math.max(config.radio.pollInterval * 20, 10000) : 15000;

        waypointTimer = setTimeout(() => {
          waypointIndex = (waypointIndex + 1) % SIM_WAYPOINTS.length;
          const wp = SIM_WAYPOINTS[waypointIndex];
          updateState('freq', wp.freq);
          updateState('mode', wp.mode);
          console.log(`[Mock] Drifted to ${(wp.freq / 1e6).toFixed(3)} MHz ${wp.mode}`);
          scheduleNextWaypoint();
        }, interval);
      }

      scheduleNextWaypoint();
    }

    function disconnect() {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      if (waypointTimer) {
        clearTimeout(waypointTimer);
        waypointTimer = null;
      }
      updateState('connected', false);
      console.log('[Mock] Simulation stopped');
    }

    function setFreq(hz) {
      const freq = parseInt(hz);
      console.log(`[Mock] SET FREQ: ${(freq / 1e6).toFixed(6)} MHz`);
      updateState('freq', freq);
    }

    function setMode(mode) {
      console.log(`[Mock] SET MODE: ${mode}`);
      updateState('mode', mode);
    }

    function setPTT(on) {
      console.log(`[Mock] SET PTT: ${on ? 'TX' : 'RX'}`);
      updateState('ptt', !!on);
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
