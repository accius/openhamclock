import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { QRZProvider, setupMapQRZHandler } from './components/CallsignLink';
import './styles/main.css';
import './lang/i18n';
import { DebugProvider } from './debug';

// Global click handler for QRZ links in Leaflet HTML popups
setupMapQRZHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DebugProvider>
        <QRZProvider>
          <App />
        </QRZProvider>
      </DebugProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
