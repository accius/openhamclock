/**
 * EmComm Layout — Emergency Communications operations dashboard
 * Map with range rings + NWS/FEMA overlays, sidebar with structured panels
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { WorldMap } from '../components';
import { calculateDistance, formatDistance, parseGridSquare } from '../utils/geo.js';
import { esc } from '../utils/escapeHtml.js';
import { apiFetch } from '../utils/apiFetch.js';
import { winlinkModeLabel, winlinkModeColor } from '../utils/winlinkModes.js';

// APRS symbol codes for emergency-related stations
const EMCOMM_SYMBOLS = new Set([
  '/o', // EOC
  '\\z', // Shelter
  '\\!', // Emergency
  '/+', // Red Cross
  '\\a', // ARES
  '\\y', // Skywarn
  'Eo', // EOC alternate
  'So', // Shelter alternate
]);

const SYMBOL_LABELS = {
  '/o': 'EOC',
  '\\z': 'Shelter',
  '\\!': 'Emergency',
  '/+': 'Red Cross',
  '\\a': 'ARES',
  '\\y': 'Skywarn',
};

// APRS symbol to icon mapping for station type display
const SYMBOL_ICONS = {
  // Emergency / infrastructure
  '/o': '🏛️',
  '\\z': '🏥',
  '\\!': '🚨',
  '/+': '✚',
  '\\a': '📡',
  '\\y': '🌪️',
  Eo: '🏛️',
  So: '🏥',
  // Mobile / portable
  '/>': '🚗',
  '/[': '🧑',
  '/b': '🚲',
  '/R': '🚐',
  '/u': '🚌',
  '/j': '🏎️',
  '/v': '🚐',
  '/k': '🚚',
  '/Y': '⛵',
  '/X': '🚁',
  '/^': '✈️',
  '\\>': '🚗',
  '\\v': '🚐',
  // Fixed stations
  '/-': '🏠',
  '/a': '🏥',
  '/r': '📡',
  '/I': '📻',
  '/&': '◆',
  '\\-': '🏠',
  '\\r': '📡',
  // Weather
  '/_': '🌤️',
  '/W': '🌡️',
  '\\W': '🌡️',
  // Digipeaters / infrastructure
  '/#': '⬡',
  '/D': '🔁',
};

function getStationIcon(symbol) {
  if (!symbol) return '📍';
  return SYMBOL_ICONS[symbol] || '📍';
}

function getStationType(symbol) {
  if (!symbol) return 'unknown';
  const mobile = new Set(['/>', '\\>', '/[', '/b', '/R', '/u', '/j', '/v', '/k', '/Y', '/X', '/^', '\\v']);
  if (mobile.has(symbol)) return 'mobile';
  const fixed = new Set(['/-', '\\-', '/o', '\\z', '/a', '/r', '\\r', '/I', '/#', '/D', 'Eo', 'So']);
  if (fixed.has(symbol)) return 'fixed';
  return 'unknown';
}

const TOKEN_META = {
  Beds: { label: 'Beds', icon: '🛏️', color: '#22d3ee' },
  Water: { label: 'Water', icon: '💧', color: '#3b82f6' },
  Food: { label: 'Food', icon: '🍞', color: '#f59e0b' },
  Power: { label: 'Power', icon: '⚡', color: '#22c55e' },
  Fuel: { label: 'Fuel', icon: '⛽', color: '#ef4444' },
  Med: { label: 'Medical', icon: '🏥', color: '#dc2626' },
  Staff: { label: 'Staff', icon: '👥', color: '#a855f7' },
  Evac: { label: 'Evacuees', icon: '🚶', color: '#f97316' },
  Comms: { label: 'Comms', icon: '📡', color: '#22d3ee' },
  Gen: { label: 'Generator', icon: '🔋', color: '#eab308' },
};

const SEVERITY_COLORS = {
  Extreme: '#dc2626',
  Severe: '#ea580c',
  Moderate: '#d97706',
  Minor: '#ca8a04',
  Unknown: '#6b7280',
};

const SHELTER_STATUS_COLORS = {
  OPEN: '#22c55e',
  CLOSED: '#ef4444',
  FULL: '#f59e0b',
};

export default function EmcommLayout(props) {
  const {
    config,
    utcTime,
    utcDate,
    dxLocation,
    dxLocked,
    handleDXChange,
    handleToggleDxLock,
    mapLayers,
    toggleDXLabels,
    toggleSatellites,
    hoveredSpot,
    setHoveredSpot,
    filteredSatellites,
    filteredPskSpots,
    wsjtxMapSpots,
    dxClusterData,
    dxFilters,
    mapBandFilter,
    setMapBandFilter,
    aprsData,
    emcommData,
    setShowSettings,
  } = props;

  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(() => String(new Date().getUTCSeconds()).padStart(2, '0'));
  const [expandedAlert, setExpandedAlert] = useState(null);
  // APRS source filter: 'all' | 'internet' | 'rf'
  const [aprsSource, setAprsSource] = useState('all');
  // Net operations
  const [netRoster, setNetRoster] = useState([]);
  const [messageTarget, setMessageTarget] = useState(null); // callsign to message
  const [messageText, setMessageText] = useState('');
  // Nearby Winlink gateways
  const [winlinkRows, setWinlinkRows] = useState([]);
  const [winlinkServerHasKey, setWinlinkServerHasKey] = useState(true);
  const mapInstanceRef = useRef(null);
  const overlayLayersRef = useRef([]);

  // UTC seconds ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(String(new Date().getUTCSeconds()).padStart(2, '0'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch the Winlink gateway list once on mount and refresh hourly. The
  // server proxy already caches for 1h so this is essentially free; we use
  // the global list (not /proximity) because the proxy's MaxDistance unit
  // is unreliable — distance filtering happens client-side below.
  useEffect(() => {
    let alive = true;
    const fetchGateways = async () => {
      try {
        const res = await apiFetch('/api/winlink/gateways');
        if (!alive || !res) return;
        if (res.status === 503) {
          setWinlinkServerHasKey(false);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setWinlinkRows(Array.isArray(data.gateways) ? data.gateways : []);
      } catch {}
    };
    fetchGateways();
    const id = setInterval(fetchGateways, 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Poll net roster
  useEffect(() => {
    const fetchRoster = async () => {
      try {
        const res = await fetch('/api/aprs/net');
        if (res.ok) {
          const data = await res.json();
          setNetRoster(data.roster || []);
        }
      } catch (e) {}
    };
    fetchRoster();
    const timer = setInterval(fetchRoster, 10000);
    return () => clearInterval(timer);
  }, []);

  const { alerts = [], shelters = [], disasters = [], loading } = emcommData || {};
  const allAprsStations = aprsData?.stations || [];

  // Apply APRS source filter
  const aprsStations = useMemo(() => {
    if (aprsSource === 'rf') return allAprsStations.filter((s) => s.source === 'local-tnc');
    if (aprsSource === 'internet') return allAprsStations.filter((s) => s.source !== 'local-tnc');
    return allAprsStations;
  }, [allAprsStations, aprsSource]);

  // Filter APRS stations to emergency symbols
  const emcommStations = useMemo(() => {
    return aprsStations.filter((s) => s.symbol && EMCOMM_SYMBOLS.has(s.symbol));
  }, [aprsStations]);

  // Calculate distance from DE for shelters
  const sheltersWithDistance = useMemo(() => {
    if (config.location?.lat == null || config.location?.lon == null) return shelters;
    return shelters
      .map((s) => ({
        ...s,
        distance: s.lat && s.lon ? calculateDistance(config.location.lat, config.location.lon, s.lat, s.lon) : null,
      }))
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  }, [shelters, config.location]);

  // Calculate distance for emcomm APRS stations
  const emcommStationsWithDistance = useMemo(() => {
    if (config.location?.lat == null || config.location?.lon == null) return emcommStations;
    return emcommStations
      .map((s) => ({
        ...s,
        distance: s.lat && s.lon ? calculateDistance(config.location.lat, config.location.lon, s.lat, s.lon) : null,
      }))
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
  }, [emcommStations, config.location]);

  // Aggregate Winlink rows by callsign, decode location from gridsquare,
  // compute distance from operator's QTH, sort nearest-first. ~4800 rows
  // collapse to ~1200 unique gateways — cheap to recompute per change.
  const nearbyWinlinkGateways = useMemo(() => {
    if (!winlinkRows.length) return [];
    if (config.location?.lat == null || config.location?.lon == null) return [];
    const byCall = new Map();
    for (const r of winlinkRows) {
      if (!r.callsign || !r.gridsquare) continue;
      let entry = byCall.get(r.callsign);
      if (!entry) {
        const pos = parseGridSquare(r.gridsquare);
        if (!pos) continue;
        entry = {
          callsign: r.callsign,
          gridsquare: r.gridsquare,
          lat: pos.lat,
          lon: pos.lon,
          distance: calculateDistance(config.location.lat, config.location.lon, pos.lat, pos.lon),
          channels: [],
          hasEmcomm: false,
        };
        byCall.set(r.callsign, entry);
      }
      entry.channels.push({
        frequency: r.frequency,
        mode: r.mode,
        modeLabel: winlinkModeLabel(r.mode),
        serviceCode: r.serviceCode || 'PUBLIC',
        hours: r.hours,
      });
      if ((r.serviceCode || '').toUpperCase().includes('EMCOMM')) entry.hasEmcomm = true;
    }
    return [...byCall.values()].sort((a, b) => a.distance - b.distance).slice(0, 50);
  }, [winlinkRows, config.location]);

  // Sort alerts by severity
  const sortedAlerts = useMemo(() => {
    const order = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    return [...alerts].sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
  }, [alerts]);

  // Handle map ready — add range rings and overlays
  const handleMapReady = useCallback((map) => {
    mapInstanceRef.current = map;
  }, []);

  // Manage range rings and alert/shelter overlays
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || typeof window.L === 'undefined') return;
    const L = window.L;

    // Clear previous overlays
    overlayLayersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch (e) {
        /* ignore */
      }
    });
    overlayLayersRef.current = [];

    const de = config.location;
    if (de?.lat == null || de?.lon == null) return;

    // Range rings at 50, 100, 200 km
    [50, 100, 200].forEach((km) => {
      const ring = L.circle([de.lat, de.lon], {
        radius: km * 1000,
        fill: false,
        color: '#666',
        weight: 1,
        dashArray: '8,8',
        interactive: false,
      });
      ring.addTo(map);
      overlayLayersRef.current.push(ring);

      // Label
      const label = L.marker([de.lat + km / 111, de.lon], {
        icon: L.divIcon({
          className: '',
          html: `<span style="color:#888;font-size:10px;white-space:nowrap">${km}km</span>`,
          iconSize: [40, 14],
          iconAnchor: [20, 14],
        }),
        interactive: false,
      });
      label.addTo(map);
      overlayLayersRef.current.push(label);
    });

    // NWS Alert polygons
    alerts.forEach((alert) => {
      if (!alert.geometry?.coordinates) return;
      const color = SEVERITY_COLORS[alert.severity] || '#6b7280';
      try {
        const coords = alert.geometry.type === 'Polygon' ? [alert.geometry.coordinates] : alert.geometry.coordinates;
        coords.forEach((polyCoords) => {
          const latlngs = polyCoords[0].map(([lon, lat]) => [lat, lon]);
          const polygon = L.polygon(latlngs, {
            color,
            fillColor: color,
            fillOpacity: 0.15,
            weight: 2,
          });
          polygon.bindPopup(`<b>${esc(alert.event)}</b><br>${esc(alert.headline || '')}`);
          polygon.addTo(map);
          overlayLayersRef.current.push(polygon);
        });
      } catch (e) {
        /* skip malformed geometry */
      }
    });

    // Shelter markers
    shelters.forEach((shelter) => {
      if (shelter.lat == null || shelter.lon == null) return;
      const color = SHELTER_STATUS_COLORS[shelter.status] || '#6b7280';
      const marker = L.circleMarker([shelter.lat, shelter.lon], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 2,
      });
      const pop = `<b>${esc(shelter.name || 'Shelter')}</b><br>
        ${esc(shelter.address || '')}, ${esc(shelter.city || '')}<br>
        Status: ${esc(shelter.status || 'Unknown')}<br>
        Capacity: ${shelter.currentPopulation || 0}/${shelter.evacuationCapacity || '?'}
        ${shelter.wheelchairAccessible ? ' ♿' : ''}${shelter.petFriendly ? ' 🐾' : ''}`;
      marker.bindPopup(pop);
      marker.addTo(map);
      overlayLayersRef.current.push(marker);
    });

    // EmComm APRS station markers with token popups
    emcommStationsWithDistance.forEach((station) => {
      if (station.lat == null || station.lon == null) return;
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 6,
        color: '#22d3ee',
        fillColor: '#22d3ee',
        fillOpacity: 0.5,
        weight: 2,
      });
      const stationIcon = getStationIcon(station.symbol);
      const stationType = getStationType(station.symbol);
      const sourceTag = station.source === 'local-tnc' ? ' <span style="color:#22c55e;font-size:10px">RF</span>' : '';
      let popupHtml = `<b style="color:#22d3ee">${stationIcon} ${esc(station.ssid || station.call)}</b>${sourceTag}`;
      popupHtml += `<br><span style="color:#888">${esc(SYMBOL_LABELS[station.symbol] || 'EmComm')} (${stationType})</span>`;
      if (station.tokens && station.tokens.length > 0) {
        popupHtml += '<br><div style="margin-top:4px">';
        station.tokens.forEach((t) => {
          const meta = TOKEN_META[t.key] || { icon: '📦', label: esc(t.key) };
          let val;
          if (t.type === 'capacity') val = `${t.current}/${t.max}`;
          else if (t.type === 'need') val = `<span style="color:#ef4444">${esc(t.value)} NEEDED</span>`;
          else if (t.type === 'critical') val = '<span style="color:#ef4444">CRITICAL</span>';
          else val = esc(t.value);
          popupHtml += `${meta.icon} <b>${esc(meta.label)}:</b> ${val}<br>`;
        });
        popupHtml += '</div>';
        if (station.cleanComment) {
          popupHtml += `<div style="color:#888;margin-top:4px">${esc(station.cleanComment)}</div>`;
        }
      } else if (station.comment) {
        popupHtml += `<br>${esc(station.comment)}`;
      }
      marker.bindPopup(popupHtml);
      marker.addTo(map);
      overlayLayersRef.current.push(marker);
    });

    return () => {
      overlayLayersRef.current.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch (e) {
          /* ignore */
        }
      });
      overlayLayersRef.current = [];
    };
  }, [config.location, alerts, shelters, emcommStationsWithDistance]);

  // Click shelter to pan map
  const panToShelter = useCallback((shelter) => {
    const map = mapInstanceRef.current;
    if (map && shelter.lat && shelter.lon) {
      map.setView([shelter.lat, shelter.lon], 10, { animate: true });
    }
  }, []);

  // Time until expiry helper
  const expiresIn = useCallback((expiresStr) => {
    if (!expiresStr) return '';
    const diff = new Date(expiresStr) - new Date();
    if (diff <= 0) return 'Expired';
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  }, []);

  // Incident type icon
  const incidentIcon = useCallback((type) => {
    const icons = {
      Hurricane: '🌀',
      Tornado: '🌪️',
      Flood: '🌊',
      Fire: '🔥',
      'Severe Storm': '⛈️',
      Earthquake: '🏚️',
      'Snow/Ice': '❄️',
    };
    return icons[type] || '⚠️';
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '44px 1fr',
        background: '#0a0a0a',
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden',
        color: '#ccc',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: '#111',
          borderBottom: '1px solid #333',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{ color: '#f59e0b', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
            onClick={() => setShowSettings(true)}
          >
            {config.callsign || 'N0CALL'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '16px', letterSpacing: '2px' }}>
            EMERGENCY COMMUNICATIONS
          </span>
          <span
            style={{
              color: '#888',
              fontSize: '9px',
              border: '1px solid #555',
              borderRadius: '3px',
              padding: '1px 4px',
              marginLeft: '4px',
            }}
          >
            BETA
          </span>
          {loading && <span style={{ color: '#888', fontSize: '11px', marginLeft: '8px' }}>Loading...</span>}
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px' }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>
            {utcTime}:{seconds}
          </span>
          <span style={{ color: '#888', marginLeft: '6px', fontSize: '11px' }}>UTC</span>
        </div>
      </div>

      {/* MAIN: MAP + SIDEBAR */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', overflow: 'hidden' }}>
        {/* MAP */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <WorldMap
            config={config}
            deLocation={config.location}
            dxLocation={dxLocation}
            onDXChange={handleDXChange}
            dxLocked={dxLocked}
            potaSpots={[]}
            sotaSpots={[]}
            wwbotaSpots={[]}
            mySpots={[]}
            dxPaths={[]}
            dxFilters={dxFilters}
            mapBandFilter={mapBandFilter}
            onMapBandFilterChange={setMapBandFilter}
            satellites={[]}
            pskReporterSpots={[]}
            showDeDxMarkers={true}
            showDXPaths={false}
            showDXLabels={false}
            onToggleDXLabels={toggleDXLabels}
            showPOTA={false}
            showSOTA={false}
            showWWBOTA={false}
            showSatellites={false}
            showPSKReporter={false}
            showPSKPaths={false}
            wsjtxSpots={[]}
            showWSJTX={false}
            showDXNews={false}
            showAPRS={true}
            aprsStations={aprsData?.filteredStations}
            aprsWatchlistCalls={aprsData?.allWatchlistCalls}
            hoveredSpot={hoveredSpot}
            hideOverlays={true}
            callsign={config.callsign}
            lowMemoryMode={config.lowMemoryMode}
            allUnits={config.allUnits}
            mouseZoom={config.mouseZoom}
            onMapReady={handleMapReady}
          />
        </div>

        {/* SIDEBAR */}
        <div
          style={{
            background: '#111',
            borderLeft: '1px solid #333',
            overflowY: 'auto',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Resource Summary Dashboard */}
          <ResourceSummary stations={emcommStationsWithDistance} />

          {/* NWS Alerts Panel */}
          <PanelSection title="NWS Alerts" count={sortedAlerts.length} color="#dc2626">
            {sortedAlerts.length === 0 ? (
              <EmptyState text="No active alerts for your area" />
            ) : (
              sortedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    padding: '6px 8px',
                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity] || '#888'}`,
                    background: expandedAlert === alert.id ? '#1a1a1a' : 'transparent',
                    cursor: 'pointer',
                    marginBottom: '4px',
                  }}
                  onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: SEVERITY_COLORS[alert.severity], fontWeight: 600, fontSize: '12px' }}>
                      {alert.event}
                    </span>
                    <span style={{ color: '#888', fontSize: '10px' }}>{expiresIn(alert.expires)}</span>
                  </div>
                  <div style={{ color: '#aaa', fontSize: '11px', marginTop: '2px' }}>{alert.headline}</div>
                  {expandedAlert === alert.id && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#999', lineHeight: '1.4' }}>
                      {alert.description && (
                        <div style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
                          {alert.description.substring(0, 500)}
                          {alert.description.length > 500 ? '...' : ''}
                        </div>
                      )}
                      {alert.instruction && (
                        <div style={{ color: '#f59e0b', fontStyle: 'italic' }}>
                          {alert.instruction.substring(0, 300)}
                        </div>
                      )}
                      <div style={{ color: '#666', marginTop: '4px' }}>{alert.areaDesc}</div>
                    </div>
                  )}
                </div>
              ))
            )}
          </PanelSection>

          {/* Disaster Declarations Panel */}
          <PanelSection title="Disaster Declarations" count={disasters.length} color="#f59e0b">
            {disasters.length === 0 ? (
              <EmptyState text="No recent disaster declarations" />
            ) : (
              disasters.map((d) => (
                <div
                  key={d.id || d.disasterNumber}
                  style={{
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11px',
                    marginBottom: '2px',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{incidentIcon(d.incidentType)}</span>
                  <div>
                    <div style={{ color: '#ddd' }}>{d.declarationTitle}</div>
                    <div style={{ color: '#888', fontSize: '10px' }}>
                      {d.incidentType} —{' '}
                      {d.declarationType === 'DR'
                        ? 'Major'
                        : d.declarationType === 'EM'
                          ? 'Emergency'
                          : d.declarationType}
                    </div>
                  </div>
                </div>
              ))
            )}
          </PanelSection>

          {/* Shelters Panel */}
          <PanelSection title="Nearby Shelters" count={sheltersWithDistance.length} color="#22c55e">
            {sheltersWithDistance.length === 0 ? (
              <EmptyState text="No open shelters nearby" />
            ) : (
              sheltersWithDistance.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: '4px 8px',
                    cursor: 'pointer',
                    marginBottom: '3px',
                    borderRadius: '3px',
                  }}
                  onClick={() => panToShelter(s)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ddd', fontSize: '12px', fontWeight: 500 }}>
                      {s.name || 'Unnamed Shelter'}
                    </span>
                    <span
                      style={{
                        color: SHELTER_STATUS_COLORS[s.status] || '#888',
                        fontSize: '10px',
                        fontWeight: 600,
                      }}
                    >
                      {s.status || '?'}
                    </span>
                  </div>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}
                  >
                    <span style={{ color: '#888', fontSize: '10px' }}>
                      {s.distance != null ? formatDistance(s.distance, config.allUnits?.dist || 'imperial') : ''}{' '}
                      {s.wheelchairAccessible ? '♿' : ''} {s.petFriendly ? '🐾' : ''}
                    </span>
                    <CapacityBar current={s.currentPopulation} max={s.evacuationCapacity} />
                  </div>
                </div>
              ))
            )}
          </PanelSection>

          {/* EmComm Stations Panel (APRS) */}
          <PanelSection
            title="EmComm Stations"
            count={emcommStationsWithDistance.length}
            color="#22d3ee"
            extra={
              <select
                value={aprsSource}
                onChange={(e) => setAprsSource(e.target.value)}
                style={{
                  background: '#1a1f2e',
                  border: '1px solid #2a3040',
                  borderRadius: '3px',
                  color: '#888',
                  fontSize: '9px',
                  padding: '1px 4px',
                  marginLeft: '6px',
                }}
              >
                <option value="all">All Sources</option>
                <option value="rf">RF Only</option>
                <option value="internet">Internet Only</option>
              </select>
            }
          >
            {emcommStationsWithDistance.length === 0 ? (
              <EmptyState text="No emergency APRS stations heard" />
            ) : (
              emcommStationsWithDistance.map((s) => {
                const ageStr = s.age < 1 ? 'now' : s.age < 60 ? `${s.age}m ago` : `${Math.floor(s.age / 60)}h ago`;
                const hasTokens = s.tokens && s.tokens.length > 0;
                return (
                  <div
                    key={s.call}
                    style={{
                      padding: hasTokens ? '6px 8px' : '4px 8px',
                      fontSize: '11px',
                      marginBottom: hasTokens ? '4px' : '2px',
                      borderLeft: hasTokens ? '2px solid #22d3ee' : 'none',
                      background: hasTokens ? '#0d1117' : 'transparent',
                      borderRadius: hasTokens ? '4px' : '0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ marginRight: '4px' }}>{getStationIcon(s.symbol)}</span>
                        <span style={{ color: '#22d3ee', fontWeight: 600 }}>{s.ssid || s.call}</span>
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>
                          {SYMBOL_LABELS[s.symbol] || 'EmComm'}
                        </span>
                        {s.source === 'local-tnc' && (
                          <span style={{ color: '#22c55e', marginLeft: '4px', fontSize: '9px', fontWeight: 700 }}>
                            RF
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#888', fontSize: '10px', textAlign: 'right' }}>
                        {s.distance != null && (
                          <span>{formatDistance(s.distance, config.allUnits?.dist || 'imperial')} </span>
                        )}
                        <span>{ageStr}</span>
                      </div>
                    </div>
                    {hasTokens && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                        {s.tokens.map((t, i) => (
                          <TokenPill key={`${t.key}-${i}`} token={t} />
                        ))}
                      </div>
                    )}
                    {hasTokens && s.cleanComment && (
                      <div style={{ color: '#888', fontSize: '10px', marginTop: '3px' }}>{s.cleanComment}</div>
                    )}
                  </div>
                );
              })
            )}
          </PanelSection>

          {/* Winlink Gateways Panel */}
          <PanelSection title="Nearby Winlink Gateways" count={nearbyWinlinkGateways.length} color="#3b82f6">
            {!winlinkServerHasKey ? (
              <EmptyState text="Winlink API not configured on server" />
            ) : nearbyWinlinkGateways.length === 0 ? (
              <EmptyState text={winlinkRows.length ? 'No gateways within range' : 'Loading gateways…'} />
            ) : (
              nearbyWinlinkGateways.slice(0, 25).map((gw) => {
                // Show up to 3 channels closest to the operator (sorted by freq);
                // the rest are summarized as "+N more". Avoids tall rows when a
                // single gateway publishes 9+ channels.
                const sorted = gw.channels.slice().sort((a, b) => a.frequency - b.frequency);
                const top = sorted.slice(0, 3);
                const more = sorted.length - top.length;
                return (
                  <div
                    key={gw.callsign}
                    style={{
                      padding: '5px 8px',
                      fontSize: '11px',
                      marginBottom: '3px',
                      borderLeft: gw.hasEmcomm ? '2px solid #ef4444' : '2px solid #3b82f6',
                      background: '#0d1117',
                      borderRadius: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: '#3b82f6', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                          {gw.callsign}
                        </span>
                        {gw.hasEmcomm && (
                          <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '9px', fontWeight: 700 }}>
                            EMCOMM
                          </span>
                        )}
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>{gw.gridsquare}</span>
                      </div>
                      <span style={{ color: '#888', fontSize: '10px' }}>
                        {formatDistance(gw.distance, config.allUnits?.dist || 'imperial')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                      {top.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            borderRadius: '2px',
                            background: '#1a1f2e',
                            color: winlinkModeColor(c.mode),
                            fontFamily: 'JetBrains Mono, monospace',
                          }}
                        >
                          {(c.frequency / 1e6).toFixed(3)} {c.modeLabel}
                        </span>
                      ))}
                      {more > 0 && (
                        <span style={{ fontSize: '9px', color: '#666', alignSelf: 'center' }}>+{more} more</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </PanelSection>

          {/* Net Operations Panel */}
          <PanelSection title="Net Roster" count={netRoster.length} color="#a855f7">
            {netRoster.length === 0 ? (
              <EmptyState text="No operators checked in. Send 'CQ NETNAME status' to EMCOMM via APRS to check in." />
            ) : (
              netRoster.map((op) => {
                const ageStr = op.age < 1 ? 'now' : op.age < 60 ? `${op.age}m` : `${Math.floor(op.age / 60)}h`;
                return (
                  <div
                    key={op.call}
                    style={{
                      padding: '5px 8px',
                      fontSize: '11px',
                      borderLeft: `2px solid ${op.stale ? '#f59e0b' : '#22c55e'}`,
                      background: '#0d1117',
                      borderRadius: '4px',
                      marginBottom: '3px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: op.stale ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{op.call}</span>
                        <span style={{ color: '#888', marginLeft: '6px', fontSize: '10px' }}>{op.netName}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ color: '#888', fontSize: '10px' }}>{ageStr}</span>
                        <button
                          onClick={() => setMessageTarget(op.call)}
                          style={{
                            background: 'none',
                            border: '1px solid #333',
                            borderRadius: '3px',
                            color: '#888',
                            fontSize: '9px',
                            padding: '1px 4px',
                            cursor: 'pointer',
                          }}
                        >
                          MSG
                        </button>
                      </div>
                    </div>
                    {op.status && op.status !== 'Checked in' && (
                      <div style={{ color: '#aaa', fontSize: '10px', marginTop: '2px' }}>{op.status}</div>
                    )}
                    {op.tokens && op.tokens.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                        {op.tokens.map((tk, i) => (
                          <TokenPill key={`${tk.key}-${i}`} token={tk} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </PanelSection>

          {/* Message Compose */}
          {messageTarget && (
            <div
              style={{
                background: '#111620',
                border: '1px solid #2a3040',
                borderRadius: '6px',
                padding: '10px',
                marginTop: '8px',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}
              >
                <span style={{ color: '#22d3ee', fontWeight: 600, fontSize: '12px' }}>Message to {messageTarget}</span>
                <button
                  onClick={() => {
                    setMessageTarget(null);
                    setMessageText('');
                  }}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
                >
                  ✕
                </button>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value.slice(0, 67))}
                  placeholder="Type message (67 char max)"
                  maxLength={67}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: '#0a0e14',
                    border: '1px solid #2a3040',
                    borderRadius: '4px',
                    color: '#c4c9d4',
                    fontSize: '12px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && messageText.trim()) {
                      fetch('/api/aprs/message', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ to: messageTarget, message: messageText.trim() }),
                      }).catch(() => {});
                      setMessageText('');
                      setMessageTarget(null);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (!messageText.trim()) return;
                    fetch('/api/aprs/message', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ to: messageTarget, message: messageText.trim() }),
                    }).catch(() => {});
                    setMessageText('');
                    setMessageTarget(null);
                  }}
                  style={{
                    padding: '6px 12px',
                    background: '#22d3ee',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#000',
                    fontWeight: 600,
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Send
                </button>
              </div>
              <div style={{ fontSize: '9px', color: '#888', marginTop: '4px' }}>
                {messageText.length}/67 chars — sent via APRS (requires local TNC)
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Token pill badge */
function TokenPill({ token }) {
  const meta = TOKEN_META[token.key] || { icon: '📦', color: '#888', label: token.key };
  let display;
  if (token.type === 'capacity') display = `${token.current}/${token.max}`;
  else if (token.type === 'need') display = `${token.value}`;
  else if (token.type === 'critical') display = '!';
  else if (token.type === 'status') display = token.value;
  else display = String(token.value);

  const bg = token.type === 'critical' ? '#dc2626' : token.type === 'need' ? '#991b1b' : `${meta.color}22`;
  const fg = token.type === 'critical' || token.type === 'need' ? '#fff' : meta.color;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        background: bg,
        color: fg,
        fontSize: '10px',
        fontWeight: 600,
        padding: '1px 5px',
        borderRadius: '4px',
        border: `1px solid ${meta.color}44`,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.icon} {display}
    </span>
  );
}

/** Resource summary dashboard — aggregates tokens from all emcomm stations */
function ResourceSummary({ stations }) {
  const aggregated = useMemo(() => {
    const byKey = {};
    stations.forEach((s) => {
      (s.tokens || []).forEach((t) => {
        if (!byKey[t.key])
          byKey[t.key] = {
            key: t.key,
            capacity: [],
            needs: 0,
            quantities: 0,
            statuses: { ok: 0, critical: 0 },
            count: 0,
          };
        const agg = byKey[t.key];
        agg.count++;
        if (t.type === 'capacity') agg.capacity.push({ current: t.current, max: t.max });
        else if (t.type === 'need') agg.needs += t.value;
        else if (t.type === 'quantity') agg.quantities += t.value;
        else if (t.type === 'status') agg.statuses.ok++;
        else if (t.type === 'critical') agg.statuses.critical++;
      });
    });
    return Object.values(byKey);
  }, [stations]);

  if (aggregated.length === 0) return null;

  return (
    <PanelSection title="Resource Summary" count={aggregated.length} color="#f59e0b">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 6px' }}>
        {aggregated.map((agg) => {
          const meta = TOKEN_META[agg.key] || { icon: '📦', color: '#888', label: agg.key };
          return (
            <div
              key={agg.key}
              style={{
                background: '#1a1a1a',
                borderRadius: '6px',
                padding: '6px 10px',
                minWidth: '100px',
                flex: '1 1 calc(50% - 6px)',
                border: `1px solid ${meta.color}33`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px' }}>{meta.icon}</span>
                <span style={{ color: meta.color, fontSize: '11px', fontWeight: 600 }}>{meta.label}</span>
              </div>
              {agg.capacity.length > 0 &&
                (() => {
                  const totalCurrent = agg.capacity.reduce((s, c) => s + c.current, 0);
                  const totalMax = agg.capacity.reduce((s, c) => s + c.max, 0);
                  const pct = totalMax > 0 ? Math.round((totalCurrent / totalMax) * 100) : 0;
                  const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
                  return (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '10px',
                          color: '#aaa',
                          marginBottom: '2px',
                        }}
                      >
                        <span>
                          {totalCurrent}/{totalMax}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: '5px',
                          background: '#333',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '3px' }} />
                      </div>
                    </div>
                  );
                })()}
              {agg.needs < 0 && (
                <div style={{ color: '#ef4444', fontSize: '11px', fontWeight: 700 }}>{agg.needs} NEEDED</div>
              )}
              {agg.quantities > 0 && <div style={{ color: '#aaa', fontSize: '11px' }}>{agg.quantities} units</div>}
              {(agg.statuses.ok > 0 || agg.statuses.critical > 0) && (
                <div style={{ fontSize: '10px', display: 'flex', gap: '6px' }}>
                  {agg.statuses.ok > 0 && <span style={{ color: '#22c55e' }}>{agg.statuses.ok} OK</span>}
                  {agg.statuses.critical > 0 && <span style={{ color: '#ef4444' }}>{agg.statuses.critical} CRIT</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelSection>
  );
}

/** Collapsible panel section wrapper */
function PanelSection({ title, count, color, extra, children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ background: '#0d0d0d', borderRadius: '6px', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid #222',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#888', fontSize: '10px' }}>{collapsed ? '▶' : '▼'}</span>
          <span
            style={{
              color: color || '#ccc',
              fontWeight: 600,
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {title}
          </span>
          {extra && <span onClick={(e) => e.stopPropagation()}>{extra}</span>}
        </div>
        {count > 0 && (
          <span
            style={{
              background: color || '#888',
              color: '#000',
              fontSize: '10px',
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: '8px',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {count}
          </span>
        )}
      </div>
      {!collapsed && <div style={{ padding: '4px 2px', maxHeight: '250px', overflowY: 'auto' }}>{children}</div>}
    </div>
  );
}

/** Capacity bar for shelters */
function CapacityBar({ current, max }) {
  if (!max || max <= 0) return null;
  const pct = Math.min(100, Math.round(((current || 0) / max) * 100));
  const color = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div
        style={{
          width: '40px',
          height: '6px',
          background: '#333',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px' }} />
      </div>
      <span style={{ color: '#888', fontSize: '9px' }}>
        {current || 0}/{max}
      </span>
    </div>
  );
}

/** Empty state placeholder */
function EmptyState({ text }) {
  return (
    <div style={{ padding: '12px 8px', color: '#555', fontSize: '11px', textAlign: 'center', fontStyle: 'italic' }}>
      {text}
    </div>
  );
}
