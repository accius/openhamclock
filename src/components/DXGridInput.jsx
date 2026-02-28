/**
 * DXGridInput Component
 * Editable Maidenhead locator display for the DX target section.
 * Visually identical to the existing static grid square text; becomes
 * interactive on focus so the user can type a locator manually.
 *
 * Calls onDXChange({ lat, lon }) with parsed coordinates on commit
 * (Enter key or blur). Reverts to the current grid on Escape or invalid input.
 * Read-only when dxLocked is true.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { parseGridSquare } from '../utils/geo.js';

export function DXGridInput({ dxGrid, onDXChange, dxLocked, style }) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(dxGrid);
  const inputRef = useRef(null);
  // Tracks whether the user pressed Escape so blur skips the commit
  const escapingRef = useRef(false);

  // Sync display whenever the external dxGrid changes (map click, spot click, etc.)
  useEffect(() => {
    setInputValue(dxGrid);
  }, [dxGrid]);

  const commit = (value) => {
    const trimmed = value.trim();
    const parsed = parseGridSquare(trimmed);
    if (parsed) {
      onDXChange({ lat: parsed.lat, lon: parsed.lon });
    } else {
      setInputValue(dxGrid); // revert to last known good value
    }
  };

  const handleChange = (e) => {
    setInputValue(e.target.value.toUpperCase());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      escapingRef.current = true;
      setInputValue(dxGrid);
      inputRef.current?.blur();
    }
  };

  const handleBlur = () => {
    if (inputRef.current) {
      inputRef.current.style.borderBottomColor = 'transparent';
    }
    if (escapingRef.current) {
      escapingRef.current = false;
      return;
    }
    commit(inputValue);
  };

  const handleFocus = () => {
    if (!dxLocked && inputRef.current) {
      inputRef.current.style.borderBottomColor = 'var(--border-color)';
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={inputValue}
      readOnly={dxLocked}
      maxLength={6}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      title={
        dxLocked
          ? t('app.dxLocation.gridInputTitleLocked', 'Unlock DX position to enter a locator')
          : t('app.dxLocation.gridInputTitle', 'Type a Maidenhead locator (e.g. JN58sm), press Enter')
      }
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid transparent',
        outline: 'none',
        cursor: dxLocked ? 'not-allowed' : 'text',
        width: '7ch',
        textAlign: 'right',
        padding: 0,
        margin: 0,
        fontFamily: 'JetBrains Mono, monospace',
        ...style,
      }}
    />
  );
}

export default DXGridInput;
