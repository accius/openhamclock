import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const mocks = vi.hoisted(() => ({
  config: null,
  state: {},
  sync: vi.fn(),
}));

vi.mock('../../utils/logsyncConfig.js', () => ({
  getLogsyncConfig: () => mocks.config,
  getLogsyncState: () => mocks.state,
}));

vi.mock('../../utils/logsync.js', () => ({
  syncWavelogQsos: (...args) => mocks.sync(...args),
}));

vi.mock('../../utils/adif.js', () => ({
  parseAdif: vi.fn(),
}));

import useWavelogSync from './useWavelogSync.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let eventSources;

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    eventSources.push(this);
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  emit(name) {
    this.listeners.get(name)?.({ type: name });
  }

  close() {
    this.closed = true;
  }
}

function Harness() {
  useWavelogSync();
  return null;
}

const configuredWavelog = () => ({
  wavelog: {
    pullEnabled: true,
    url: 'http://wavelog.test',
    apiKey: 'test-key',
    pullStationIds: ['1'],
  },
});

const renderHook = () => {
  act(() => {
    root.render(<Harness />);
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  eventSources = [];
  globalThis.EventSource = MockEventSource;

  mocks.config = configuredWavelog();
  mocks.state = {};
  mocks.sync.mockReset();
  mocks.sync.mockResolvedValue({});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete globalThis.EventSource;
});

describe('useWavelogSync', () => {
  it('does nothing when Wavelog pull is not configured', () => {
    mocks.config = {
      wavelog: {
        pullEnabled: false,
        url: '',
        apiKey: '',
        pullStationIds: [],
      },
    };

    renderHook();

    expect(eventSources).toHaveLength(0);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('catches up when SSE connects and a cursor already exists', async () => {
    mocks.state = { wavelogLastFetchedId: 928 };

    renderHook();

    expect(eventSources).toHaveLength(1);
    expect(eventSources[0].url).toBe('/api/logsync/wavelog/events');

    await act(async () => {
      eventSources[0].emit('connected');
    });

    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it('does not start a historical import on connect without a cursor', async () => {
    mocks.state = {};

    renderHook();

    await act(async () => {
      eventSources[0].emit('connected');
    });

    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('runs an incremental sync when a QSO event arrives', async () => {
    renderHook();

    await act(async () => {
      eventSources[0].emit('qso');
    });

    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it('coalesces events that arrive while a sync is already running', async () => {
    let finishFirstSync;
    const firstSync = new Promise((resolve) => {
      finishFirstSync = resolve;
    });

    mocks.sync.mockImplementationOnce(() => firstSync).mockResolvedValueOnce({});

    renderHook();

    act(() => {
      eventSources[0].emit('qso');
      eventSources[0].emit('qso');
    });

    // The second event must not start a concurrent pull.
    expect(mocks.sync).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirstSync({});
      await firstSync;
    });

    // Once the first pull finishes, one catch-up pull handles anything
    // that arrived while it was running.
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
});
