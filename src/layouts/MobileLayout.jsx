/**
 * MobileLayout — a phone or tablet as the primary display, in a go-box or
 * in the field.
 *
 * Portrait:  compact header (callsign, UTC/local, one line of space-weather
 *            chips) | the map at a usable height | a horizontally swipeable
 *            row of panel cards with a dot indicator.
 * Landscape: one-line header | map on the left, one card on the right.
 *
 * Tapping a card's header opens it full screen with a Back control (the
 * browser/Android back gesture works too). The last card shown is
 * remembered. Only the visible card and its neighbours are mounted, so a
 * phone doesn't run every panel's fetches at once.
 *
 * The root is position:fixed to the visible viewport (100vh is taller than
 * the screen on mobile Safari), with safe-area insets for notched phones and
 * 16 px gutters. All card/persistence logic lives in utils/mobileLayout.js.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WorldMap,
  DXClusterPanel,
  PotaSotaPanel,
  PropagationPanel,
  SolarPanel,
  SatellitePassesPanel,
  WeatherPanel,
  PSKReporterPanel,
  APRSPanel,
} from '../components';
import LogbookPanel from '../components/LogbookPanel.jsx';
import MobileEmcommCard from '../components/MobileEmcommCard.jsx';
import { IconGear, IconExpand, IconShrink } from '../components/Icons.jsx';
import { useRig } from '../contexts/RigContext.jsx';
import { findDXPathForSpot } from '../utils/dxClusterSpotMatcher';
import { formatTemperature } from '../utils/formatWeather.js';
import {
  buildMobileCards,
  readLastCardIndex,
  writeLastCard,
  cardIndexFromScroll,
  scrollLeftForCard,
  isLandscape as isLandscapeViewport,
  isStandaloneDisplay,
  portraitMapHeight,
  MOBILE_CARD_DEFS,
  PREVIOUS_LAYOUT_KEY,
  readCardPrefs,
  writeCardPrefs,
  toggleCardPref,
  isCardEnabled,
} from '../utils/mobileLayout.js';

const GAP = 12; // px between cards in the swipe row
const GUTTER = 16; // px page gutter (plus safe-area insets)

const CARD_LABELS = {
  emcomm: ['mobileLayout.card.emcomm', 'EmComm'],
  'dx-cluster': ['mobileLayout.card.dxCluster', 'DX Cluster'],
  activations: ['mobileLayout.card.activations', 'POTA / SOTA'],
  propagation: ['mobileLayout.card.propagation', 'Propagation'],
  solar: ['mobileLayout.card.solar', 'Solar'],
  satellites: ['mobileLayout.card.satellites', 'Satellites'],
  logbook: ['mobileLayout.card.logbook', 'Logbook'],
  weather: ['mobileLayout.card.weather', 'Weather'],
  psk: ['mobileLayout.card.psk', 'PSK / WSJT-X'],
  aprs: ['mobileLayout.card.aprs', 'APRS'],
};

const readViewport = () => ({
  w: typeof window !== 'undefined' ? window.innerWidth : 390,
  h: typeof window !== 'undefined' ? window.innerHeight : 844,
});

const kColor = (k) => {
  const n = parseFloat(k);
  if (Number.isNaN(n)) return 'var(--text-primary)';
  if (n >= 5) return 'var(--accent-red)';
  if (n >= 4) return 'var(--accent-amber)';
  return 'var(--accent-green)';
};

function Chip({ label, value, color }) {
  return (
    <span className="ohc-mobile-chip">
      {label && <span style={{ color: 'var(--text-muted)' }}>{label}</span>}
      <span style={{ color: color || 'var(--text-primary)', fontWeight: 700 }}>{value}</span>
    </span>
  );
}

export default function MobileLayout(props) {
  const {
    config,
    utcTime,
    localTime,
    use12Hour,
    handleTimeFormatToggle,
    setShowSettings,
    handleFullscreenToggle,
    isFullscreen,
    isLocalInstall,
    deGrid,
    deSunTimes,
    currentTime,
    localWeather,
    localAlerts,
    spaceWeather,
    solarIndices,
    bandConditions,
    propagation,
    dxLocation,
    dxLocked,
    handleDXChange,
    dxClusterData,
    potaSpots,
    filteredPotaSpots,
    wwffSpots,
    filteredWwffSpots,
    sotaSpots,
    filteredSotaSpots,
    wwbotaSpots,
    filteredWwbotaSpots,
    mySpots,
    satellites,
    filteredSatellites,
    pskReporter,
    wsjtx,
    aprsData,
    meshcomData,
    filteredPskSpots,
    wsjtxMapSpots,
    dxFilters,
    setDxFilters,
    mapBandFilter,
    setMapBandFilter,
    pskFilters,
    setShowDXFilters,
    setShowPSKFilters,
    setShowPotaFilters,
    setShowSotaFilters,
    setShowWwffFilters,
    setShowWwbotaFilters,
    potaFilters,
    sotaFilters,
    wwffFilters,
    wwbotaFilters,
    mapLayers = {},
    toggleDXPaths,
    toggleDXLabels,
    togglePOTA,
    togglePOTALabels,
    toggleWWFF,
    toggleWWFFLabels,
    toggleSOTA,
    toggleSOTALabels,
    toggleWWBOTA,
    toggleWWBOTALabels,
    toggleSatellites,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    toggleAPRS,
    toggleAPRSLabels,
    cycleAprsIconScale,
    hoveredSpot,
    setHoveredSpot,
  } = props;

  const { t } = useTranslation();
  const { tuneTo } = useRig();

  // ── Viewport (orientation) ──────────────────────────────────────────────
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = readViewport();
        setVp((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  const landscape = isLandscapeViewport(vp.w, vp.h);
  const standalone = useMemo(() => isStandaloneDisplay(typeof window !== 'undefined' ? window : null), []);
  const canFullscreen =
    !standalone && typeof document !== 'undefined' && !!document.fullscreenEnabled && !!handleFullscreenToggle;

  // ── Cards ───────────────────────────────────────────────────────────────
  // Card-picker choices. With nothing saved yet the EmComm card defaults on
  // only for an operator who came here from the EmComm layout; that default
  // is saved straight away so a later trip through another layout (the idle
  // clock, say) doesn't change it.
  const [cardPrefs, setCardPrefs] = useState(() => {
    try {
      const p = readCardPrefs(window.localStorage, window.localStorage.getItem(PREVIOUS_LAYOUT_KEY));
      if (p.isDefault) writeCardPrefs(window.localStorage, p);
      return { enabled: p.enabled };
    } catch {
      return { enabled: {} };
    }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const cardCtx = { panels: config?.panels, showAPRS: !!mapLayers.showAPRS };
  const toggleCard = (id) => {
    setCardPrefs((prev) => {
      const next = toggleCardPref(prev, id, cardCtx);
      try {
        writeCardPrefs(window.localStorage, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const cards = useMemo(
    () => buildMobileCards({ panels: config?.panels, showAPRS: !!mapLayers.showAPRS, prefs: cardPrefs }),
    [config?.panels, mapLayers.showAPRS, cardPrefs],
  );
  const cardKey = cards.map((c) => c.id).join(',');
  const [active, setActive] = useState(() => {
    try {
      return readLastCardIndex(window.localStorage, cards);
    } catch {
      return 0;
    }
  });
  const activeIdx = Math.min(active, Math.max(0, cards.length - 1));
  const [expanded, setExpanded] = useState(null); // card id shown full screen
  const stripRef = useRef(null);
  const activeRef = useRef(activeIdx);
  activeRef.current = activeIdx;

  // Snap the strip to the active card on mount, on rotation, and when the
  // card list changes (instant — no animation on layout changes).
  // The remembered card is re-resolved by id, so a card appearing or
  // disappearing (APRS layer toggled) never shifts you onto another card.
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    let idx = activeRef.current;
    try {
      idx = readLastCardIndex(window.localStorage, cards);
    } catch {
      /* keep current */
    }
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
    }
    el.scrollLeft = scrollLeftForCard(idx, el.clientWidth, GAP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vp.w, vp.h, landscape, cardKey]);

  const onStripScroll = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const idx = cardIndexFromScroll(el.scrollLeft, el.clientWidth, GAP, cards.length);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
      try {
        writeLastCard(window.localStorage, cards[idx]?.id);
      } catch {
        /* ignore */
      }
    }
  }, [cards]);

  const goToCard = useCallback(
    (idx) => {
      const el = stripRef.current;
      if (!el) return;
      const left = scrollLeftForCard(idx, el.clientWidth, GAP);
      if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: 'smooth' });
      else el.scrollLeft = left;
      // Commit immediately too: a smooth scroll might not fire (jsdom,
      // reduced motion) and the scroll handler settles on the same index.
      activeRef.current = idx;
      setActive(idx);
      try {
        writeLastCard(window.localStorage, cards[idx]?.id);
      } catch {
        /* ignore */
      }
    },
    [cards],
  );

  // ── Full-screen card: Back button, Escape, and the browser back gesture ──
  const openCard = useCallback((id) => {
    setExpanded(id);
    try {
      window.history.pushState({ ...(window.history.state || {}), ohcMobileCard: id }, '');
    } catch {
      /* ignore */
    }
  }, []);
  const closeCard = useCallback(() => {
    try {
      if (window.history.state?.ohcMobileCard) {
        window.history.back(); // popstate below clears `expanded`
        return;
      }
    } catch {
      /* ignore */
    }
    setExpanded(null);
  }, []);
  useEffect(() => {
    if (!expanded) return undefined;
    const onPop = () => setExpanded(null);
    const onKey = (e) => {
      if (e.key === 'Escape') closeCard();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded, closeCard]);
  // A card that disappears (panel hidden, APRS layer off) can't stay open
  useEffect(() => {
    if (expanded && !cards.some((c) => c.id === expanded)) setExpanded(null);
  }, [expanded, cards]);

  // ── Spot handlers ───────────────────────────────────────────────────────
  const handleParkSpotClick = (spot) => {
    tuneTo(spot);
    if (spot?.lat != null && spot?.lon != null) {
      handleDXChange({ lat: spot.lat, lon: spot.lon, callsign: spot.call ?? null });
    }
  };
  const handleDXSpotClick = (spot) => {
    tuneTo(spot);
    const path = findDXPathForSpot(dxClusterData?.paths || [], spot);
    if (path && path.dxLat != null && path.dxLon != null) {
      handleDXChange({ lat: path.dxLat, lon: path.dxLon, callsign: spot.call ?? spot.dxCall ?? null });
    }
  };

  const cardLabel = (id) => {
    const [key, defaultValue] = CARD_LABELS[id] || [id, id];
    return t(key, { defaultValue });
  };

  // ── Panel content per card ──────────────────────────────────────────────
  const panelFor = (id) => {
    switch (id) {
      case 'emcomm':
        return <MobileEmcommCard location={config.location} allUnits={config.allUnits} />;
      case 'dx-cluster':
        return (
          <DXClusterPanel
            data={dxClusterData?.spots}
            loading={dxClusterData?.loading}
            error={dxClusterData?.error}
            totalSpots={dxClusterData?.totalSpots}
            filters={dxFilters}
            onFilterChange={setDxFilters}
            onOpenFilters={() => setShowDXFilters?.(true)}
            onHoverSpot={setHoveredSpot}
            onSpotClick={handleDXSpotClick}
            hoveredSpot={hoveredSpot}
            showOnMap={mapLayers.showDXPaths}
            onToggleMap={toggleDXPaths}
            userCallsign={config.callsign}
            deLat={config.location?.lat}
            deLon={config.location?.lon}
          />
        );
      case 'activations':
        return (
          <PotaSotaPanel
            potaData={potaSpots?.data}
            potaLoading={potaSpots?.loading}
            potaLastUpdated={potaSpots?.lastUpdated}
            potaLastChecked={potaSpots?.lastChecked}
            showPOTA={mapLayers.showPOTA}
            onTogglePOTA={togglePOTA}
            showPOTALabels={mapLayers.showPOTALabels}
            togglePOTALabels={togglePOTALabels}
            onPOTASpotClick={handleParkSpotClick}
            onPOTAHoverSpot={setHoveredSpot}
            potaFilters={potaFilters}
            setShowPotaFilters={setShowPotaFilters}
            filteredPotaSpots={filteredPotaSpots}
            sotaData={sotaSpots?.data}
            sotaLoading={sotaSpots?.loading}
            sotaLastUpdated={sotaSpots?.lastUpdated}
            sotaLastChecked={sotaSpots?.lastChecked}
            showSOTA={mapLayers.showSOTA}
            onToggleSOTA={toggleSOTA}
            showSOTALabels={mapLayers.showSOTALabels}
            toggleSOTALabels={toggleSOTALabels}
            onSOTASpotClick={handleParkSpotClick}
            onSOTAHoverSpot={setHoveredSpot}
            sotaFilters={sotaFilters}
            setShowSotaFilters={setShowSotaFilters}
            filteredSotaSpots={filteredSotaSpots}
            wwffData={wwffSpots?.data}
            wwffLoading={wwffSpots?.loading}
            wwffLastUpdated={wwffSpots?.lastUpdated}
            wwffLastChecked={wwffSpots?.lastChecked}
            showWWFF={mapLayers.showWWFF}
            onToggleWWFF={toggleWWFF}
            showWWFFLabels={mapLayers.showWWFFLabels}
            toggleWWFFLabels={toggleWWFFLabels}
            onWWFFSpotClick={handleParkSpotClick}
            onWWFFHoverSpot={setHoveredSpot}
            wwffFilters={wwffFilters}
            setShowWwffFilters={setShowWwffFilters}
            filteredWwffSpots={filteredWwffSpots}
            wwbotaData={wwbotaSpots?.data}
            wwbotaLoading={wwbotaSpots?.loading}
            wwbotaLastUpdated={wwbotaSpots?.lastUpdated}
            wwbotaConnected={wwbotaSpots?.connected}
            showWWBOTA={mapLayers.showWWBOTA}
            onToggleWWBOTA={toggleWWBOTA}
            showWWBOTALabels={mapLayers.showWWBOTALabels}
            toggleWWBOTALabels={toggleWWBOTALabels}
            onWWBOTASpotClick={handleParkSpotClick}
            onWWBOTAHoverSpot={setHoveredSpot}
            wwbotaFilters={wwbotaFilters}
            setShowWwbotaFilters={setShowWwbotaFilters}
            filteredWwbotaSpots={filteredWwbotaSpots}
          />
        );
      case 'propagation':
        return (
          <PropagationPanel
            propagation={propagation?.data}
            loading={propagation?.loading}
            bandConditions={bandConditions}
            allUnits={config.allUnits}
            propConfig={config.propagation}
            dxSpots={dxClusterData?.spots}
            clusterFilters={dxFilters}
            deSunTimes={deSunTimes}
            currentTime={currentTime}
            timeZone={config.timezone}
          />
        );
      case 'solar':
        return <SolarPanel solarIndices={solarIndices} bandConditions={bandConditions} config={config} />;
      case 'satellites':
        return <SatellitePassesPanel satellites={satellites} config={config} />;
      case 'logbook':
        return <LogbookPanel userCallsign={config.callsign} myGrid={deGrid} />;
      case 'weather':
        return (
          <div className="panel" style={{ padding: '10px', height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
            <WeatherPanel weatherData={localWeather} allUnits={config.allUnits} alerts={localAlerts} />
          </div>
        );
      case 'psk':
        return (
          <PSKReporterPanel
            callsign={config.callsign}
            showMutualReception={config.showMutualReception !== false}
            pskReporter={pskReporter}
            showOnMap={mapLayers.showPSKReporter}
            onToggleMap={togglePSKReporter}
            showPaths={mapLayers.showPSKPaths}
            onTogglePaths={togglePSKPaths}
            filters={pskFilters}
            onOpenFilters={() => setShowPSKFilters?.(true)}
            onShowOnMap={(r) => {
              if (r.lat != null && r.lon != null) handleDXChange({ lat: r.lat, lon: r.lon });
            }}
            wsjtxDecodes={wsjtx?.decodes}
            wsjtxClients={wsjtx?.clients}
            wsjtxQsos={wsjtx?.qsos}
            wsjtxWspr={wsjtx?.wspr}
            wsjtxStats={wsjtx?.stats}
            wsjtxLoading={wsjtx?.loading}
            wsjtxEnabled={wsjtx?.enabled}
            wsjtxPort={wsjtx?.port}
            wsjtxRelayEnabled={wsjtx?.relayEnabled}
            wsjtxRelayConnected={wsjtx?.relayConnected}
            wsjtxSessionId={wsjtx?.sessionId}
            showWSJTXOnMap={mapLayers.showWSJTX}
            onToggleWSJTXMap={toggleWSJTX}
            wsjtxRelayMulticast={config.wsjtxRelayMulticast}
          />
        );
      case 'aprs':
        return (
          <APRSPanel
            aprsData={aprsData}
            showOnMap={mapLayers.showAPRS}
            onToggleMap={toggleAPRS}
            showLabelsOnMap={mapLayers.showAPRSLabels}
            onToggleLabelsOnMap={toggleAPRSLabels}
            iconScale={mapLayers.aprsIconScale ?? 1}
            onCycleIconScale={cycleAprsIconScale}
            onHoverSpot={setHoveredSpot}
            onSpotClick={handleParkSpotClick}
            deLocation={config.location}
            units={config.allUnits?.dist}
          />
        );
      default:
        return null;
    }
  };

  // ── Header ──────────────────────────────────────────────────────────────
  const sfi = solarIndices?.data?.sfi?.current ?? spaceWeather?.data?.solarFlux ?? '--';
  const kp = solarIndices?.data?.kp?.current ?? spaceWeather?.data?.kIndex ?? '--';
  const ssn = solarIndices?.data?.ssn?.current ?? spaceWeather?.data?.sunspotNumber ?? '--';
  const aIdx = bandConditions?.extras?.aIndex;
  const wx = localWeather?.data;
  const wxTemp = wx?.rawTempC != null ? formatTemperature(wx.rawTempC, config.allUnits) : null;
  const showCall = config.callsign && config.callsign !== 'N0CALL';

  const iconBtn = (onClick, label, child) => (
    <button type="button" className="ohc-mobile-iconbtn" onClick={onClick} aria-label={label} title={label}>
      {child}
    </button>
  );

  const utcEl = (
    <span className="ohc-mobile-clock" style={{ color: 'var(--accent-cyan)' }}>
      <span className="ohc-mobile-clock-label">UTC</span>
      {utcTime}
    </span>
  );
  const localEl = (
    <button
      type="button"
      className="ohc-mobile-clock ohc-mobile-clock-btn"
      style={{ color: 'var(--accent-amber)' }}
      onClick={handleTimeFormatToggle}
      title={use12Hour ? '24h' : '12h'}
    >
      <span className="ohc-mobile-clock-label">{t('mobileLayout.local', { defaultValue: 'LOCAL' })}</span>
      {localTime}
    </button>
  );

  // One line, never wraps: scrolls sideways inside itself on very narrow screens
  const chips = (
    <div className="ohc-mobile-chips" aria-label={t('mobileLayout.spaceWeather', { defaultValue: 'Space weather' })}>
      {!landscape && localEl}
      <Chip label="SFI" value={sfi} color="var(--accent-amber)" />
      <Chip label="K" value={kp} color={kColor(kp)} />
      <Chip label="SSN" value={ssn} color="var(--accent-cyan)" />
      {aIdx != null && aIdx !== '' && <Chip label="A" value={aIdx} />}
      {wxTemp && <Chip label={wx?.icon || ''} value={wxTemp} />}
    </div>
  );

  const buttons = (
    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
      {canFullscreen &&
        iconBtn(
          handleFullscreenToggle,
          isFullscreen
            ? t('mobileLayout.exitFullscreen', { defaultValue: 'Exit full screen' })
            : t('mobileLayout.fullscreen', { defaultValue: 'Full screen' }),
          isFullscreen ? <IconShrink size={18} /> : <IconExpand size={18} />,
        )}
      {iconBtn(
        () => setShowSettings?.(true),
        t('mobileLayout.settings', { defaultValue: 'Settings' }),
        <IconGear size={18} />,
      )}
    </div>
  );

  const callsignEl = (
    <button
      type="button"
      className="ohc-mobile-call"
      onClick={() => setShowSettings?.(true)}
      title={t('mobileLayout.settings', { defaultValue: 'Settings' })}
    >
      {showCall ? config.callsign : 'OpenHamClock'}
    </button>
  );

  const headerEl = landscape ? (
    <header className="ohc-mobile-header ohc-mobile-header--row">
      {callsignEl}
      {utcEl}
      {localEl}
      {chips}
      {buttons}
    </header>
  ) : (
    <header className="ohc-mobile-header">
      <div className="ohc-mobile-header-line">
        {callsignEl}
        {utcEl}
        {buttons}
      </div>
      {chips}
    </header>
  );

  // ── Map ─────────────────────────────────────────────────────────────────
  const mapEl = (
    <div className="ohc-mobile-map">
      <WorldMap
        config={config}
        isLocalInstall={isLocalInstall}
        deLocation={config.location}
        dxLocation={dxLocation}
        onDXChange={handleDXChange}
        dxLocked={dxLocked}
        potaSpots={filteredPotaSpots ? filteredPotaSpots : potaSpots?.data}
        wwffSpots={filteredWwffSpots ? filteredWwffSpots : wwffSpots?.data}
        sotaSpots={filteredSotaSpots ? filteredSotaSpots : sotaSpots?.data}
        wwbotaSpots={filteredWwbotaSpots ? filteredWwbotaSpots : wwbotaSpots?.data}
        mySpots={mySpots?.data}
        dxPaths={dxClusterData?.paths}
        dxFilters={dxFilters}
        mapBandFilter={mapBandFilter}
        onMapBandFilterChange={setMapBandFilter}
        satellites={filteredSatellites}
        pskReporterSpots={filteredPskSpots}
        showDeDxMarkers={mapLayers.showDeDxMarkers}
        showDXPaths={mapLayers.showDXPaths}
        showDXLabels={mapLayers.showDXLabels}
        onToggleDXLabels={toggleDXLabels}
        spotLabelMode={mapLayers.spotLabelMode}
        spotLabelMinKm={mapLayers.spotLabelMinKm}
        showPOTA={mapLayers.showPOTA}
        showPOTALabels={mapLayers.showPOTALabels}
        showWWFF={mapLayers.showWWFF}
        showWWFFLabels={mapLayers.showWWFFLabels}
        showSOTA={mapLayers.showSOTA}
        showSOTALabels={mapLayers.showSOTALabels}
        showWWBOTA={mapLayers.showWWBOTA}
        showWWBOTALabels={mapLayers.showWWBOTALabels}
        showSatellites={mapLayers.showSatellites}
        showPSKReporter={mapLayers.showPSKReporter}
        showPSKPaths={mapLayers.showPSKPaths}
        showMutualReception={config.showMutualReception !== false}
        wsjtxSpots={wsjtxMapSpots}
        showWSJTX={mapLayers.showWSJTX}
        showDXNews={mapLayers.showDXNews}
        showAPRS={mapLayers.showAPRS}
        aprsStations={aprsData?.filteredStations}
        aprsWatchlistCalls={aprsData?.allWatchlistCalls}
        showAPRSLabels={mapLayers.showAPRSLabels}
        aprsIconScale={mapLayers.aprsIconScale ?? 1}
        showMeshCom={mapLayers.showMeshCom}
        meshcomNodes={meshcomData?.nodes}
        onToggleSatellites={toggleSatellites}
        hoveredSpot={hoveredSpot}
        callsign={config.callsign}
        lowMemoryMode={config.lowMemoryMode}
        allUnits={config.allUnits}
        mouseZoom={config.mouseZoom}
        onSpotClick={tuneTo}
        compactControls
      />
    </div>
  );

  // ── Card strip + dots ───────────────────────────────────────────────────
  const strip = (
    <div
      ref={stripRef}
      className="ohc-mobile-strip"
      onScroll={onStripScroll}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('mobileLayout.cards', { defaultValue: 'Panel cards' })}
    >
      {cards.map((card, i) => {
        // Mount the visible card and its neighbours only
        const live = Math.abs(i - activeIdx) <= 1 && expanded !== card.id;
        const name = cardLabel(card.id);
        return (
          <section
            key={card.id}
            className="ohc-mobile-card"
            aria-roledescription="slide"
            aria-label={name}
            aria-hidden={i !== activeIdx}
            data-card={card.id}
          >
            {/* Panels that draw their own titled header get no second title;
                the full-screen button under the cards covers every card. */}
            {!card.ownHeader && (
              <button
                type="button"
                className="ohc-mobile-card-head"
                onClick={() => openCard(card.id)}
                aria-label={t('mobileLayout.expand', { defaultValue: 'Open {{name}} full screen', name })}
                tabIndex={i === activeIdx ? 0 : -1}
              >
                <span aria-hidden="true">{card.icon}</span>
                <span className="ohc-mobile-card-title">{name}</span>
                <span aria-hidden="true" className="ohc-mobile-card-expand">
                  ⤢
                </span>
              </button>
            )}
            <div className="ohc-mobile-card-body">
              {live ? (
                panelFor(card.id)
              ) : (
                <div className="ohc-mobile-card-placeholder" aria-hidden="true">
                  {card.icon}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );

  const activeCard = cards[activeIdx];
  const activeName = activeCard ? cardLabel(activeCard.id) : '';
  const dots = (
    <div className="ohc-mobile-dots-row">
      <button
        type="button"
        className="ohc-mobile-picker-btn"
        onClick={() => setPickerOpen(true)}
        aria-label={t('mobileLayout.picker.open', { defaultValue: 'Choose cards' })}
        title={t('mobileLayout.picker.open', { defaultValue: 'Choose cards' })}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <nav className="ohc-mobile-dots" aria-label={t('mobileLayout.cards', { defaultValue: 'Panel cards' })}>
        {cards.map((card, i) => {
          const name = cardLabel(card.id);
          return (
            <button
              key={card.id}
              type="button"
              className={`ohc-mobile-dot${i === activeIdx ? ' is-active' : ''}`}
              onClick={() => goToCard(i)}
              aria-label={t('mobileLayout.showCard', { defaultValue: 'Show {{name}}', name })}
              aria-current={i === activeIdx ? 'true' : undefined}
              title={name}
            >
              <span />
            </button>
          );
        })}
      </nav>
      {activeCard && (
        <button
          type="button"
          className="ohc-mobile-expand-btn"
          onClick={() => openCard(activeCard.id)}
          aria-label={t('mobileLayout.expand', { defaultValue: 'Open {{name}} full screen', name: activeName })}
          title={t('mobileLayout.expand', { defaultValue: 'Open {{name}} full screen', name: activeName })}
        >
          <span aria-hidden="true">⤢</span>
        </button>
      )}
    </div>
  );

  const expandedCard = expanded ? cards.find((c) => c.id === expanded) : null;

  return (
    <div className={`ohc-mobile-layout${landscape ? ' is-landscape' : ''}`} style={{ '--ohc-gutter': `${GUTTER}px` }}>
      {headerEl}
      {landscape ? (
        <div className="ohc-mobile-body-row">
          {mapEl}
          <div className="ohc-mobile-side">
            {strip}
            {dots}
          </div>
        </div>
      ) : (
        <>
          <div className="ohc-mobile-map-wrap" style={{ height: `${portraitMapHeight(vp.h)}px` }}>
            {mapEl}
          </div>
          {strip}
          {dots}
        </>
      )}

      {pickerOpen && (
        <div
          className="ohc-mobile-picker"
          role="dialog"
          aria-modal="true"
          aria-label={t('mobileLayout.picker.title', { defaultValue: 'Cards' })}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div className="ohc-mobile-picker-sheet">
            <div className="ohc-mobile-picker-head">
              <span>{t('mobileLayout.picker.title', { defaultValue: 'Cards' })}</span>
              <button type="button" className="ohc-mobile-back" onClick={() => setPickerOpen(false)}>
                {t('mobileLayout.picker.done', { defaultValue: 'Done' })}
              </button>
            </div>
            {MOBILE_CARD_DEFS.map((def) => {
              const on = isCardEnabled(cardPrefs, def.id);
              const note =
                def.id === 'emcomm'
                  ? t('mobileLayout.picker.emcommNote', {
                      defaultValue: 'NWS alerts, nearby shelters and the net roster. Loads only while shown.',
                    })
                  : def.when === 'showAPRS'
                    ? t('mobileLayout.picker.aprsNote', { defaultValue: 'Shown while the APRS map layer is on.' })
                    : def.panelKey && config?.panels?.[def.panelKey]?.visible === false
                      ? t('mobileLayout.picker.hiddenNote', { defaultValue: 'Hidden in your saved panel settings.' })
                      : null;
              return (
                <label key={def.id} className="ohc-mobile-picker-row">
                  <input type="checkbox" checked={on} onChange={() => toggleCard(def.id)} />
                  <span aria-hidden="true">{def.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{cardLabel(def.id)}</span>
                    {note && <span className="ohc-mobile-picker-note">{note}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {expandedCard && (
        <div className="ohc-mobile-fullscreen" role="dialog" aria-modal="true" aria-label={cardLabel(expandedCard.id)}>
          <div className="ohc-mobile-fullscreen-bar">
            <button type="button" className="ohc-mobile-back" onClick={closeCard}>
              <span aria-hidden="true">‹</span> {t('mobileLayout.back', { defaultValue: 'Back' })}
            </button>
            {/* The panel's own header names it; only plain cards need a title here */}
            {!expandedCard.ownHeader && (
              <span className="ohc-mobile-card-title">
                <span aria-hidden="true">{expandedCard.icon}</span> {cardLabel(expandedCard.id)}
              </span>
            )}
          </div>
          <div className="ohc-mobile-fullscreen-body">{panelFor(expandedCard.id)}</div>
        </div>
      )}
    </div>
  );
}
