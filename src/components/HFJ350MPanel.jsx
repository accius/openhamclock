import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// Antenna data from the manual
const ANTENNA_DATA = [
  {
    band: "160m",
    freq_range: [1.8, 2.0],
    std_freq: 1.8,
    coil: "Basis + 3.5 Spule + 1.8 Spule",
    jumper: "Kein Jumper",
    length_mm: 1170,
    radial: "> 20m (ideal 40m)",
    change_per_cm: 7, // 7 kHz/cm
    note: "Extrem schmalbandig! Tuner fast immer nötig."
  },
  {
    band: "80m",
    freq_range: [3.5, 3.8],
    std_freq: 3.5,
    coil: "Basis + 3.5 Spule",
    jumper: "Kein Jumper",
    length_mm: 910,
    radial: "ca. 20m",
    change_per_cm: 20, // 20 kHz/cm
    note: ""
  },
  {
    band: "40m",
    freq_range: [7.0, 7.2],
    std_freq: 7.0,
    coil: "Basis (Keine Zusatzspule)",
    jumper: "Kein Jumper",
    length_mm: 960,
    radial: "ca. 12m",
    change_per_cm: 25, // 25 kHz/cm
    note: "Standard-Band für Portable."
  },
  {
    band: "30m",
    freq_range: [10.1, 10.15],
    std_freq: 10.1,
    coil: "Basis",
    jumper: "Terminal 1",
    length_mm: 990,
    radial: "ca. 7-8m",
    change_per_cm: 40, // 40 kHz/cm
    note: ""
  },
  {
    band: "20m",
    freq_range: [14.0, 14.35],
    std_freq: 14.0,
    coil: "Basis",
    jumper: "Terminal 2",
    length_mm: 800,
    radial: "ca. 5m",
    change_per_cm: 60, // 60 kHz/cm
    note: ""
  },
  {
    band: "17m",
    freq_range: [18.068, 18.168],
    std_freq: 18.0,
    coil: "Basis",
    jumper: "Terminal 3 (oder 2)",
    length_mm: 1070,
    radial: "ca. 4m",
    change_per_cm: 50,
    note: "Bei hohem SWR Terminal 2 testen."
  },
  {
    band: "15m",
    freq_range: [21.0, 21.45],
    std_freq: 21.0,
    coil: "Basis",
    jumper: "Terminal 3",
    length_mm: 750,
    radial: "ca. 3.5m",
    change_per_cm: 80, // 80 kHz/cm
    note: ""
  },
  {
    band: "12m",
    freq_range: [24.89, 24.99],
    std_freq: 24.9,
    coil: "Basis",
    jumper: "Terminal 3",
    length_mm: 530,
    radial: "ca. 3m",
    change_per_cm: 100, // 100 kHz/cm
    note: ""
  },
  {
    band: "10m",
    freq_range: [28.0, 29.7],
    std_freq: 28.5,
    coil: "Basis",
    jumper: "Terminal 4",
    length_mm: 1000,
    radial: "ca. 2.5m",
    change_per_cm: 120, // 120 kHz/cm
    note: "Teleskop NICHT voll ausziehen! Reserve ~26cm."
  },
  {
    band: "6m",
    freq_range: [50.0, 52.0],
    std_freq: 51.0,
    coil: "Basis",
    jumper: "Terminal 5",
    length_mm: 950,
    radial: "ca. 1.5m",
    change_per_cm: 100, // 100 kHz/cm
    note: "Achtung: Terminal 5 = Common + 5"
  }
];

