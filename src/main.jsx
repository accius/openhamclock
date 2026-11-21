import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/main.css';
import './lang/i18n';
import { getDebugConfig } from './debug/debugConfig';
import { overrideConsole } from './debug/consoleOverride';
import { setupServiceWorker } from './pwa/registerServiceWorker';

overrideConsole(getDebugConfig());
setupServiceWorker();

// The badge builder is its own page; keep it out of the main app bundle.
const BadgeBuilder = lazy(() => import('./components/BadgeBuilder.jsx'));

const pagePath = window.location.pathname.replace(/\/+$/, '') || '/';
const Root = pagePath === '/badges' || pagePath === '/badge-builder' ? BadgeBuilder : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
