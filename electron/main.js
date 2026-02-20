/**
 * OpenHamClock Electron Main Process
 *
 * Creates a native desktop application wrapper for OpenHamClock
 * Supports Windows, macOS, Linux, and Raspberry Pi
 */

const { app, BrowserWindow, Menu, shell, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');

// Keep a global reference to prevent garbage collection
let mainWindow;

// Power save blocker ID (-1 means inactive)
let powerSaveBlockerId = -1;

// Check if running in development
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Start the Express server in production
let server;
if (!isDev) {
  // In production, start the built-in server
  const express = require('express');
  const serverApp = express();
  const PORT = 3847; // Use a unique port for embedded server

  const staticDir = path.join(__dirname, '..', 'dist');
  serverApp.use(express.static(staticDir));
  serverApp.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  server = serverApp.listen(PORT, () => {
    console.log(`Embedded server running on port ${PORT}`);
  });
}

function createWindow() {
  // Determine the URL to load
  const loadURL = isDev ? 'http://localhost:3000' : `http://localhost:3847`;

  // Create the browser window
  const assetDir = isDev ? path.join(__dirname, '..', 'public') : path.join(__dirname, '..', 'dist');

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'OpenHamClock',
    icon: path.join(assetDir, 'icons', 'icon.png'),
    backgroundColor: '#0a0e14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Preload script for IPC communication (e.g. screen wake lock)
      preload: path.join(__dirname, 'preload.js'),
    },
    // Frame options
    frame: true,
    autoHideMenuBar: false,
  });

  // Load the app
  mainWindow.loadURL(loadURL);

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Cleanup on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle fullscreen toggle with F11
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh Data',
          accelerator: 'F5',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.reload();
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Kiosk Mode',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Map',
      submenu: [
        {
          label: 'Dark Theme',
          accelerator: '1',
          click: () => sendMapStyle('dark'),
        },
        {
          label: 'Satellite',
          accelerator: '2',
          click: () => sendMapStyle('satellite'),
        },
        {
          label: 'Terrain',
          accelerator: '3',
          click: () => sendMapStyle('terrain'),
        },
        {
          label: 'Streets',
          accelerator: '4',
          click: () => sendMapStyle('streets'),
        },
        {
          label: 'Topographic',
          accelerator: '5',
          click: () => sendMapStyle('topo'),
        },
        {
          label: 'Ocean',
          accelerator: '6',
          click: () => sendMapStyle('ocean'),
        },
        {
          label: 'National Geographic',
          accelerator: '7',
          click: () => sendMapStyle('natgeo'),
        },
        {
          label: 'Gray',
          accelerator: '8',
          click: () => sendMapStyle('gray'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About OpenHamClock',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About OpenHamClock',
              message: 'OpenHamClock v3.0.0',
              detail:
                'An open-source amateur radio dashboard.\n\nIn memory of Elwood Downey, WB0OEW, creator of the original HamClock.\n\n73 de the OpenHamClock community!',
            });
          },
        },
        {
          label: 'GitHub Repository',
          click: () => {
            shell.openExternal('https://github.com/accius/openhamclock');
          },
        },
        { type: 'separator' },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/accius/openhamclock/issues/new');
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools();
            }
          },
        },
      ],
    },
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Send map style change to renderer
function sendMapStyle(style) {
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      window.postMessage({ type: 'SET_MAP_STYLE', style: '${style}' }, '*');
    `);
  }
}

// IPC: screen wake lock — renderer asks main process to enable/disable powerSaveBlocker
ipcMain.on('set-prevent-sleep', (_event, enabled) => {
  if (enabled) {
    if (powerSaveBlockerId === -1) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log('[PowerSave] Display sleep prevention enabled, id:', powerSaveBlockerId);
    }
  } else {
    if (powerSaveBlockerId !== -1 && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log('[PowerSave] Display sleep prevention disabled, id:', powerSaveBlockerId);
    }
    powerSaveBlockerId = -1;
  }
});

// App ready
app.whenReady().then(() => {
  createWindow();
  createMenu();

  // macOS: recreate window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup on quit
app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://localhost:3000' && parsedUrl.origin !== 'http://localhost:3847') {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
});
