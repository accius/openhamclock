# AddOn Development Guide for OpenHamClock

This directory is intended for community-driven extensions, primarily in the form of **Userscripts** (Greasemonkey, Tampermonkey, etc.). Since OpenHamClock is a React-based application, userscripts are a powerful way to inject custom UI and logic without modifying the core codebase.

## Getting Started

A typical AddOn for OpenHamClock consists of a JavaScript file with a metadata block at the top.

### 1. Script Metadata

Your script should start with a header that tells the browser where to run the script.

```javascript
// ==UserScript==
// @name         My OpenHamClock Tool
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a custom feature to the clock
// @author       YourName/Callsign
// @match        https://openhamclock.com/*
// @grant        none
// ==/UserScript==
```

> **Note on `@match`**: To ensure the safety and privacy of users, AddOns should be restricted to the official domain `https://openhamclock.com/*`. If you are developing locally, you can temporarily change this to `http://localhost:*/*`.

### 2. Designing for OpenHamClock (Styling)

OpenHamClock uses CSS variables for its themes. To ensure your AddOn looks native, always use these variables in your styles:

- **Backgrounds**: `var(--bg-panel)`, `var(--bg-secondary)`
- **Borders**: `var(--border-color)`
- **Text**: `var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)`
- **Accents**: `var(--accent-cyan)`, `var(--accent-amber)`, `var(--accent-green)`, `var(--accent-red)`, `var(--accent-purple)`

Example of a native-looking container:

```javascript
const styles = `
    #my-tool-container {
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-family: 'JetBrains Mono', monospace;
        backdrop-filter: blur(5px);
    }
`;
```

### 3. Interacting with the DOM

OpenHamClock's UI is dynamic. If your script runs before the page is fully rendered, it might fail to find elements.
Use `document.readyState` or a `MutationObserver` if you need to hook into specific React components.

### 4. Integration into the AddOn Drawer (🧩)

To keep the UI clean, all AddOns should integrate into the shared drawer. This creates a single **🧩 Launcher Icon** that reveals all AddOn buttons when clicked.

Add this logic to your `init()` function:

```javascript
// 1. Define shared drawer styles
const styles = `
    #ohc-addon-drawer { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: row-reverse; align-items: center; gap: 10px; z-index: 10000; pointer-events: none; }
    #ohc-addon-drawer.ohc-vertical { flex-direction: column-reverse; }
    .ohc-addon-icon { width: 45px; height: 45px; background: var(--bg-panel, rgba(17, 24, 32, 0.95)); border: 1px solid var(--border-color, rgba(255, 180, 50, 0.3)); border-radius: 50%; color: var(--accent-cyan, #00ddff); font-size: 20px; cursor: pointer; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.3); pointer-events: auto; transition: all 0.3s ease; }
    #ohc-addon-launcher { background: var(--bg-tertiary); color: var(--accent-amber); }
    .ohc-addon-item { display: none; }
`;

// 2. Get or create the shared drawer
let drawer = document.getElementById('ohc-addon-drawer');
if (!drawer) {
  drawer = document.createElement('div');
  drawer.id = 'ohc-addon-drawer';
  const savedLayout = localStorage.getItem('ohc_addon_layout') || 'horizontal';
  if (savedLayout === 'vertical') drawer.classList.add('ohc-vertical');

  const launcher = document.createElement('div');
  launcher.id = 'ohc-addon-launcher';
  launcher.className = 'ohc-addon-icon';
  launcher.innerHTML = '🧩';
  launcher.title = 'L: Toggle | R: Rotate';
  launcher.onclick = () => {
    const items = document.querySelectorAll('.ohc-addon-item');
    const isHidden = items[0]?.style.display !== 'flex';
    items.forEach((el) => (el.style.display = isHidden ? 'flex' : 'none'));
  };
  launcher.oncontextmenu = (e) => {
    e.preventDefault();
    const isVert = drawer.classList.toggle('ohc-vertical');
    localStorage.setItem('ohc_addon_layout', isVert ? 'vertical' : 'horizontal');
  };
  drawer.appendChild(launcher);
  document.body.appendChild(drawer);
}

// 3. Append your icon as an .ohc-addon-item
const myBtn = document.createElement('div');
myBtn.className = 'ohc-addon-icon ohc-addon-item';
myBtn.innerHTML = '📍';
drawer.appendChild(myBtn);
```

### 5. Notifying the App of Changes

If your AddOn changes the station's configuration (like position or callsign), you must notify the React app so it can update the UI immediately:

```javascript
localStorage.setItem('openhamclock_config', JSON.stringify(newConfig));
window.dispatchEvent(new CustomEvent('openhamclock-config-change', { detail: newConfig }));
```

### 6. Best Practices
