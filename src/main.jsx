import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { QRZProvider, setupMapQRZHandler } from './components/CallsignLink';
import './styles/main.css';
import './lang/i18n';
import { getDebugConfig } from './debug/debugConfig';
import { overrideConsole } from './debug/consoleOverride';

// Global click handler for QRZ links in Leaflet HTML popups
setupMapQRZHandler();

overrideConsole(getDebugConfig());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QRZProvider>
        <App />
      </QRZProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
