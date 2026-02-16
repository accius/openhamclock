/**
 * ErrorBoundary — catches React render crashes and shows a recovery UI
 * instead of a blank screen. Provides reload button and error details.
 */
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught render crash:', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        width: '100vw', height: '100vh',
        background: '#1a1a2e', color: '#eee',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ textAlign: 'center', padding: '40px', maxWidth: '600px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{ color: '#fbbf24', fontSize: '1.5rem', marginBottom: '12px' }}>
            OpenHamClock hit an error
          </h1>
          <p style={{ color: '#aaa', marginBottom: '24px', lineHeight: 1.6 }}>
            Something went wrong rendering the dashboard. This usually fixes itself after a reload.
            If it keeps happening, try clearing your browser cache.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '24px' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#fbbf24', color: '#1a1a2e', border: 'none',
                padding: '10px 24px', borderRadius: '6px', fontSize: '14px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              Reload Page
            </button>
            <button
              onClick={() => {
                try { localStorage.clear(); } catch {}
                window.location.reload();
              }}
              style={{
                background: 'transparent', color: '#ff6b6b', border: '1px solid #ff6b6b',
                padding: '10px 24px', borderRadius: '6px', fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Clear Cache & Reload
            </button>
          </div>
          {this.state.error && (
            <details style={{ textAlign: 'left', background: '#0d0d1a', padding: '12px', borderRadius: '6px', fontSize: '11px' }}>
              <summary style={{ cursor: 'pointer', color: '#888', marginBottom: '8px' }}>Error details</summary>
              <pre style={{ color: '#ff6b6b', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {this.state.error.toString()}
              </pre>
              {this.state.errorInfo?.componentStack && (
                <pre style={{ color: '#666', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '8px 0 0', fontSize: '10px' }}>
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
