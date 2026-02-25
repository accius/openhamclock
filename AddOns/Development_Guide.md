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
    #ohc-addon-drawer { 
        position: fixed; 
        top: 100px; 
        right: 20px; 
        display: flex; 
        flex-direction: row-reverse; 
        align-items: center; 
        gap: 10px; 
        z-index: 10000; 
        pointer-events: none;
        user-select: none;
    }
    .ohc-addon-icon { 
        position: relative;
        width: 45px; 
        height: 45px; 
        background: var(--bg-panel, rgba(17, 24, 32, 0.95)); 
        border: 1px solid var(--border-color, rgba(255, 180, 50, 0.3)); 
        border-radius: 50%; 
        color: var(--accent-cyan, #00ddff); 
        font-size: 20px; 
        cursor: pointer; 
        display: flex; 
        justify-content: center; 
        align-items: center; 
        box-shadow: 0 2px 10px rgba(0,0,0,0.3); 
        pointer-events: auto; 
        transition: all 0.3s ease; 
    }
    .ohc-addon-icon:hover { border-color: var(--accent-amber); transform: scale(1.1); }
    #ohc-addon-launcher { background: var(--bg-tertiary); color: var(--accent-amber); cursor: move; z-index: 10001; transition: transform 0.3s ease; }
    .ohc-addon-item { display: none; }
`;

// 2. Get or create the shared drawer
let drawer = document.getElementById("ohc-addon-drawer");
if (!drawer) {
    drawer = document.createElement("div");
    drawer.id = "ohc-addon-drawer";
    
    const updateLayout = () => {
        if (!drawer) return;
        const rect = drawer.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        
        const isRight = (rect.left + rect.width / 2) > (winW / 2);
        const isBottom = (rect.top + rect.height / 2) > (winH / 2);
        const isVert = drawer.classList.contains('ohc-vertical');
        
        if (isVert) {
            drawer.style.flexDirection = isBottom ? 'column-reverse' : 'column';
        } else {
            drawer.style.flexDirection = isRight ? 'row-reverse' : 'row';
        }
    };

    const savedLayout = localStorage.getItem('ohc_addon_layout') || 'horizontal';
    if (savedLayout === 'vertical') drawer.classList.add('ohc-vertical');
    
    // Position laden oder Default setzen
    const savedPos = JSON.parse(localStorage.getItem('ohc_addon_pos') || '{}');
    if (savedPos.top) drawer.style.top = savedPos.top;
    if (savedPos.bottom) drawer.style.bottom = savedPos.bottom;
    if (savedPos.left) drawer.style.left = savedPos.left;
    if (savedPos.right) drawer.style.right = savedPos.right;
    
    // Falls gar nichts gesetzt ist (erster Start), Default erzwingen
    if (!savedPos.top && !savedPos.bottom) {
        drawer.style.top = '100px';
        drawer.style.right = '20px';
    }

    const launcher = document.createElement("div");
    launcher.id = "ohc-addon-launcher";
    launcher.className = "ohc-addon-icon";
    launcher.innerHTML = "🧩";
    launcher.title = "L: Toggle | M: Drag | R: Rotate";
    
    let isDragging = false;
    let dragTimer = null;
    let wasDragged = false;
    let startX, startY, startTop, startLeft;

    launcher.onclick = () => {
        if (wasDragged) {
            wasDragged = false;
            return;
        }
        const items = document.querySelectorAll(".ohc-addon-item");
        const isHidden = Array.from(items).some(el => el.style.display !== "flex");
        items.forEach(el => el.style.display = isHidden ? "flex" : "none");
        launcher.style.transform = isHidden ? "rotate(90deg)" : "rotate(0deg)";
        updateLayout();
    };
    
    launcher.oncontextmenu = (e) => {
        e.preventDefault();
        drawer.classList.toggle('ohc-vertical');
        localStorage.setItem('ohc_addon_layout', drawer.classList.contains('ohc-vertical') ? 'vertical' : 'horizontal');
        updateLayout();
    };

    const startDrag = (x, y) => {
        isDragging = true;
        wasDragged = true;
        startX = x;
        startY = y;
        const rect = drawer.getBoundingClientRect();
        startTop = rect.top;
        startLeft = rect.left;
        launcher.style.cursor = 'grabbing';
    };

    const handleMove = (x, y) => {
        if (!isDragging) return;
        const dx = x - startX;
        const dy = y - startY;
        drawer.style.top = (startTop + dy) + "px";
        drawer.style.left = (startLeft + dx) + "px";
        drawer.style.right = 'auto';
        drawer.style.bottom = 'auto';
    };

    const stopDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        launcher.style.cursor = 'move';
        
        const rect = drawer.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const isRight = (rect.left + rect.width / 2) > (winW / 2);
        const isBottom = (rect.top + rect.height / 2) > (winH / 2);
        
        const pos = {};
        if (isRight) {
            drawer.style.left = 'auto';
            drawer.style.right = Math.max(0, winW - rect.right) + 'px';
            pos.right = drawer.style.right;
        } else {
            drawer.style.right = 'auto';
            drawer.style.left = Math.max(0, rect.left) + 'px';
            pos.left = drawer.style.left;
        }
        
        if (isBottom) {
            drawer.style.top = 'auto';
            drawer.style.bottom = Math.max(0, winH - rect.bottom) + 'px';
            pos.bottom = drawer.style.bottom;
        } else {
            drawer.style.bottom = 'auto';
            drawer.style.top = Math.max(0, rect.top) + 'px';
            pos.top = drawer.style.top;
        }
        
        localStorage.setItem('ohc_addon_pos', JSON.stringify(pos));
        updateLayout();
    };

    // Mouse Events
    launcher.onmousedown = (e) => {
        if (e.button === 1) { // Middle click
            e.preventDefault();
            startDrag(e.clientX, e.clientY);
        } else if (e.button === 0) { // Left click long press
            startX = e.clientX; startY = e.clientY;
            dragTimer = setTimeout(() => startDrag(e.clientX, e.clientY), 500);
        }
    };

    document.addEventListener('mousemove', (e) => {
        if (!isDragging && dragTimer) {
            if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
                clearTimeout(dragTimer);
                dragTimer = null;
            }
        }
        handleMove(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
        clearTimeout(dragTimer);
        dragTimer = null;
        stopDrag();
    });

    // Touch Events
    launcher.ontouchstart = (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        dragTimer = setTimeout(() => {
            startDrag(touch.clientX, touch.clientY);
            if (window.navigator.vibrate) window.navigator.vibrate(20);
        }, 500);
    };

    document.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        if (!isDragging && dragTimer) {
            if (Math.abs(touch.clientX - startX) > 5 || Math.abs(touch.clientY - startY) > 5) {
                clearTimeout(dragTimer);
                dragTimer = null;
            }
        }
        if (isDragging) {
            e.preventDefault();
            handleMove(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    document.addEventListener('touchend', () => {
        clearTimeout(dragTimer);
        dragTimer = null;
        stopDrag();
    });

    drawer.appendChild(launcher);
    document.body.appendChild(drawer);
    setTimeout(updateLayout, 100);
}

// 3. Append your icon as an .ohc-addon-item
const myBtn = document.createElement("div");
myBtn.className = "ohc-addon-icon ohc-addon-item";
myBtn.innerHTML = "📍";
drawer.appendChild(myBtn);
```

### 5. Notifying the App of Changes

If your AddOn changes the station's configuration (like position or callsign), you must notify the React app so it can update the UI immediately:

```javascript
localStorage.setItem('openhamclock_config', JSON.stringify(newConfig));
window.dispatchEvent(new CustomEvent('openhamclock-config-change', { detail: newConfig }));
```

### 6. Best Practices
