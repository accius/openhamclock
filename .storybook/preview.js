import '../src/styles/main.css';
import '../src/lang/i18n';

const now = new Date();
const isoNow = now.toISOString();
const dailyDates = [0, 1, 2].map((d) => new Date(now.getTime() + d * 86400000).toISOString().split('T')[0]);
const hourlyTimes = Array.from({ length: 24 }, (_, i) => new Date(now.getTime() + i * 3600000).toISOString());

const mockOpenMeteo = {
  latitude: 40.015,
  longitude: -105.2705,
  timezone: 'America/Denver',
  current: {
    temperature_2m: 18.2,
    relative_humidity_2m: 45,
    apparent_temperature: 17.0,
    weather_code: 2,
    cloud_cover: 25,
    pressure_msl: 1016.2,
    wind_speed_10m: 12.1,
    wind_direction_10m: 220,
    wind_gusts_10m: 18.4,
    precipitation: 0.0,
    uv_index: 3.2,
    visibility: 12000,
    dew_point_2m: 7.0,
    is_day: 1
  },
  daily: {
    time: dailyDates,
    temperature_2m_max: [22, 24, 21],
    temperature_2m_min: [10, 9, 8],
    precipitation_sum: [0, 1.2, 0.4],
    precipitation_probability_max: [5, 30, 10],
    weather_code: [2, 3, 1],
    sunrise: dailyDates.map((d) => `${d}T06:15`),
    sunset: dailyDates.map((d) => `${d}T18:45`),
    uv_index_max: [4, 5, 3],
    wind_speed_10m_max: [20, 18, 16]
  },
  hourly: {
    time: hourlyTimes,
    temperature_2m: hourlyTimes.map((_, i) => 12 + Math.sin(i / 24 * Math.PI * 2) * 6),
    precipitation_probability: hourlyTimes.map(() => 10),
    weather_code: hourlyTimes.map(() => 2)
  }
};

const mockXray = Array.from({ length: 120 }, (_, i) => ({
  energy: '0.1-0.8nm',
  flux: 1e-7 + i * 2e-9,
  time_tag: new Date(now.getTime() - (120 - i) * 60000).toISOString()
}));

const mockDxNews = {
  items: [
    { title: 'VP6DX on the air', description: 'Pitcairn activity continues this week.' },
    { title: '3B9X update', description: 'Rodrigues pileup expected on 20m.' }
  ]
};

const mockGeoJson = { type: 'FeatureCollection', features: [] };

const originalFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';

  if (url.includes('/api/dxnews')) {
    return new Response(JSON.stringify(mockDxNews), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('/api/noaa/xray')) {
    return new Response(JSON.stringify(mockXray), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('api.open-meteo.com')) {
    return new Response(JSON.stringify(mockOpenMeteo), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.includes('world.geo.json')) {
    return new Response(JSON.stringify(mockGeoJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (originalFetch) return originalFetch(input, init);
  return new Response('{}', { status: 404 });
};

if (!globalThis.L) {
  const chain = {
    addTo: () => chain,
    bringToFront: () => chain,
    setLatLng: () => chain,
    setIcon: () => chain,
    setOpacity: () => chain,
    setStyle: () => chain,
    bindTooltip: () => chain,
    remove: () => chain
  };

  const map = {
    setView: () => map,
    on: () => map,
    off: () => map,
    remove: () => {},
    addLayer: () => map,
    removeLayer: () => map,
    getSize: () => ({ x: 800, y: 600 }),
    invalidateSize: () => {},
    eachLayer: () => {},
    addControl: () => map,
    removeControl: () => map
  };

  globalThis.L = {
    map: () => map,
    tileLayer: () => chain,
    terminator: () => chain,
    marker: () => chain,
    polyline: () => chain,
    circleMarker: () => chain,
    circle: () => chain,
    divIcon: () => ({}),
    geoJSON: () => chain
  };
}

if (!globalThis.hamclockLayerControls) {
  globalThis.hamclockLayerControls = {
    layers: [],
    toggleLayer: () => {},
    setOpacity: () => {}
  };
}

const preview = {
  parameters: {
    options: {
      storySort: {
        order: ['Overview', ['Home', '*'], '*']
      }
    },
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/
      }
    }
  }
};

export default preview;
