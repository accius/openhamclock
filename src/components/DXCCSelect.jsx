import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCtyEntities, isCtyLoaded } from '../utils/ctyLookup.js';

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

export default function DXCCSelect({ dxLocked, onDXChange, style }) {
  const { t } = useTranslation();
  const [entities, setEntities] = useState(() => (isCtyLoaded() ? getCtyEntities() : []));
  const [inputValue, setInputValue] = useState('');
  const listId = useId();

  useEffect(() => {
    if (isCtyLoaded()) {
      setEntities(getCtyEntities());
      return undefined;
    }

    const handleLoaded = () => setEntities(getCtyEntities());
    window.addEventListener('openhamclock-cty-loaded', handleLoaded);
    return () => window.removeEventListener('openhamclock-cty-loaded', handleLoaded);
  }, []);

  const options = useMemo(() => {
    return entities
      .filter((item) => item?.entity && Number.isFinite(item.lat) && Number.isFinite(item.lon))
      .sort((a, b) => a.entity.localeCompare(b.entity))
      .map((item) => ({
        key: `${item.entity}|${item.dxcc || ''}`,
        label: item.dxcc ? `${item.entity} (${item.dxcc})` : item.entity,
        entity: item.entity,
        dxcc: item.dxcc || '',
        lat: item.lat,
        lon: item.lon,
      }));
  }, [entities]);

  const optionMap = useMemo(() => {
    const map = new Map();
    options.forEach((item) => {
      map.set(normalize(item.label), item);
      map.set(normalize(item.entity), item);
      if (item.dxcc) map.set(normalize(item.dxcc), item);
    });
    return map;
  }, [options]);

  const commit = () => {
    const match = optionMap.get(normalize(inputValue));
    if (!match) return;
    onDXChange({ lat: match.lat, lon: match.lon });
    setInputValue(match.label);
  };

  const handleChange = (value) => {
    setInputValue(value);

    const match = optionMap.get(normalize(value));
    if (match) {
      onDXChange({ lat: match.lat, lon: match.lon });
      setInputValue(match.label);
    }
  };

  return (
    <div style={{ ...style }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '5px' }}>
        <input
          id="dxcc_list"
          list={listId}
          type="text"
          value={inputValue}
          disabled={dxLocked}
          placeholder={t('app.dxLocation.dxccPlaceholder', 'Select DXCC entity')}
          title={
            dxLocked
              ? t('app.dxLocation.dxccTitleLocked', 'Unlock DX position to select a DXCC entity')
              : t('app.dxLocation.dxccTitle', 'Select a DXCC entity to move the DX target')
          }
          onChange={(e) => handleChange(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setInputValue('');
              e.currentTarget.blur();
            }
          }}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '6px 8px',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
            outline: 'none',
            cursor: dxLocked ? 'not-allowed' : 'text',
          }}
        />
        <button
          type="button"
          onClick={() => setInputValue('')}
          disabled={!inputValue}
          title={t('app.dxLocation.dxccClearTitle', 'Clear DXCC input')}
          aria-label={t('app.dxLocation.dxccClearTitle', 'Clear DXCC input')}
          style={{
            flex: '0 0 auto',
            width: '30px',
            background: inputValue ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            color: inputValue ? 'var(--text-primary)' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '4px',
            padding: 0,
            fontSize: '10px',
            cursor: inputValue ? 'pointer' : 'not-allowed',
            opacity: inputValue ? 1 : 0.55,
          }}
        >
          ❌
        </button>
        <datalist id={listId}>
          {options.map((item) => (
            <option key={item.key} value={item.label} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
