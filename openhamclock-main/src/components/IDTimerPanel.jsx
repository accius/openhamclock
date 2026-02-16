/**
 * IDTimerPanel Component
 * 10-minute countdown timer that alerts the operator to identify their callsign.
 * When the timer expires, plays a beep and shows a modal reminder.
 * Dismissing the reminder resets and restarts the countdown.
 * Start/Stop button lets operators pause when not on the air.
 * Dockable layout only.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

const ID_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Generate a short beep using Web Audio API
const playBeep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.4;
    osc.start();
    // Three short beeps
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.setValueAtTime(0, now + 0.12);
    gain.gain.setValueAtTime(0.4, now + 0.2);
    gain.gain.setValueAtTime(0, now + 0.32);
    gain.gain.setValueAtTime(0.4, now + 0.4);
    gain.gain.setValueAtTime(0, now + 0.52);
    osc.stop(now + 0.55);
    setTimeout(() => ctx.close(), 700);
  } catch (e) {
    // Audio not available — silent fallback
  }
};

const formatTime = (ms) => {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

export const IDTimerPanel = ({ callsign }) => {
  const [remaining, setRemaining] = useState(ID_INTERVAL_MS);
  const [active, setActive] = useState(false); // starts stopped — user enables when on the air
  const [showAlert, setShowAlert] = useState(false);
  const endTimeRef = useRef(null);
  const timerRef = useRef(null);
  const hasBeepedRef = useRef(false);
  // How much time was left when we paused (for resume)
  const pausedRemainingRef = useRef(ID_INTERVAL_MS);

  const reset = useCallback(() => {
    hasBeepedRef.current = false;
    endTimeRef.current = Date.now() + ID_INTERVAL_MS;
    pausedRemainingRef.current = ID_INTERVAL_MS;
    setRemaining(ID_INTERVAL_MS);
    setShowAlert(false);
    setActive(true);
  }, []);

  const start = useCallback(() => {
    hasBeepedRef.current = false;
    // Resume from where we paused, or full reset if expired
    const resumeMs = pausedRemainingRef.current > 0 ? pausedRemainingRef.current : ID_INTERVAL_MS;
    endTimeRef.current = Date.now() + resumeMs;
    setRemaining(resumeMs);
    setShowAlert(false);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    // Snapshot how much time is left so we can resume later
    if (endTimeRef.current) {
      pausedRemainingRef.current = Math.max(0, endTimeRef.current - Date.now());
    }
    setActive(false);
  }, []);

  const toggle = useCallback(() => {
    if (active) stop(); else start();
  }, [active, start, stop]);

  // Tick loop — only runs when active
  useEffect(() => {
    if (!active) {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      const left = endTimeRef.current - Date.now();
      if (left <= 0) {
        setRemaining(0);
        pausedRemainingRef.current = 0;
        setActive(false);
        if (!hasBeepedRef.current) {
          hasBeepedRef.current = true;
          playBeep();
          setShowAlert(true);
        }
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(timerRef.current);
  }, [active]);

  const pct = Math.max(0, Math.min(100, (remaining / ID_INTERVAL_MS) * 100));
  const urgent = active && remaining < 60000; // last minute
  const expired = remaining <= 0;
  const barColor = !active && !expired ? '#555' : urgent ? '#ff4444' : '#44cc44';

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Header */}
      <div className="panel-header" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '6px',
        fontSize: '11px'
      }}>
        <span>📢 ID TIMER</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={toggle}
            title={active ? 'Stop timer (off the air)' : 'Start timer (on the air)'}
            style={{
              background: active ? 'rgba(255, 68, 68, 0.25)' : 'rgba(68, 204, 68, 0.25)',
              border: `1px solid ${active ? '#ff4444' : '#44cc44'}`,
              color: active ? '#ff4444' : '#44cc44',
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '9px',
              fontFamily: 'JetBrains Mono',
              cursor: 'pointer'
            }}
          >
            {active ? '■ Stop' : '▶ Start'}
          </button>
          <button
            onClick={reset}
            title="Reset to 10:00 and start"
            style={{
              background: 'rgba(100, 100, 100, 0.3)',
              border: '1px solid #666',
              color: '#aaa',
              padding: '1px 6px',
              borderRadius: '3px',
              fontSize: '9px',
              fontFamily: 'JetBrains Mono',
              cursor: 'pointer'
            }}
          >
            ↺
          </button>
        </div>
      </div>

      {/* Countdown display */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
        <div style={{
          fontSize: '32px',
          fontWeight: '900',
          fontFamily: 'Orbitron, JetBrains Mono, monospace',
          color: expired ? '#ff4444' : !active ? '#555' : urgent ? '#ff4444' : 'var(--text-primary, #eee)',
          letterSpacing: '2px',
          animation: expired ? 'idBlink 0.6s ease-in-out infinite' : (urgent ? 'idPulse 1s ease-in-out infinite' : 'none')
        }}>
          {formatTime(remaining)}
        </div>

        {/* Progress bar */}
        <div style={{
          width: '100%',
          height: '6px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            borderRadius: '3px',
            transition: 'width 0.3s linear, background 0.3s'
          }} />
        </div>

        <div style={{ fontSize: '9px', color: 'var(--text-muted, #888)', fontFamily: 'JetBrains Mono, monospace' }}>
          {expired ? 'TIME TO ID!' : !active ? 'Stopped — press Start when on the air' : 'Next station ID'}
        </div>
      </div>

      {/* Alert overlay */}
      {showAlert && (
        <div
          onClick={reset}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 99999,
            cursor: 'pointer'
          }}
        >
          <div
            onClick={(e) => { e.stopPropagation(); reset(); }}
            style={{
              background: '#1a1a2e',
              border: '3px solid #ff4444',
              borderRadius: '12px',
              padding: '32px 48px',
              textAlign: 'center',
              boxShadow: '0 0 40px rgba(255, 68, 68, 0.4)',
              animation: 'idBlink 0.6s ease-in-out infinite',
              cursor: 'pointer',
              maxWidth: '90vw'
            }}
          >
            <div style={{ fontSize: '18px', color: '#ff4444', marginBottom: '12px', fontWeight: '700' }}>
              📢 IDENTIFY YOUR STATION
            </div>
            <div style={{
              fontSize: '36px',
              fontWeight: '900',
              fontFamily: 'Orbitron, JetBrains Mono, monospace',
              color: '#ff4444',
              letterSpacing: '3px',
              marginBottom: '16px'
            }}>
              {callsign || 'N0CALL'}
            </div>
            <div style={{ fontSize: '13px', color: '#888', fontFamily: 'JetBrains Mono, monospace' }}>
              Click anywhere to reset timer
            </div>
          </div>
        </div>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes idBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes idPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};

export default IDTimerPanel;
