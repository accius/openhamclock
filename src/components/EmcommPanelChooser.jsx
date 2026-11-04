/**
 * EmComm sidebar: pick which panels are shown and switch between named
 * sets of them (#1241). Lives in the sidebar's panel toolbar.
 */
import { useState } from 'react';
import { EMCOMM_PANELS, BUILTIN_SETS, allSets, activeSetName, togglePanel } from '../utils/emcommPanelSets.js';

const BTN = {
  background: 'transparent',
  color: '#888',
  border: '1px solid #333',
  borderRadius: '3px',
  fontSize: '10px',
  padding: '1px 6px',
  cursor: 'pointer',
};

export function PanelSetSelect({ state, onChange }) {
  const sets = allSets(state);
  const active = activeSetName(state);
  return (
    <select
      value={active || '__custom'}
      onChange={(e) => {
        const name = e.target.value;
        if (name in sets) onChange({ ...state, hidden: [...sets[name]] });
      }}
      aria-label="Panel set"
      title="Which panels the sidebar shows"
      style={{
        background: '#1a1a1a',
        color: '#ccc',
        border: '1px solid #333',
        borderRadius: '3px',
        fontSize: '10px',
        padding: '1px 4px',
        maxWidth: '130px',
      }}
    >
      {!active && <option value="__custom">Custom</option>}
      {Object.keys(sets).map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

export default function EmcommPanelChooser({ state, onChange, onClose }) {
  const [error, setError] = useState('');
  const hidden = new Set(state.hidden);
  const active = activeSetName(state);
  const savedNames = Object.keys(state.sets || {});

  const saveAs = () => {
    const name = window.prompt(
      'Name this set of panels (e.g. "Shelter desk"):',
      active && !(active in BUILTIN_SETS) ? active : '',
    );
    if (name == null) return;
    const n = name.trim().slice(0, 40);
    if (!n) return;
    if (n in BUILTIN_SETS) {
      setError(`"${n}" is a built-in set — pick another name`);
      return;
    }
    setError('');
    onChange({ ...state, sets: { ...state.sets, [n]: [...state.hidden] } });
  };
  const remove = (name) => {
    const { [name]: _gone, ...rest } = state.sets || {};
    onChange({ ...state, sets: rest });
  };

  return (
    <div
      data-testid="emcomm-panel-chooser"
      style={{
        background: '#0d0d0d',
        border: '1px solid #333',
        borderRadius: '6px',
        padding: '8px 10px',
        fontSize: '11px',
        color: '#aaa',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ color: '#ccc', fontWeight: 600 }}>Panels shown</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose} style={BTN}>
          Done
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '2px 10px' }}>
        {EMCOMM_PANELS.map((p) => (
          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
            <input type="checkbox" checked={!hidden.has(p)} onChange={() => onChange(togglePanel(state, p))} />
            {p}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px', marginTop: '8px' }}>
        <button type="button" onClick={() => onChange({ ...state, hidden: [] })} style={BTN}>
          Show all
        </button>
        <button type="button" onClick={saveAs} style={{ ...BTN, color: '#22d3ee', borderColor: '#22d3ee55' }}>
          Save as set…
        </button>
        {savedNames.map((name) => (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', color: '#888' }}>
            {name}
            <button
              type="button"
              onClick={() => remove(name)}
              aria-label={`Delete the set ${name}`}
              title={`Delete the set "${name}"`}
              style={{ ...BTN, border: 'none', color: '#ef4444', padding: '0 3px' }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      {error && <div style={{ color: '#ef4444', marginTop: '4px' }}>{error}</div>}
    </div>
  );
}
