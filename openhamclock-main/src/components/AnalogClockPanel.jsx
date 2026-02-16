/**
 * AnalogClockPanel Component
 * Displays an analog clock with local time, day/date info, and sunrise/sunset times.
 * Auto-sizes to fit its container.
 */
import React, { useState, useEffect, useRef } from 'react';

export const AnalogClockPanel = ({ currentTime, sunTimes }) => {
  const containerRef = useRef(null);
  const [size, setSize] = useState(200);

  // Auto-size based on container
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        // Use the smaller dimension, leaving room for the info text
        const availableSize = Math.min(width, height) - 60;
        setSize(Math.max(100, availableSize));
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const time = currentTime || new Date();
  const hours = time.getHours();
  const minutes = time.getMinutes();
  const seconds = time.getSeconds();

  // Calculate hand angles
  const secondAngle = (seconds / 60) * 360;
  const minuteAngle = ((minutes + seconds / 60) / 60) * 360;
  const hourAngle = ((hours % 12 + minutes / 60) / 12) * 360;

  // Format date info (already local)
  const dayOfWeek = time.toLocaleDateString([], { weekday: 'short' });
  const monthDate = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

  // Convert UTC sun times to local time
  const utcToLocal = (utcTimeStr) => {
    if (!utcTimeStr || utcTimeStr.includes(' ')) return utcTimeStr; // Handle "Polar night" etc.
    const [h, m] = utcTimeStr.split(':').map(Number);
    const utcDate = new Date();
    utcDate.setUTCHours(h, m, 0, 0);
    return utcDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const localSunrise = sunTimes ? utcToLocal(sunTimes.sunrise) : null;
  const localSunset = sunTimes ? utcToLocal(sunTimes.sunset) : null;

  const clockRadius = size / 2;
  const center = size / 2;

  // Generate tick marks
  const ticks = [];
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 360 - 90;
    const isMajor = i % 5 === 0;
    const outerRadius = clockRadius - 4;
    const innerRadius = isMajor ? clockRadius - 16 : clockRadius - 10;
    const rad = (angle * Math.PI) / 180;

    ticks.push(
      <line
        key={i}
        x1={center + innerRadius * Math.cos(rad)}
        y1={center + innerRadius * Math.sin(rad)}
        x2={center + outerRadius * Math.cos(rad)}
        y2={center + outerRadius * Math.sin(rad)}
        stroke={isMajor ? 'var(--text-primary)' : 'var(--text-muted)'}
        strokeWidth={isMajor ? 2 : 1}
        strokeLinecap="round"
      />
    );
  }

  // Generate hour numbers
  const numbers = [];
  for (let i = 1; i <= 12; i++) {
    const angle = (i / 12) * 360 - 90;
    const rad = (angle * Math.PI) / 180;
    const numRadius = clockRadius - 28;
    numbers.push(
      <text
        key={i}
        x={center + numRadius * Math.cos(rad)}
        y={center + numRadius * Math.sin(rad)}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-primary)"
        fontSize={size > 150 ? 14 : 10}
        fontFamily="JetBrains Mono, monospace"
        fontWeight="600"
      >
        {i}
      </text>
    );
  }

  // Hand component
  const Hand = ({ angle, length, width, color }) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return (
      <line
        x1={center}
        y1={center}
        x2={center + length * Math.cos(rad)}
        y2={center + length * Math.sin(rad)}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  };

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top row: Day of week (left) and Month/Date (right) */}
      <div
        style={{
          width: size,
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '4px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: size > 150 ? '12px' : '10px',
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{dayOfWeek}</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{monthDate}</span>
      </div>

      {/* Clock face */}
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        {/* Outer ring */}
        <circle
          cx={center}
          cy={center}
          r={clockRadius - 2}
          fill="var(--bg-secondary)"
          stroke="var(--border-color)"
          strokeWidth="2"
        />

        {/* Tick marks */}
        {ticks}

        {/* Hour numbers */}
        {numbers}

        {/* LOCAL label */}
        <text
          x={center}
          y={center + clockRadius * 0.32}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--accent-amber)"
          fontSize={size > 150 ? 10 : 8}
          fontFamily="JetBrains Mono, monospace"
          fontWeight="600"
        >
          LOCAL
        </text>

        {/* Hour hand */}
        <Hand
          angle={hourAngle}
          length={clockRadius * 0.5}
          width={4}
          color="var(--text-primary)"
        />

        {/* Minute hand */}
        <Hand
          angle={minuteAngle}
          length={clockRadius * 0.7}
          width={3}
          color="var(--text-primary)"
        />

        {/* Second hand */}
        <Hand
          angle={secondAngle}
          length={clockRadius * 0.8}
          width={1.5}
          color="var(--accent-red, #ef4444)"
        />

        {/* Center dot */}
        <circle cx={center} cy={center} r={4} fill="var(--accent-red, #ef4444)" />
      </svg>

      {/* Bottom row: Sunrise (left) and Sunset (right) - in local time */}
      {sunTimes && (
        <div
          style={{
            width: size,
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '4px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: size > 150 ? '12px' : '10px',
          }}
        >
          <span style={{ color: 'var(--accent-amber)' }}>
            <span style={{ marginRight: '2px' }}>&#9788;</span>
            {localSunrise}
          </span>
          <span style={{ color: 'var(--accent-purple)' }}>
            {localSunset}
            <span style={{ marginLeft: '2px' }}>&#9790;</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default AnalogClockPanel;
