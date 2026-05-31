const _controllers = {};

export function addMinimizeToggle(element, storageKey, options = {}) {
  if (!element) return;

  const {
    contentClassName = 'panel-content',
    buttonClassName = 'panel-minimize-btn',
    getIsMinimized,
    onToggle,
    persist = true,
    manageButtonEvents = true,
  } = options;

  const minimizeKey = `${storageKey}-minimized`;
  const controllerKey = `${storageKey}:${buttonClassName}`;
  if (_controllers[controllerKey]) {
    _controllers[controllerKey].abort();
  }
  const controller = new AbortController();
  const { signal } = controller;
  _controllers[controllerKey] = controller;

  const header = element.firstElementChild;
  if (!header) return;

  const existingButton = header.querySelector(`.${buttonClassName}`);
  const existingWrapper = element.querySelector(`.${contentClassName}`);

  const readState = () => {
    if (typeof getIsMinimized === 'function') return !!getIsMinimized();
    return localStorage.getItem(minimizeKey) === 'true';
  };

  const writeState = (next) => {
    if (typeof onToggle === 'function') onToggle(next);
    if (persist) localStorage.setItem(minimizeKey, String(next));
  };

  const syncState = (button, wrapper) => {
    const isMinimized = readState();
    wrapper.style.display = isMinimized ? 'none' : 'block';
    button.innerHTML = '▶';
    button.style.transform = isMinimized ? 'rotate(0deg)' : 'rotate(90deg)';
    element.style.cursor = isMinimized ? 'pointer' : 'default';
    button.setAttribute('aria-pressed', String(isMinimized));
    button.setAttribute('aria-label', isMinimized ? 'Expand panel' : 'Minimize panel');
  };

  if (existingButton && existingWrapper) {
    if (manageButtonEvents) {
      existingButton.addEventListener(
        'mousedown',
        (e) => {
          e.stopPropagation();
        },
        { signal },
      );
      existingButton.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          const next = existingWrapper.style.display !== 'none';
          existingWrapper.style.display = next ? 'none' : 'block';
          existingButton.innerHTML = '▶';
          existingButton.style.transform = next ? 'rotate(90deg)' : 'rotate(0deg)';
          element.style.cursor = next ? 'pointer' : 'default';
          existingButton.setAttribute('aria-pressed', String(next));
          existingButton.setAttribute('aria-label', next ? 'Expand panel' : 'Minimize panel');
          writeState(next);
        },
        { signal },
      );
    }
    syncState(existingButton, existingWrapper);
    return;
  }

  const content = Array.from(element.children).slice(1);
  const contentWrapper = document.createElement('div');
  contentWrapper.className = contentClassName;
  content.forEach((child) => contentWrapper.appendChild(child));
  element.appendChild(contentWrapper);

  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = buttonClassName;
  minimizeBtn.innerHTML = '▶';
  minimizeBtn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
    transform: rotate(0deg);
  `;
  minimizeBtn.title = 'Minimize/Maximize';
  minimizeBtn.addEventListener(
    'mousedown',
    (e) => {
      e.stopPropagation();
    },
    { signal },
  );

  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';

  const title = document.createElement('span');
  title.textContent = header.textContent.replace(/[▼▶]/g, '').trim();
  title.dataset.dragHandle = 'true';
  title.style.flex = '1';

  header.textContent = '';
  header.appendChild(title);
  header.appendChild(minimizeBtn);

  syncState(minimizeBtn, contentWrapper);

  minimizeBtn.addEventListener(
    'click',
    (e) => {
      e.stopPropagation();
      const hidden = contentWrapper.style.display === 'none';
      contentWrapper.style.display = hidden ? 'block' : 'none';
      minimizeBtn.style.transform = hidden ? 'rotate(90deg)' : 'rotate(0deg)';
      element.style.cursor = hidden ? 'default' : 'pointer';
      minimizeBtn.setAttribute('aria-pressed', String(!hidden));
      minimizeBtn.setAttribute('aria-label', hidden ? 'Minimize panel' : 'Expand panel');
      writeState(!hidden);
    },
    { signal },
  );
}
