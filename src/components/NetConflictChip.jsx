/**
 * "Your change" chips for Net Control in a shared incident.
 *
 * When another site changed the same station (or net field) at the same
 * moment, their version is kept; ours is held beside the net
 * (incidentNetBridge: loadNetConflicts) so the operator can put it back with
 * one click instead of retyping it, or dismiss it.
 *
 *   StationConflictChip  under a station line
 *   NetConflictBar       above the list: net fields, and stations no longer listed
 */
import { useTranslation } from 'react-i18next';
import { flagsToText } from '../utils/netControl.js';

const CHIP = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  flexWrap: 'wrap',
  marginTop: '2px',
  padding: '1px 4px',
  border: '1px dashed #f59e0b88',
  borderRadius: '3px',
  background: '#f59e0b14',
  color: '#f59e0b',
  fontSize: '9px',
};
const BTN = {
  background: 'transparent',
  border: '1px solid #f59e0b66',
  borderRadius: '3px',
  color: '#f59e0b',
  fontSize: '9px',
  padding: '0 4px',
  cursor: 'pointer',
};

/** Short text for our version of a station line. */
export function describeMine(t, mine) {
  if (!mine) return t('netControl.mineRemoved', { defaultValue: 'removed' });
  const parts = [];
  if (mine.checkoutTime != null) parts.push(t('netControl.mineOut', { defaultValue: 'checked out' }));
  const flags = flagsToText(mine.flags || []);
  if (flags) parts.push(flags);
  if (mine.note) parts.push(mine.note);
  return parts.join(' · ') || t('netControl.mineCheckedIn', { defaultValue: 'checked in' });
}

function Chip({ label, entry, onApply, onDismiss, testId }) {
  const { t } = useTranslation();
  return (
    <div style={CHIP} data-testid={testId}>
      <span>
        {t('netControl.yourChange', {
          defaultValue: 'Your change ({{site}} kept theirs): {{what}}',
          site: entry.site || t('netControl.anotherSite', { defaultValue: 'another site' }),
          what: label,
        })}
      </span>
      <button type="button" style={BTN} onClick={onApply}>
        {t('netControl.applyMine', { defaultValue: 'Apply mine' })}
      </button>
      <button
        type="button"
        style={BTN}
        onClick={onDismiss}
        aria-label={t('netControl.dismissMine', { defaultValue: 'Keep theirs' })}
        title={t('netControl.dismissMine', { defaultValue: 'Keep theirs' })}
      >
        ✕
      </button>
    </div>
  );
}

export function StationConflictChip({ call, entry, onApply, onDismiss }) {
  const { t } = useTranslation();
  return (
    <Chip
      testId={`net-conflict-${call}`}
      label={describeMine(t, entry.mine)}
      entry={entry}
      onApply={onApply}
      onDismiss={onDismiss}
    />
  );
}

/** Net-field conflicts, and conflicting stations that are not on the list any more. */
export function NetConflictBar({ pending, presentCalls, onApply, onDismiss }) {
  const { t } = useTranslation();
  if (!pending) return null;
  const fields = Object.entries(pending.fields || {});
  const missing = Object.entries(pending.calls || {}).filter(([call]) => !presentCalls.has(call));
  if (!fields.length && !missing.length) return null;
  return (
    <div style={{ marginBottom: '4px' }}>
      {fields.map(([field, entry]) => (
        <Chip
          key={`f-${field}`}
          testId={`net-conflict-field-${field}`}
          label={`${field}: ${entry.mine ?? '—'}`}
          entry={entry}
          onApply={() => onApply('field', field)}
          onDismiss={() => onDismiss('field', field)}
        />
      ))}
      {missing.map(([call, entry]) => (
        <Chip
          key={`c-${call}`}
          testId={`net-conflict-${call}`}
          label={`${call} — ${describeMine(t, entry.mine)}`}
          entry={entry}
          onApply={() => onApply('call', call)}
          onDismiss={() => onDismiss('call', call)}
        />
      ))}
    </div>
  );
}
