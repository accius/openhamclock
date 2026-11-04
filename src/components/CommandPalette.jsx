/**
 * CommandPalette — Ctrl/Cmd+K quick-action overlay, mounted once in App.jsx.
 *
 * One fuzzy-filtered list (utils/fuzzyMatch.js — plain subsequence match, no
 * dependencies) over:
 *   • Panels — from the shared panelDefs registry (src/panelDefs.js). Shown
 *     ONLY in the dockable layout, where "open panel" has a real meaning:
 *     the palette dispatches `openhamclock:add-panel` and DockableApp adds
 *     the panel or focuses its existing tab. Fixed layouts have a static
 *     panel set — an add/focus action can't do anything there, and per-layout
 *     presence probing would duplicate each layout's internals for no gain.
 *   • Map layers — toggled through window.hamclockLayerControls (the same
 *     bridge Settings → Map Layers and the single-key shortcuts use).
 *   • Layouts — switch config.layout (same save path as Settings → Display).
 *   • Settings tabs — open the Settings modal on a specific tab.
 *   • Help topics — openHelp() deep links into the manual.
 *   • A few actions — fullscreen, What's New.
 *
 * Keyboard: ↑/↓ select (wrap), Enter runs, Esc closes; Ctrl/Cmd+K toggles
 * (registered in App.jsx's keyboard handler).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildPanelDefs } from '../panelDefs.js';
import { PanelIcon } from './Icons.jsx';
import { fuzzyFilter } from '../utils/fuzzyMatch.js';
import { HELP_TOPICS, openHelp } from '../utils/helpTopics.js';
import { listPresets, getActivePresetId, activatePreset } from '../store/layoutStore.js';

const LAYOUT_IDS = [
  'modern',
  'classic',
  'tablet',
  'compact',
  'dockable',
  'emcomm',
  'contest',
  'eme',
  'activator',
  'hunter',
  'weather',
  'airtraffic',
  'mobile',
];
const SETTINGS_TAB_IDS = [
  'station',
  'integrations',
  'display',
  'layers',
  'satellites',
  'profiles',
  'community',
  'alerts',
  'rig-bridge',
  'help',
];
const MAX_RESULTS = 50;

/** "de-dx" → "De dx" — readable fallback label for help-topic keys. */
const humanize = (key) => {
  const s = String(key).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const CommandPalette = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onOpenSettings,
  onToggleFullscreen,
  isLocalInstall,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset + focus on every open.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelected(0);
    // Focus after the overlay paints.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  const commands = useMemo(() => {
    if (!isOpen) return [];
    const items = [];

    // Panels — dockable layout only (see file header for the reasoning).
    if (config?.layout === 'dockable') {
      const defs = buildPanelDefs({ isLocalInstall });
      for (const [id, def] of Object.entries(defs)) {
        items.push({
          id: `panel:${id}`,
          category: t('commandPalette.cat.panels', { defaultValue: 'Panel' }),
          // Registry line icon; plugin panels fall back to their emoji string.
          icon: <PanelIcon panelId={id} icon={def.icon || '▦'} iconColor={def.iconColor} size={20} />,
          label: t('commandPalette.openPanel', { defaultValue: 'Open panel: {{name}}', name: def.name }),
          run: () => window.dispatchEvent(new CustomEvent('openhamclock:add-panel', { detail: { panelId: id } })),
        });
      }
    }

    // Map layers — via the WorldMap bridge (absent until a Leaflet map mounts).
    const layers = window.hamclockLayerControls?.layers || [];
    for (const layer of layers) {
      const rawName = layer.name || layer.id;
      const name = String(rawName).startsWith('plugins.layers.') ? t(rawName, rawName) : rawName;
      items.push({
        id: `layer:${layer.id}`,
        category: t('commandPalette.cat.layers', { defaultValue: 'Map layer' }),
        icon: layer.enabled ? '🟢' : '⚪',
        label: layer.enabled
          ? t('commandPalette.layerOff', { defaultValue: 'Hide layer: {{name}}', name })
          : t('commandPalette.layerOn', { defaultValue: 'Show layer: {{name}}', name }),
        run: () => window.hamclockLayerControls?.toggleLayer(layer.id, !layer.enabled),
      });
    }

    // Layouts.
    for (const id of LAYOUT_IDS) {
      if (id === config?.layout) continue; // already there — switching is a no-op
      items.push({
        id: `layout:${id}`,
        category: t('commandPalette.cat.layouts', { defaultValue: 'Layout' }),
        icon: '🖥️',
        label: t('commandPalette.switchLayout', {
          defaultValue: 'Switch layout: {{name}}',
          name: t('station.settings.layout.' + id),
        }),
        run: () => onSaveConfig?.({ ...config, layout: id }),
      });
    }

    // Named dockable layout presets — `dockable#<id>` scenes. Only offered
    // once the user has created a custom preset (Default alone adds nothing
    // over the plain Dockable entry above).
    const presets = listPresets();
    if (presets.length > 1) {
      const activePresetId = getActivePresetId();
      for (const p of presets) {
        if (config?.layout === 'dockable' && p.id === activePresetId) continue; // already showing
        items.push({
          id: `layout:dockable#${p.id}`,
          category: t('commandPalette.cat.layouts', { defaultValue: 'Layout' }),
          icon: '🖥️',
          label: t('commandPalette.switchLayout', {
            defaultValue: 'Switch layout: {{name}}',
            name: `${t('station.settings.layout.dockable')} — ${p.name}`,
          }),
          run: () => {
            activatePreset(p.id);
            if (config?.layout !== 'dockable') onSaveConfig?.({ ...config, layout: 'dockable' });
          },
        });
      }
    }

    // Settings tabs.
    for (const id of SETTINGS_TAB_IDS) {
      items.push({
        id: `settings:${id}`,
        category: t('commandPalette.cat.settings', { defaultValue: 'Settings' }),
        icon: '⚙️',
        label: t('commandPalette.openSettings', {
          defaultValue: 'Settings: {{tab}}',
          tab: t(`station.settings.tab.title.${id === 'layers' ? 'mapLayers' : id}`),
        }),
        run: () => onOpenSettings?.(id),
      });
    }

    // Help topics (deep links into the manual).
    for (const topic of Object.keys(HELP_TOPICS)) {
      items.push({
        id: `help:${topic}`,
        category: t('commandPalette.cat.help', { defaultValue: 'Help' }),
        icon: '📖',
        label: t('commandPalette.openHelp', { defaultValue: 'Help: {{topic}}', topic: humanize(topic) }),
        run: () => openHelp(topic),
      });
    }

    // Misc actions.
    items.push({
      id: 'action:fullscreen',
      category: t('commandPalette.cat.actions', { defaultValue: 'Action' }),
      icon: '⛶',
      label: t('commandPalette.toggleFullscreen', { defaultValue: 'Toggle fullscreen' }),
      run: () => onToggleFullscreen?.(),
    });
    items.push({
      id: 'action:whats-new',
      category: t('commandPalette.cat.actions', { defaultValue: 'Action' }),
      icon: '🆕',
      label: t('commandPalette.whatsNew', { defaultValue: "Open What's New" }),
      run: () => window.dispatchEvent(new Event('openhamclock-show-whatsnew')),
    });

    return items;
  }, [isOpen, config, isLocalInstall, onSaveConfig, onOpenSettings, onToggleFullscreen, t]);

  const results = useMemo(
    () => fuzzyFilter(query, commands, (c) => `${c.label} ${c.category}`).slice(0, MAX_RESULTS),
    [query, commands],
  );

  // Keep selection in range as the result set changes.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Keep the selected row visible.
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, results]);

  if (!isOpen) return null;

  const runCommand = (cmd) => {
    onClose();
    try {
      cmd?.run();
    } catch (err) {
      console.error('[CommandPalette] command failed:', err);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selected]) runCommand(results[selected]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      // Cmd/Ctrl+K toggles the palette closed even while its input has focus.
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '10vh',
        zIndex: 10001,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.title', { defaultValue: 'Command palette' })}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: 'min(92vw, 560px)',
          maxHeight: '62vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--accent-cyan)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder={t('commandPalette.placeholder', {
            defaultValue: 'Type a panel, layer, layout, setting, or action…',
          })}
          aria-label={t('commandPalette.title', { defaultValue: 'Command palette' })}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={results[selected] ? `command-palette-item-${selected}` : undefined}
          style={{
            padding: '12px 14px',
            background: 'var(--bg-tertiary)',
            border: 'none',
            borderBottom: '1px solid var(--border-color)',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '14px',
            fontFamily: 'var(--font-mono)',
          }}
        />
        <div
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          aria-label={t('commandPalette.results', { defaultValue: 'Matching commands' })}
          style={{ overflowY: 'auto', padding: '4px' }}
        >
          {results.length === 0 && (
            <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              {t('commandPalette.noMatch', { defaultValue: 'No matching commands' })}
            </div>
          )}
          {results.map((cmd, i) => (
            <div
              key={cmd.id}
              id={`command-palette-item-${i}`}
              role="option"
              aria-selected={i === selected}
              data-selected={i === selected ? 'true' : undefined}
              onClick={() => runCommand(cmd)}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 10px',
                borderRadius: '5px',
                cursor: 'pointer',
                background: i === selected ? 'var(--bg-tertiary)' : 'transparent',
                borderLeft: i === selected ? '2px solid var(--accent-cyan)' : '2px solid transparent',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: '13px',
                  width: '20px',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cmd.icon}
              </span>
              <span
                style={{
                  flex: 1,
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cmd.label}
              </span>
              <span
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  flexShrink: 0,
                }}
              >
                {cmd.category}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
            fontSize: '10px',
            display: 'flex',
            gap: '12px',
          }}
        >
          <span>↑↓ {t('commandPalette.hint.navigate', { defaultValue: 'navigate' })}</span>
          <span>⏎ {t('commandPalette.hint.run', { defaultValue: 'run' })}</span>
          <span>Esc {t('commandPalette.hint.close', { defaultValue: 'close' })}</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
