import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRig } from "../contexts/RigContext";

const RigControlPanel = () => {
  const { t } = useTranslation();
  const {
    connected,
    enabled,
    freq,
    mode,
    ptt,
    setFreq,
    setMode,
    setPTT,
    error,
    tuneTo,
  } = useRig();
  const [inputFreq, setInputFreq] = useState("");

  // Format frequency to MHz (e.g., 14.074.000)
  const formatFreq = (f) => {
    if (!f) return "---.---.---";
    return (f / 1000000).toFixed(6);
  };

  const handleSubmitFreq = (e) => {
    e.preventDefault();
    if (inputFreq) {
      // tuneTo handles parsing (MHz/kHz/Hz) and sets mode automatically via band plan
      tuneTo(inputFreq);
      setInputFreq("");
    }
  };

  // Determine status
  let statusColor = "red";
  let statusTitle = t("app.rigControl.disconnected");

  if (!enabled) {
    statusColor = "grey";
    statusTitle = t("app.rigControl.disabled");
  } else if (connected) {
    statusColor = "green";
    statusTitle = t("app.rigControl.connected");
  }

  return (
    <div className="panel rig-control-panel">
      <div className="panel-header">
        <h3>
          <span className="icon">📻</span> {t("app.rigControl.title")}
        </h3>
        <div className="panel-controls">
          <span className={`status-led ${statusColor}`} title={statusTitle} />
        </div>
      </div>

      <div className="panel-content">
        {error && (
          <div className="error-banner">{t("app.rigControl.error.daemon")}</div>
        )}

        <div className="rig-display">
          <div className={`frequency-readout ${ptt ? "transmitting" : ""}`}>
            {formatFreq(freq)}{" "}
            <span className="unit">{t("app.units.mhz")}</span>
          </div>
          <div className="mode-badge">{mode || "---"}</div>
        </div>

        <div className="rig-controls">
          <form onSubmit={handleSubmitFreq} className="flex-row">
            <input
              type="number"
              step="0.0001"
              placeholder={t("app.rigControl.setFreqPlaceholder")}
              value={inputFreq}
              onChange={(e) => setInputFreq(e.target.value)}
              disabled={!enabled}
            />
            <button type="submit" disabled={!enabled}>
              {t("app.rigControl.set")}
            </button>
          </form>

          <div className="ptt-control">
            <button
              className={`ptt-btn ${ptt ? "active" : ""}`}
              onMouseDown={() => setPTT(true)}
              onMouseUp={() => setPTT(false)}
              onTouchStart={() => setPTT(true)}
              onTouchEnd={() => setPTT(false)}
              disabled={!enabled}
            >
              {t("app.rigControl.ptt")}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        .rig-control-panel .rig-display {
            background: var(--bg-primary);
            color: var(--accent-green);
            font-family: 'Digital-7', monospace;
            padding: 1rem;
            border-radius: 4px;
            margin-bottom: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border: 1px solid var(--border-color);
        }
        .frequency-readout {
            font-size: 2rem;
            font-weight: bold;
        }
        .frequency-readout.transmitting {
            color: var(--accent-red);
            text-shadow: 0 0 10px var(--accent-red);
        }
        .mode-badge {
            background: var(--bg-secondary);
            color: var(--text-primary);
            padding: 2px 8px;
            border-radius: 4px;
            font-family: sans-serif;
            font-size: 1.2rem;
        }
        .rig-controls {
            display: flex;
            gap: 1rem;
            flex-direction: column;
        }
        .flex-row {
            display: flex;
            gap: 0.5rem;
        }
        .flex-row input {
            flex: 1;
            padding: 8px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
        }
        .ptt-btn {
            width: 100%;
            padding: 1rem;
            font-weight: bold;
            background: var(--bg-tertiary);
            border: none;
            color: var(--text-primary);
            cursor: pointer;
            border-radius: 4px;
        }
        .ptt-btn.active {
            background: var(--accent-red);
            box-shadow: 0 0 15px var(--accent-red);
        }
        .status-led {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
        }
        .status-led.green { background: var(--accent-green); box-shadow: 0 0 5px var(--accent-green); }
        .status-led.red { background: var(--accent-red); box-shadow: 0 0 5px var(--accent-red); }
        .status-led.grey { background: var(--text-muted); box-shadow: none; }
        .error-banner {
            background: var(--accent-red);
            color: #fff;
            padding: 0.5rem;
            text-align: center;
            margin-bottom: 0.5rem;
            font-size: 0.8rem;
        }
      `}</style>
    </div>
  );
};

export default RigControlPanel;
