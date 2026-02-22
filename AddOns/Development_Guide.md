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
// @match        *://*/*
// @grant        none
// ==/UserScript==
```

> **Note on `@match`**: Since OpenHamClock can be hosted on any IP or domain (local or remote), `*://*/*` is often necessary. You can also use specific filters if you know your local URL.

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

### 4. Best Practices

- **Draggable UI**: Since the clock uses a lot of screen space, ensure any large UI elements are draggable.
- **Persistence**: Use `localStorage` to save user preferences or last-used values.
- **Toggle Button**: Provide a small floating button or a hotkey to show/hide your tool to keep the interface clean.
- **Mobile Friendly**: Consider that many users run the clock on small touchscreens (e.g., Raspberry Pi 7" display).

### 5. Sharing your AddOn

1. Create your script in the `AddOns/` folder with the naming convention `name_of_tool.user.js`.
2. Provide a short `.md` file explaining what the tool does.
3. Submit a Pull Request to the repository!

## Example Reference
Check out [hfj350m_calculator.user.js](./hfj350m_calculator.user.js) in this directory for a complete implementation including:
- Theme-aware CSS
- Draggable window logic
- LocalStorage persistence
- Toggle button implementation
