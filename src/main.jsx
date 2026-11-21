import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import BadgeBuilder from './components/BadgeBuilder.jsx';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/main.css';
import './lang/i18n';
import { getDebugConfig } from './debug/debugConfig';
import { overrideConsole } from './debug/consoleOverride';
import { setupServiceWorker } from './pwa/registerServiceWorker';

overrideConsole(getDebugConfig());
setupServiceWorker();

const pagePath = window.location.pathname.replace(/\/+$/, '') || '/';
const Root = pagePath === '/badges' || pagePath === '/badge-builder' ? BadgeBuilder : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
