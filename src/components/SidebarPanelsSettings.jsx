/**
 * Settings → Display: show/hide and resize the Modern layout's sidebar panels.
 *
 * ModernLayout already honours config.panels.<id>.visible and, in the right
 * column, config.panels.<id>.size (a flex weight), but only the DX target
 * panel had a switch anywhere. Hiding DXpeditions/POTA/Contests or giving
 * PSK Reporter a bigger share of the column needed a hand-edited config
 * (#1272). Controlled: SettingsPanel keeps the draft and saves it with the
 * rest of the tab (an instant save would reset the panel's other unsaved
 * fields, which re-read config whenever it changes).
 *
 * Left-column panels stack in a scrolling column, so they get show/hide only.
 */
import { useTranslation } from 'react-i18next';
import { DEFAULT_CONFIG } from '../utils/config.js';

export const LEFT_PANELS = ['deLocation', 'dxLocation', 'solar', 'propagation'];
export const RIGHT_PANELS = ['dxCluster', 'pskReporter', 'dxpeditions', 'pota', 'contests'];

// Size choices, as multiples of each panel's default share of the column
export const SIZE_STEPS = [0.5, 1, 1.5, 2, 3];

const PANEL_LABELS = {
  deLocation: 'DE Location',
  dxLocation: 'DX Target',
  solar: 'Solar',
  propagation: 'Propagation',
  dxCluster: 'DX Cluster',
  pskReporter: 'PSK Reporter',
  dxpeditions: 'DXpeditions',
  pota: 'POTA / SOTA / WWFF',
  contests: 'Contests',
};

const defaultSize = (id) => DEFAULT_CONFIG.panels?.[id]?.size || 1;

/** The SIZE_STEPS multiple closest to a stored flex weight. */
export function sizeStep(id, size) {
  const ratio = (Number(size) || defaultSize(id)) / defaultSize(id);
  return SIZE_STEPS.reduce((best, s) => (Math.abs(s - ratio) < Math.abs(best - ratio) ? s : best), 1);
}

const label = {
  display: 'block',
  marginBottom: '8px',
  color: 'var(--text-muted)',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
};
const describe = { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.4 };
const row = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '6px 0',
  borderBottom: '1px solid var(--border-color)',
  fontSize: '12px',
};
const select = {
  padding: '4px 6px',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '12px',
};

export default function SidebarPanelsSettings({ panels = {}, onChange }) {
  const { t } = useTranslation();
  const panelName = (id) => t(`station.settings.sidebarPanels.panel.${id}`, { defaultValue: PANEL_LABELS[id] });

  const update = (id, patch) => {
    onChange({ ...panels, [id]: { ...DEFAULT_CONFIG.panels?.[id], ...panels[id], ...patch } });
  };

  const sizeLabels = {
    0.5: t('station.settings.sidebarPanels.size.small', { defaultValue: 'Small' }),
    1: t('station.settings.sidebarPanels.size.default', { defaultValue: 'Default' }),
    1.5: t('station.settings.sidebarPanels.size.large', { defaultValue: 'Large' }),
    2: t('station.settings.sidebarPanels.size.xlarge', { defaultValue: 'Extra large' }),
    3: t('station.settings.sidebarPanels.size.xxlarge', { defaultValue: 'Largest' }),
  };

  const renderRow = (id, withSize) => {
    const visible = panels[id]?.visible !== false;
    const toggleId = `sidebar-panel-${id}`;
    return (
      <div key={id} style={row}>
        <label
          htmlFor={toggleId}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}
        >
          <input id={toggleId} type="checkbox" checked={visible} onChange={() => update(id, { visible: !visible })} />
          <span style={{ color: visible ? 'var(--text-primary)' : 'var(--text-muted)' }}>{panelName(id)}</span>
        </label>
        {withSize && (
          <select
            value={String(sizeStep(id, panels[id]?.size))}
            disabled={!visible}
            onChange={(e) => update(id, { size: +(defaultSize(id) * Number(e.target.value)).toFixed(2) })}
            aria-label={t('station.settings.sidebarPanels.sizeFor', {
              defaultValue: 'Size of {{panel}}',
              panel: panelName(id),
            })}
            style={{ ...select, opacity: visible ? 1 : 0.5 }}
          >
            {SIZE_STEPS.map((s) => (
              <option key={s} value={String(s)}>
                {sizeLabels[s]}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <label style={label}>{t('station.settings.sidebarPanels.title', { defaultValue: 'Sidebar Panels' })}</label>
      <div style={describe}>
        {t('station.settings.sidebarPanels.describe', {
          defaultValue:
            'Choose which panels the Modern layout shows in its side columns. Right-column sizes share the column height, so hiding a panel or making it smaller gives the others more room.',
        })}
      </div>
      <div style={{ ...label, marginBottom: '2px', marginTop: '4px' }}>
        {t('station.settings.sidebarPanels.left', { defaultValue: 'Left column' })}
      </div>
      {LEFT_PANELS.map((id) => renderRow(id, false))}
      <div style={{ ...label, marginBottom: '2px', marginTop: '14px' }}>
        {t('station.settings.sidebarPanels.right', { defaultValue: 'Right column' })}
      </div>
      {RIGHT_PANELS.map((id) => renderRow(id, true))}
    </div>
  );
}
