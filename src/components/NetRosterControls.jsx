/**
 * Net Roster toolbar (#1237, #1239, #1240): the net addresses this station
 * listens on, how the roster is grouped, and which address's roster is shown.
 */
import { useState } from 'react';
import { parseAliasList, MAX_ALIASES } from '../utils/netAliases.js';

const BTN = {
  background: '#1a1f2e',
  border: '1px solid #2a3040',
  borderRadius: '3px',
  color: '#aaa',
  fontSize: '10px',
  padding: '1px 6px',
  cursor: 'pointer',
};

export default function NetRosterControls({ aliases, onAliasesChange, group, onGroupChange, show, onShowChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const startEdit = () => {
    setDraft(aliases.join(', '));
    setError('');
    setEditing(true);
  };
  const save = () => {
    const { aliases: list, invalid } = parseAliasList(draft);
    if (invalid.length) {
      setError(`Not a valid APRS address: ${invalid.join(', ')}`);
      return;
    }
    onAliasesChange(list);
    setEditing(false);
  };

  return (
    <div style={{ padding: '2px 6px 6px', fontSize: '10px', color: '#888' }}>
      {editing ? (
        <div>
          <label htmlFor="net-alias-input" style={{ display: 'block', marginBottom: '3px' }}>
            Net addresses — check-ins (<code>CQ NETNAME status</code>) sent to any of these appear here. A callsign with
            SSID (W8ROC, W8ROC-10) or an alias up to 9 characters; up to {MAX_ALIASES}. Empty = EMCOMM.
          </label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              id="net-alias-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder="EMCOMM, W8ROC"
              autoFocus
              style={{
                flex: 1,
                minWidth: 0,
                background: '#0d1117',
                color: '#ddd',
                border: '1px solid #333',
                borderRadius: '3px',
                fontSize: '11px',
                padding: '2px 4px',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            />
            <button type="button" onClick={save} style={{ ...BTN, color: '#a855f7', borderColor: '#a855f7' }}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} style={BTN}>
              Cancel
            </button>
          </div>
          {error && <div style={{ color: '#ef4444', marginTop: '3px' }}>{error}</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px' }}>
          <span>
            Addresses:{' '}
            <span style={{ color: '#a855f7', fontFamily: 'var(--font-mono, monospace)' }}>{aliases.join(', ')}</span>
          </span>
          <button
            type="button"
            onClick={startEdit}
            style={BTN}
            title="Which APRS addresses this station takes net check-ins from"
          >
            Edit
          </button>
          <span style={{ flex: 1 }} />
          <label>
            Group{' '}
            <select
              value={group}
              onChange={(e) => onGroupChange(e.target.value)}
              style={{ ...BTN, padding: '1px 2px' }}
              aria-label="Group the roster"
            >
              <option value="none">None</option>
              <option value="alias">By address</option>
              <option value="net">By net name</option>
            </select>
          </label>
          {aliases.length > 1 && (
            <label>
              Show{' '}
              <select
                value={aliases.includes(show) ? show : 'all'}
                onChange={(e) => onShowChange(e.target.value)}
                style={{ ...BTN, padding: '1px 2px' }}
                aria-label="Show one address's roster"
              >
                <option value="all">All addresses</option>
                {aliases.map((a) => (
                  <option key={a} value={a}>
                    {a} only
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
