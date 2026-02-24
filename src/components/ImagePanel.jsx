/**
 * ImagePanel Component
 * Displays a user-uploaded image in a dockable panel.
 * Supports drag-and-drop or click-to-upload. Image persists in localStorage.
 * Dockable layout only.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';

const LS_KEY = 'openhamclock_customImage';
const MAX_SIZE_MB = 2;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const loadImage = () => {
  try {
    return localStorage.getItem(LS_KEY) || null;
  } catch {
    return null;
  }
};

const saveImage = (dataUrl) => {
  try {
    if (dataUrl) localStorage.setItem(LS_KEY, dataUrl);
    else localStorage.removeItem(LS_KEY);
  } catch (e) {
    console.warn('[ImagePanel] Failed to save image to localStorage:', e.message);
  }
};

export const ImagePanel = () => {
  const [imageData, setImageData] = useState(loadImage);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [showControls, setShowControls] = useState(false);
  const fileInputRef = useRef(null);

  // Sync from other tabs
  useEffect(() => {
    const handler = (e) => {
      if (e.key === LS_KEY) setImageData(e.newValue || null);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const processFile = useCallback((file) => {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setError(`Image must be under ${MAX_SIZE_MB}MB`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      saveImage(dataUrl);
      setImageData(dataUrl);
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [processFile],
  );

  const handleRemove = useCallback(() => {
    saveImage(null);
    setImageData(null);
    setShowControls(false);
  }, []);

  const handleChange = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Hidden file input
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      onChange={handleFileChange}
      style={{ display: 'none' }}
    />
  );

  // Empty state — upload prompt
  if (!imageData) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '20px',
          cursor: 'pointer',
          border: dragOver ? '2px dashed var(--accent-cyan, #00ffcc)' : '2px dashed transparent',
          background: dragOver ? 'rgba(0, 255, 204, 0.05)' : 'transparent',
          transition: 'all 0.2s ease',
          borderRadius: '8px',
        }}
      >
        {fileInput}
        <div style={{ fontSize: '36px', opacity: 0.5 }}>🖼️</div>
        <div
          style={{
            color: 'var(--text-muted, #888)',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          Drop an image here
          <br />
          or click to upload
        </div>
        <div
          style={{
            color: 'var(--text-muted, #666)',
            fontSize: '10px',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          PNG, JPG, GIF, SVG · {MAX_SIZE_MB}MB max
        </div>
        {error && (
          <div
            style={{
              color: '#ff6b6b',
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
              marginTop: '4px',
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>
    );
  }

  // Image display
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
      }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {fileInput}

      <img
        src={imageData}
        alt="Custom panel image"
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* Hover controls */}
      {showControls && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            display: 'flex',
            gap: '4px',
            zIndex: 10,
          }}
        >
          <button
            onClick={handleChange}
            title="Change image"
            style={{
              background: 'rgba(0, 0, 0, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono, monospace',
              color: 'rgba(255, 255, 255, 0.8)',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            📷 Change
          </button>
          <button
            onClick={handleRemove}
            title="Remove image"
            style={{
              background: 'rgba(0, 0, 0, 0.7)',
              border: '1px solid rgba(255, 70, 70, 0.3)',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '10px',
              fontFamily: 'JetBrains Mono, monospace',
              color: 'rgba(255, 100, 100, 0.9)',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            ✕ Remove
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            color: '#ff6b6b',
            fontSize: '10px',
            fontFamily: 'JetBrains Mono, monospace',
            background: 'rgba(0, 0, 0, 0.7)',
            padding: '3px 6px',
            borderRadius: '3px',
          }}
        >
          ⚠ {error}
        </div>
      )}
    </div>
  );
};

export default ImagePanel;
