import { describe, it, expect } from 'vitest';
import { kiwiStreamRequest, kiwiTuneRequest } from './kiwiAudioClient.js';

describe('kiwiAudioClient', () => {
  it('goes straight to Rig Bridge with the API token', () => {
    expect(kiwiStreamRequest({ bridgeUrl: 'http://pi.local:5555/', token: 't', freqKhz: 7030, mode: 'cw' })).toEqual({
      url: 'http://pi.local:5555/api/kiwi-audio/stream?freq=7030&mode=cw',
      headers: { 'X-RigBridge-Token': 't' },
      via: 'direct',
      startCommand: null,
    });
    const tune = kiwiTuneRequest({ bridgeUrl: 'http://pi.local:5555', freqKhz: 14074, mode: 'usb' });
    expect(tune.url).toBe('http://pi.local:5555/api/kiwi-audio/tune');
    expect(JSON.parse(tune.init.body)).toEqual({ freqKHz: 14074, mode: 'usb' });
  });

  it('uses the Cloud Relay when a relay session is active', () => {
    const r = kiwiStreamRequest({ bridgeUrl: null, relaySession: 'ab cd', freqKhz: 14074, mode: 'usb' });
    expect(r).toEqual({
      url: '/api/rig-bridge/relay/audio?session=ab%20cd&freq=14074&mode=usb',
      headers: {},
      via: 'relay',
      // sent signed through /relay/command before the audio is opened
      startCommand: { type: 'kiwiAudioStart', payload: { freqKHz: 14074, mode: 'usb' } },
    });
    expect(kiwiTuneRequest({ relaySession: 'abcd', freqKhz: 7030, mode: 'cw' })).toEqual({
      relayCommand: { type: 'kiwiAudioTune', payload: { freqKHz: 7030, mode: 'cw' } },
    });
  });

  it('returns null when there is no way to reach a Kiwi', () => {
    expect(kiwiStreamRequest({ freqKhz: 7030 })).toBeNull();
    expect(kiwiTuneRequest({ freqKhz: 7030 })).toBeNull();
  });
});
