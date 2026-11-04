/**
 * DecoderFt8Table — the Decoder panel's FT8 tab: one row per decode, newest
 * slot first. CQ calls are highlighted, every callsign opens the callsign
 * popup, the calling station gets the same worked-before / needed badge as a
 * DX cluster spot, and ＋ keeps it in My decodes.
 */
import { useTranslation } from 'react-i18next';
import CallsignLink from './CallsignLink.jsx';
import SpotBadge from './SpotBadge.jsx';
import { slotLabel } from '../utils/ft8Dsp.js';

const cell = { padding: '2px 4px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' };

/** Render a message with its callsigns as CallsignLinks. */
function MessageText({ d, onPopup, spotFor }) {
  const toks = String(d.text || '').split(/(\s+)/);
  return (
    <>
      {toks.map((tok, i) => {
        const call = tok.replace(/[<>]/g, '');
        if (d.calls?.includes(call)) {
          return (
            <CallsignLink
              key={i}
              call={call}
              onPopup={onPopup}
              spot={spotFor(d)}
              color={call === d.de ? 'var(--accent-cyan)' : 'var(--text-primary)'}
              fontWeight={call === d.de ? 700 : 400}
            >
              {tok}
            </CallsignLink>
          );
        }
        // keep "R-09" and friends in one piece when the column wraps
        return (
          <span key={i} style={{ whiteSpace: /\S/.test(tok) ? 'nowrap' : undefined }}>
            {tok}
          </span>
        );
      })}
    </>
  );
}

/**
 * @param {{ slots: Array<{ slotStartMs: number, decodes: Array }>, onPopup: Function,
 *           dialKhz: number|null, badgeFor: (call: string, freqMHz: number|null) => string|null,
 *           onLog: (d: object) => void, cqOnly: boolean }} props
 */
export default function DecoderFt8Table({ slots, onPopup, dialKhz, badgeFor, onLog, cqOnly }) {
  const { t } = useTranslation();
  const freqMHzOf = (d) => (dialKhz ? dialKhz / 1000 + d.freq / 1e6 : null);
  const spotFor = (d) => (dialKhz ? { freq: dialKhz + d.freq / 1000, mode: 'FT8' } : { mode: 'FT8' });

  const rows = [];
  for (const s of slots) {
    for (const d of s.decodes) {
      if (cqOnly && !d.cq) continue;
      rows.push({ ...d, slotStartMs: s.slotStartMs });
    }
  }
  if (!rows.length) return null;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
          <th style={cell}>{t('decoder.ft8.utc', { defaultValue: 'UTC' })}</th>
          <th style={{ ...cell, textAlign: 'right' }}>dB</th>
          <th style={{ ...cell, textAlign: 'right' }}>DT</th>
          <th style={{ ...cell, textAlign: 'right' }}>Hz</th>
          <th style={cell}>{t('decoder.ft8.message', { defaultValue: 'Message' })}</th>
          <th style={cell} aria-label={t('decoder.log', { defaultValue: 'Add to My decodes' })} />
        </tr>
      </thead>
      <tbody>
        {rows.map((d, i) => (
          <tr
            key={`${d.slotStartMs}-${d.freq}-${i}`}
            style={{
              background: d.cq ? 'color-mix(in srgb, var(--accent-green) 14%, transparent)' : undefined,
              borderTop:
                i > 0 && rows[i - 1].slotStartMs !== d.slotStartMs ? '1px solid var(--border-color)' : undefined,
            }}
          >
            <td style={{ ...cell, color: 'var(--text-muted)' }}>{slotLabel(d.slotStartMs)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{d.snr > 0 ? `+${d.snr}` : d.snr}</td>
            <td style={{ ...cell, textAlign: 'right', color: 'var(--text-muted)' }}>{Number(d.dt).toFixed(1)}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{d.freq}</td>
            <td style={{ ...cell, whiteSpace: 'normal' }}>
              <MessageText d={d} onPopup={onPopup} spotFor={spotFor} />
              {d.de && <SpotBadge badge={badgeFor(d.de, freqMHzOf(d))} />}
            </td>
            <td style={cell}>
              {d.de && (
                <button
                  type="button"
                  onClick={() => onLog(d)}
                  title={t('decoder.log', { defaultValue: 'Add to My decodes' })}
                  style={{
                    padding: '0 4px',
                    fontSize: 11,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  ＋
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
