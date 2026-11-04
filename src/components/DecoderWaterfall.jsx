/**
 * DecoderWaterfall — live spectrum + waterfall of the Decoder's audio, drawn
 * from a Web Audio AnalyserNode onto one canvas, with a tunable passband
 * marker. Click (or arrow keys) to move the decoder's tone.
 *
 * Cheap by design: ~20 frames/s, one 1-pixel row scrolled per frame, device
 * pixels capped at 1:1, and the loop stops entirely while the panel is not
 * visible (inactive tab / scrolled away / browser tab hidden).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const FRAME_MS = 50;
const SPECTRUM_H = 34;

/** value in [min, max] → [r,g,b] on a dark-blue → cyan → yellow → red ramp. */
export function waterfallColor(db, min = -110, max = -30) {
  const x = Math.max(0, Math.min(1, (db - min) / (max - min)));
  const stops = [
    [0, [6, 10, 30]],
    [0.35, [10, 60, 140]],
    [0.6, [0, 200, 220]],
    [0.8, [250, 230, 60]],
    [1, [255, 60, 40]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const f = (x - x0) / (x1 - x0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f));
    }
  }
  return stops[stops.length - 1][1];
}

// 256-entry colour ramp so the draw loop allocates nothing
const LUT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) lut.set(waterfallColor(i, 0, 255), i * 3);
  return lut;
})();

export default function DecoderWaterfall({
  getAnalyser,
  sampleRate,
  running,
  tone,
  bandwidth,
  maxHz = 2000,
  onTune,
  height = 120,
}) {
  const { t } = useTranslation();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(true);
  const [width, setWidth] = useState(300);

  // Visibility: inactive dock tabs are display:none → not intersecting
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let inView = true;
    const update = () => setVisible(inView && document.visibilityState !== 'hidden');
    let io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        inView = entries.some((e) => e.isIntersecting);
        update();
      });
      io.observe(el);
    }
    document.addEventListener('visibilitychange', update);
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  // Size the canvas to its box (1 canvas px per CSS px)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = Math.max(100, Math.round(entries[0].contentRect.width));
      setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !running || !visible) return undefined;
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) return undefined;
    let raf = 0;
    let last = 0;
    let bins = null;
    let row = null;
    const levels = new Float32Array(canvas.width);
    // Colour scale follows the noise floor: floor ≈ 20 % up the ramp, +50 dB = top
    let floor = null;
    const w = canvas.width;
    const h = canvas.height;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      const analyser = getAnalyser?.();
      if (!analyser || !sampleRate) return;
      if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const hzPerBin = sampleRate / analyser.fftSize;
      if (!row) row = g.createImageData(w, 1);

      // Waterfall: scroll the area below the spectrum down one pixel
      g.drawImage(canvas, 0, SPECTRUM_H, w, h - SPECTRUM_H - 1, 0, SPECTRUM_H + 1, w, h - SPECTRUM_H - 1);
      let sum = 0;
      for (let x = 0; x < w; x++) {
        // Max over the bins this pixel covers
        const f0 = (x / w) * maxHz;
        const f1 = ((x + 1) / w) * maxHz;
        let b0 = Math.floor(f0 / hzPerBin);
        const b1 = Math.max(b0, Math.min(bins.length - 1, Math.floor(f1 / hzPerBin)));
        let m = -200;
        for (; b0 <= b1; b0++) if (bins[b0] > m) m = bins[b0];
        levels[x] = Number.isFinite(m) ? Math.max(-160, m) : -160;
        sum += levels[x];
      }
      const mean = sum / w;
      floor = floor === null ? mean : floor + (mean - floor) * 0.05;
      const lo = floor - 10;
      const span = 50;
      for (let x = 0; x < w; x++) {
        const li = Math.max(0, Math.min(255, Math.round(((levels[x] - lo) / span) * 255))) * 3;
        const i = x * 4;
        row.data[i] = LUT[li];
        row.data[i + 1] = LUT[li + 1];
        row.data[i + 2] = LUT[li + 2];
        row.data[i + 3] = 255;
      }
      g.putImageData(row, 0, SPECTRUM_H);

      // Spectrum strip
      g.fillStyle = '#05080f';
      g.fillRect(0, 0, w, SPECTRUM_H);
      g.strokeStyle = '#3fd0ff';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x < w; x++) {
        const y = SPECTRUM_H - 2 - Math.max(0, Math.min(1, (levels[x] - lo) / (span + 10))) * (SPECTRUM_H - 4);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, visible, getAnalyser, sampleRate, maxHz, width, height]);

  const bw = typeof bandwidth === 'number' && bandwidth > 0 ? bandwidth : 100;
  const left = Math.max(0, ((tone - bw / 2) / maxHz) * 100);
  const markerWidth = Math.max(0.6, (bw / maxHz) * 100);

  const tuneFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const hz = Math.round(((e.clientX - rect.left) / rect.width) * maxHz);
    if (hz > 100 && hz < maxHz) onTune?.(hz);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.shiftKey ? 50 : 10;
      onTune?.(Math.max(150, Math.min(maxHz - 50, tone + (e.key === 'ArrowLeft' ? -step : step))));
    }
  };

  return (
    <div
      ref={wrapRef}
      role="slider"
      tabIndex={0}
      aria-label={t('decoder.waterfall.aria', { defaultValue: 'Audio waterfall — click or use arrow keys to tune' })}
      aria-valuemin={0}
      aria-valuemax={maxHz}
      aria-valuenow={tone}
      aria-valuetext={`${tone} Hz`}
      onClick={tuneFromEvent}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        height,
        flexShrink: 0,
        background: '#05080f',
        border: '1px solid var(--border-color)',
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'crosshair',
      }}
      title={t('decoder.waterfall.title', { defaultValue: 'Click a trace to tune the decoder to it' })}
    >
      <canvas ref={canvasRef} width={width} height={height} style={{ display: 'block', width: '100%', height }} />
      {/* Passband marker */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${left}%`,
          width: `${markerWidth}%`,
          background: 'rgba(255, 200, 0, 0.12)',
          borderLeft: '1px solid rgba(255, 200, 0, 0.7)',
          borderRight: '1px solid rgba(255, 200, 0, 0.7)',
          pointerEvents: 'none',
        }}
      />
      {/* Scale */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 4px',
          fontSize: 9,
          color: 'rgba(255,255,255,0.55)',
          fontFamily: 'var(--font-mono)',
          pointerEvents: 'none',
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{Math.round(f * maxHz)}</span>
        ))}
      </div>
      {!running && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            pointerEvents: 'none',
          }}
        >
          {t('decoder.waterfall.idle', { defaultValue: 'Press Start to listen' })}
        </div>
      )}
    </div>
  );
}
