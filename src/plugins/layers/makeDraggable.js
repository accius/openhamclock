/**
 * makeDraggable — shared drag-to-reposition utility for map layer legends.
 *
 * Ctrl+drag to reposition; position saved to localStorage as viewport
 * percentages so it survives window resizes.  Clamped to keep at least
 * 40 px of the element visible so it can never be dragged off-screen.
 *
 * Double-click to reset position to default (clears localStorage).
 */

const _controllers = {};

/**
 * Clamp an element's position so at least `margin` px remains visible
 * on every edge of the viewport.
 */
function clampToViewport(el, margin = 40) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.left;
  let top = rect.top;

  // Ensure at least `margin` px of the element is visible on each side
  if (left + rect.width < margin) left = margin - rect.width;
  if (top + rect.height < margin) top = margin - rect.height;
  if (left > vw - margin) left = vw - margin;
  if (top > vh - margin) top = vh - margin;

  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

export function makeDraggable(el, storageKey, skipPositionLoad = false) {
  if (!el) return;

  // Cancel any previous listeners for this storageKey (e.g. after layout change)
  if (_controllers[storageKey]) {
    _controllers[storageKey].abort();
  }
  const controller = new AbortController();
  const signal = controller.signal;
  _controllers[storageKey] = controller;

  // --- Restore saved position ---
  if (!skipPositionLoad) {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        el.style.position = 'fixed';
        if (data.topPercent !== undefined && data.leftPercent !== undefined) {
          el.style.top = data.topPercent + '%';
          el.style.left = data.leftPercent + '%';
        } else {
          el.style.top = (data.top / window.innerHeight) * 100 + '%';
          el.style.left = (data.left / window.innerWidth) * 100 + '%';
        }
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
      } catch (e) {}

      // Clamp after restoring — position may be off-screen after
      // window resize, monitor change, or drag-off-screen
      clampToViewport(el);
    } else {
      const rect = el.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.top = rect.top + 'px';
      el.style.left = rect.left + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  }

  el.title = 'Hold CTRL and drag to reposition · Double-click to reset';

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  const updateCursor = (e) => {
    el.style.cursor = e.ctrlKey ? 'grab' : 'default';
  };

  el.addEventListener('mouseenter', updateCursor, { signal });
  el.addEventListener('mousemove', updateCursor, { signal });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Control') updateCursor(e);
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'Control') updateCursor(e);
    },
    { signal },
  );

  // --- Double-click: reset to default position ---
  el.addEventListener(
    'dblclick',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      localStorage.removeItem(storageKey);
      // Reset to flow position
      el.style.position = '';
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
      // Re-fix to current computed position
      const rect = el.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.top = rect.top + 'px';
      el.style.left = rect.left + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    },
    { signal },
  );

  // --- Ctrl+mousedown: start drag ---
  el.addEventListener(
    'mousedown',
    (e) => {
      if (!e.ctrlKey) return;
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.offsetLeft;
      startTop = el.offsetTop;
      el.style.cursor = 'grabbing';
      el.style.opacity = '0.8';
      e.preventDefault();
      e.stopPropagation();
    },
    { signal },
  );

  // --- Mousemove: drag with clamping ---
  document.addEventListener(
    'mousemove',
    (e) => {
      if (!isDragging) return;
      el.style.left = startLeft + (e.clientX - startX) + 'px';
      el.style.top = startTop + (e.clientY - startY) + 'px';
    },
    { signal },
  );

  // --- Mouseup: stop drag, clamp, save ---
  document.addEventListener(
    'mouseup',
    (e) => {
      if (!isDragging) return;
      isDragging = false;
      el.style.opacity = '1';
      updateCursor(e);

      // Clamp so element can't be lost off-screen
      clampToViewport(el);

      const topPercent = (el.offsetTop / window.innerHeight) * 100;
      const leftPercent = (el.offsetLeft / window.innerWidth) * 100;
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          topPercent,
          leftPercent,
          top: el.offsetTop,
          left: el.offsetLeft,
        }),
      );
    },
    { signal },
  );

  // --- Window resize: re-clamp ---
  window.addEventListener(
    'resize',
    () => {
      clampToViewport(el);
    },
    { signal },
  );
}
