export const mockConfig = {
  callsign: 'K0CJH',
  headerSize: 1.0,
  version: '3.14.26',
  location: { lat: 40.015, lon: -105.2705 },
  defaultDX: { lat: 35.6762, lon: 139.6503 },
  theme: 'dark',
  layout: 'modern',
  timezone: '',
  dxClusterSource: 'dxspider-proxy',
  customDxCluster: { enabled: false, host: '', port: 7300 },
  lowMemoryMode: false,
  panels: {
    deLocation: { visible: true },
    dxLocation: { visible: true },
    solar: { visible: true },
    propagation: { visible: true },
    dxCluster: { visible: true },
    pskReporter: { visible: true },
    dxpeditions: { visible: true },
    pota: { visible: true },
    contests: { visible: true }
  }
};

export const mockSolarIndices = {
  data: {
    sfi: { current: 150, history: [{ value: 120 }, { value: 130 }, { value: 145 }, { value: 150 }] },
    kp: { current: 3 },
    kIndex: 3,
    ssn: { current: 85, history: [{ value: 60 }, { value: 70 }, { value: 80 }, { value: 85 }] }
  }
};

export const mockSpaceWeather = {
  data: {
    solarFlux: 150,
    kIndex: 3,
    sunspotNumber: 85,
    conditions: 'FAIR'
  }
};

export const mockBandConditions = {
  data: [
    { band: '80m', condition: 'POOR' },
    { band: '40m', condition: 'FAIR' },
    { band: '20m', condition: 'GOOD' },
    { band: '15m', condition: 'GOOD' },
    { band: '10m', condition: 'FAIR' }
  ]
};

export const mockPropagation = {
  solarData: { sfi: 150, kIndex: 3, ssn: 85 },
  distance: 8400,
  currentBands: [
    { band: '80m', reliability: 35, status: 'FAIR' },
    { band: '40m', reliability: 55, status: 'GOOD' },
    { band: '20m', reliability: 80, status: 'EXCELLENT' },
    { band: '15m', reliability: 60, status: 'GOOD' },
    { band: '10m', reliability: 25, status: 'POOR' }
  ],
  currentHour: 12,
  hourlyPredictions: {
    '80m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour < 6 ? 45 : 15 })),
    '40m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour < 12 ? 55 : 35 })),
    '30m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: 40 })),
    '20m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour >= 8 && hour <= 18 ? 80 : 20 })),
    '17m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour >= 10 && hour <= 16 ? 65 : 20 })),
    '15m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour >= 10 && hour <= 16 ? 60 : 10 })),
    '12m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour >= 11 && hour <= 15 ? 45 : 5 })),
    '11m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour >= 11 && hour <= 14 ? 30 : 5 })),
    '10m': Array.from({ length: 24 }, (_, hour) => ({ hour, reliability: hour >= 11 && hour <= 14 ? 25 : 5 }))
  },
  muf: '18 MHz',
  luf: '4 MHz',
  ionospheric: { method: 'interpolated', source: 'ionosonde', distance: 320, foF2: 7.2 },
  dataSource: 'VOACAP (ITU)'
};

export const mockDXClusterSpots = [
  { freq: '14.074', call: 'K1ABC', spotter: 'W2XYZ', mode: 'FT8', time: '12:30', lat: 40.7, lon: -74.0 },
  { freq: '7.074', call: 'DL1XYZ', spotter: 'K0CJH', mode: 'FT8', time: '12:31', lat: 52.5, lon: 13.4 },
  { freq: '21.250', call: 'JA1NQZ', spotter: 'N0CALL', mode: 'SSB', time: '12:32', lat: 35.6, lon: 139.7 }
];

export const mockPOTASpots = [
  { call: 'K0CJH', ref: 'K-1234', locationDesc: 'CO', freq: '14.074', time: '12:30' },
  { call: 'W1AW', ref: 'K-4567', locationDesc: 'CT', freq: '7.074', time: '12:31' }
];

export const mockDXpeditions = {
  active: 1,
  dxpeditions: [
    { callsign: 'VP6', entity: 'Pitcairn', dates: 'Feb 1 - Feb 10', isActive: true, isUpcoming: false },
    { callsign: 'KH7', entity: 'Hawaii', dates: 'Mar 5 - Mar 12', isActive: false, isUpcoming: true }
  ]
};

export const mockContests = [
  {
    name: 'CQ WPX RTTY',
    mode: 'RTTY',
    start: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    end: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
  },
  {
    name: 'ARRL DX',
    mode: 'SSB',
    start: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    end: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString()
  }
];

export const mockSatellites = [
  {
    name: 'AO-91',
    lat: 10.0,
    lon: 30.0,
    track: [[10, 30], [12, 32], [14, 34]],
    visible: true,
    color: '#00ffff',
    mode: 'FM',
    alt: 500,
    azimuth: 120,
    elevation: 45,
    range: 900,
    footprintRadius: 2500
  }
];

export const mockPskSpots = [
  { lat: 40.7, lon: -74.0, freq: '14.074', call: 'K1ABC', time: '12:30', mode: 'FT8' }
];

export const mockWsjtxSpots = [
  { lat: 51.5, lon: -0.1, freq: '7.074', call: 'G4XYZ', time: '12:30', type: 'CQ' }
];

export const mockSunTimes = { sunrise: '06:12', sunset: '18:45' };