export const HFJ350MPanel = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);

  const calculate = (query) => {
    if (!query) {
        setResult(null);
        return;
    }
    const queryStr = String(query).toLowerCase().trim();
    let targetFreq = null;
    let data = null;

    // Check if input is a band name
    data = ANTENNA_DATA.find(d => {
      const bandName = d.band.replace("m", "");
      return queryStr === d.band.toLowerCase() || queryStr === bandName;
    });

    // Check if input is a frequency
    if (!data) {
      const freq = parseFloat(queryStr.replace(',', '.'));
      if (!isNaN(freq)) {
        targetFreq = freq;
        data = ANTENNA_DATA.find(d => {
          const [low, high] = d.freq_range;
          return (low - 0.5) <= freq && freq <= (high + 1.0);
        });
      }
    }

    if (!data) {
      setResult({ error: "Keine Konfiguration gefunden." });
      return;
    }

    let calcLenMm = data.length_mm;
    let diffMm = 0;
    let warning = "";

    if (targetFreq) {
      const diffKhz = (targetFreq - data.std_freq) * 1000;
      const changeCm = diffKhz / data.change_per_cm;
      calcLenMm = Math.round(data.length_mm - (changeCm * 10));

      if (calcLenMm > 1266) {
        warning = "Max überschritten!";
        calcLenMm = 1266;
      } else if (calcLenMm < 100) {
        warning = "Zu kurz!";
        calcLenMm = 100;
      }
      diffMm = calcLenMm - data.length_mm;
    }

    setResult({
      ...data,
      targetFreq,
      calcLenMm,
      diffMm,
      warning
    });
  };

  // Load last input from localStorage on mount
  useEffect(() => {
    const savedInput = localStorage.getItem('hfj350m-last-input');
    if (savedInput) {
      setInput(savedInput);
      calculate(savedInput);
    }
  }, []);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);
    calculate(value);
    localStorage.setItem('hfj350m-last-input', value);
  };

  const renderBar = (len, maxLen = 1266, color = "var(--accent-blue)") => {
    const percent = Math.min(100, Math.max(0, (len / maxLen) * 100));
    return (
      <div style={{ width: '100%', height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', marginTop: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
      </div>
    );
  };

  return (
    <div className="panel hfj350m-panel" style={{ padding: '10px', height: '100%', overflowY: 'auto' }}>
      <div className="panel-header" style={{ marginBottom: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--accent-cyan)' }}>
          📡 HFJ-350M Calculator
        </h3>
      </div>

      <input
        type="text"
        value={input}
        onChange={handleInputChange}
        placeholder="Band (40m) or Freq (7.1)"
        style={{
          width: '100%',
          padding: '8px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
          borderRadius: '4px',
          marginBottom: '10px',
          fontFamily: 'JetBrains Mono, monospace'
        }}
      />

      {result && !result.error && (
        <div style={{ fontSize: '13px' }}>
          <div style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Band:</span>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>{result.band}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Range:</span>
              <span>{result.freq_range[0]} - {result.freq_range[1]} MHz</span>
            </div>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>SETUP</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Coil:</span>
              <span>{result.coil}</span>
              <span style={{ color: 'var(--text-secondary)' }}>Jumper:</span>
              <span style={{ color: 'var(--accent-green)' }}>{result.jumper}</span>
              <span style={{ color: 'var(--text-secondary)' }}>Radial:</span>
              <span>{result.radial}</span>
            </div>
          </div>

          <div style={{ marginBottom: '10px', padding: '8px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>TELESCOPE LENGTH</div>
            
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px' }}>Standard ({result.std_freq} MHz):</span>
                <span style={{ color: 'var(--accent-amber)', fontWeight: 'bold' }}>{result.length_mm} mm</span>
              </div>
              {renderBar(result.length_mm, 1266, 'var(--accent-amber)')}
            </div>

            {result.targetFreq && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px' }}>Calc ({result.targetFreq} MHz):</span>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: 'bold' }}>
                    {result.calcLenMm} mm
                    {result.warning && <span style={{ color: 'var(--accent-red)', marginLeft: '6px' }}>⚠ {result.warning}</span>}
                  </span>
                </div>
                {renderBar(result.calcLenMm, 1266, 'var(--accent-purple)')}
                <div style={{ fontSize: '11px', textAlign: 'right', marginTop: '2px', color: result.diffMm > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  Diff: {result.diffMm > 0 ? '+' : ''}{result.diffMm} mm
                </div>
              </div>
            )}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            <div>Sensitivity: <span style={{ color: 'var(--text-primary)' }}>{result.change_per_cm} kHz/cm</span></div>
            {result.note && <div style={{ color: 'var(--accent-red)', marginTop: '4px' }}>⚠ {result.note}</div>}
          </div>
        </div>
      )}

      {result && result.error && (
        <div style={{ color: 'var(--accent-red)', textAlign: 'center', padding: '10px' }}>
          {result.error}
        </div>
      )}
    </div>
  );
};

export default HFJ350MPanel;
