/**
 * SpotBadge — the award / worked-before label shown next to a call:
 * NEW (entity not in the log), BAND (entity worked, not on this band),
 * DUPE (this call on this band and mode) or ✓ (call worked before).
 * `badge` is the value from utils/awards.js spotBadge(); null renders nothing.
 *
 * Shared by the DX cluster rows and the QSO form's call field so both read
 * the same.
 */
import { useTranslation } from 'react-i18next';

const chip = (color, background, border) => ({
  marginLeft: '4px',
  padding: '0 3px',
  fontSize: '8px',
  fontWeight: '700',
  letterSpacing: '0.5px',
  color,
  background,
  border: `1px solid ${border}`,
  borderRadius: '2px',
  verticalAlign: 'middle',
});

const STYLES = {
  new: chip('#ff4444', 'rgba(255, 68, 68, 0.15)', 'rgba(255, 68, 68, 0.6)'),
  'new-band': chip('#ff8844', 'rgba(255, 136, 68, 0.12)', 'rgba(255, 136, 68, 0.5)'),
  dupe: chip('#ffaa00', 'rgba(255, 170, 0, 0.15)', 'rgba(255, 170, 0, 0.6)'),
  worked: { marginLeft: '4px', fontSize: '9px', color: 'var(--text-muted)', opacity: 0.75, verticalAlign: 'middle' },
};

export function SpotBadge({ badge, style }) {
  const { t } = useTranslation();
  if (!badge || !STYLES[badge]) return null;

  const { label, tooltip } = {
    new: {
      label: t('dxClusterPanel.workedBadge.new', { defaultValue: 'NEW' }),
      tooltip: t('dxClusterPanel.workedBadge.newTooltip', {
        defaultValue: 'New one — this DXCC entity is not in your logbook (ATNO)',
      }),
    },
    'new-band': {
      label: t('dxClusterPanel.workedBadge.newBand', { defaultValue: 'BAND' }),
      tooltip: t('dxClusterPanel.workedBadge.newBandTooltip', {
        defaultValue: 'Entity worked before, but not on this band — new band slot',
      }),
    },
    dupe: {
      label: t('dxClusterPanel.workedBadge.dupe', { defaultValue: 'DUPE' }),
      tooltip: t('dxClusterPanel.workedBadge.dupeTooltip', {
        defaultValue: 'Already in your log on this band and mode — dupe',
      }),
    },
    worked: {
      label: '✓',
      tooltip: t('dxClusterPanel.workedBadge.workedTooltip', {
        defaultValue: 'In your log — worked before on a different band or mode',
      }),
    },
  }[badge];

  return (
    <span title={tooltip} aria-label={tooltip} style={{ ...STYLES[badge], ...style }}>
      {label}
    </span>
  );
}

export default SpotBadge;
