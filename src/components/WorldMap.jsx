/**
 * WorldMap Component
 * Leaflet map with DE/DX markers, terminator, DX paths, POTA, satellites, PSKReporter
 */
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { MAP_STYLES } from '../utils/config.js';
import { 
  calculateGridSquare, 
  getSunPosition, 
  getMoonPosition, 
  getGreatCirclePoints,
  replicatePath,
  replicatePoint,
  normalizeLon
} from '../utils/geo.js';
import { getBandColor } from '../utils/callsign.js';
import { createTerminator } from '../utils/terminator.js';
import { getAllLayers } from '../plugins/layerRegistry.js';
import useLocalInstall from '../hooks/app/useLocalInstall.js';
import { IconSatellite, IconTag, IconSun, IconMoon } from './Icons.jsx';
import PluginLayer from './PluginLayer.jsx';
import { DXNewsTicker } from './DXNewsTicker.jsx';
import {filterDXPaths} from "../utils";


export const WorldMap = ({ 
  deLocation, 
  dxLocation, 
  onDXChange,
  dxLocked,
  potaSpots, 
  sotaSpots,
  mySpots, 
  dxPaths, 
  dxFilters, 
  satellites, 
  pskReporterSpots,
  wsjtxSpots,
  showDXPaths, 
  showDXLabels, 
  onToggleDXLabels, 
  showPOTA, 
  showSOTA,
  showPSKReporter,
  showWSJTX,
  hoveredSpot,
  callsign = 'N0CALL',
  showDXNews = true,
  hideOverlays,
  lowMemoryMode = false,
  units = 'imperial'
}) => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const terminatorRef = useRef(null);
  const deMarkerRef = useRef(null);
  const dxMarkerRef = useRef(null);
  const sunMarkerRef = useRef(null);
  const moonMarkerRef = useRef(null);
  const potaMarkersRef = useRef([]);
  const sotaMarkersRef = useRef([]);
  const mySpotsMarkersRef = useRef([]);
  const mySpotsLinesRef = useRef([]);
  const dxPathsLinesRef = useRef([]);
  const dxPathsMarkersRef = useRef([]);
  const satMarkersRef = useRef([]);
  const satTracksRef = useRef([]);
  const pskMarkersRef = useRef([]);
  const wsjtxMarkersRef = useRef([]);
  const countriesLayerRef = useRef(null);
  const dxLockedRef = useRef(dxLocked);

  // Calculate grid locator from DE location for plugins
  const deLocator = useMemo(() => {
    if (!deLocation?.lat || !deLocation?.lon) return '';
    return calculateGridSquare(deLocation.lat, deLocation.lon);
  }, [deLocation?.lat, deLocation?.lon]);

  // Expose DE location to window for plugins (e.g., RBN)
  useEffect(() => {
    if (deLocation?.lat && deLocation?.lon) {
      window.deLocation = {
        lat: deLocation.lat,
        lon: deLocation.lon
      };
    }
    return () => {
      // Cleanup on unmount
      delete window.deLocation;
    };
  }, [deLocation?.lat, deLocation?.lon]);

  // Keep dxLockedRef in sync with prop
  useEffect(() => {
    dxLockedRef.current = dxLocked;
  }, [dxLocked]);

  // Plugin system refs and state
  const pluginLayersRef = useRef({});
  const [pluginLayerStates, setPluginLayerStates] = useState({});
  const isLocalInstall = useLocalInstall();
  
  // Filter out localOnly layers on hosted version
  const getAvailableLayers = () => getAllLayers().filter(l => !l.localOnly || isLocalInstall);
  
  // Load map style from localStorage
  const getStoredMapSettings = () => {
    try {
      const stored = localStorage.getItem('openhamclock_mapSettings');
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  };
  const storedSettings = getStoredMapSettings();
  const [mapStyle, setMapStyle] = useState(storedSettings.mapStyle || 'dark');

  // NASA GIBS Night Lights (VIIRS)
  const nightUrl = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-03-12/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg';
	
  // GIBS MODIS CODE
  const [gibsOffset, setGibsOffset] = useState(0); 
  // City lights intensity (range 0 to 1)
  // const [nightIntensity, setNightIntensity] = useState(0.8);
  
  const getGibsUrl = (days) => {
    const date = new Date(Date.now() - (days * 24 + 12) * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  };
  // End GIBS MODIS CODE
	
  const [mapView, setMapView] = useState({
    center: storedSettings.center || [20, 0],
    zoom: storedSettings.zoom || 2.5
  });
  
  // Save map settings to localStorage when changed (merge, don't overwrite)
  useEffect(() => {
    try {
      const existing = getStoredMapSettings();
      localStorage.setItem('openhamclock_mapSettings', JSON.stringify({
        ...existing,
        mapStyle,
        center: mapView.center,
        zoom: mapView.zoom
      }));
    } catch (e) { console.error('Failed to save map settings:', e); }
  }, [mapStyle, mapView]);

  // Initialize map
  useEffect(() => {
	// If map is already initialized, don't do it again
	  if (mapInstanceRef.current) return;
	  
	  const L = window.L;
	  if (typeof L === 'undefined') {
		console.error('Leaflet not loaded');
		return;
	  }

	  const map = L.map(mapRef.current, {
		center: mapView.center,
		zoom: mapView.zoom,
		minZoom: 1,
		maxZoom: 18,
		worldCopyJump: true,
		zoomControl: true,
		zoomSnap: 0.1,
		zoomDelta: 0.25,
		wheelPxPerZoomLevel: 200,
		maxBounds: [[-90, -Infinity], [90, Infinity]],
		maxBoundsViscosity: 0.8
	  });

	  // --- night pane ---
	  map.createPane('nightPane');
	  const nightPane = map.getPane('nightPane');
	  nightPane.style.zIndex = 650; // Keep it on the very top
	  nightPane.style.pointerEvents = 'none'; 
	  nightPane.id = 'night-lights-pane'; // Links to CSS for 'screen' blending

	  // Initial tile layer (Base Day Map)
	  tileLayerRef.current = L.tileLayer(MAP_STYLES[mapStyle].url, {
		attribution: MAP_STYLES[mapStyle].attribution,
		noWrap: false,
		crossOrigin: 'anonymous'
	  }).addTo(map);

	  // Day/night terminator
	  terminatorRef.current = createTerminator({
		resolution: 2,
		fillOpacity: 0.1, 
		fillColor: '#000010',
		color: '#ffaa00',
		weight: 2,
		dashArray: '5, 5',
		wrap: false
	  }).addTo(map);

	  // Refresh terminator immediately to set initial position
	  setTimeout(() => {
		if (terminatorRef.current) {
		  terminatorRef.current.setTime();
		  // Ensure the mask updates immediately after the first path is generated
		  const path = terminatorRef.current.getElement();
		  if (path) {
			path.classList.add('terminator-path');
		  }
		}
	  }, 100);

	  const terminatorInterval = setInterval(() => {
		if (terminatorRef.current) {
		  terminatorRef.current.setTime();
		  const path = terminatorRef.current.getElement();
		  if (path) {
			path.classList.add('terminator-path');
		  }
		}
	  }, 60000);

    map.on('click', (e) => {
      if (onDXChange && !dxLockedRef.current) {
        let lon = e.latlng.lng;
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        onDXChange({ lat: e.latlng.lat, lon });
      }
    });
    
    map.on('moveend', () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setMapView({ center: [center.lat, center.lng], zoom });
    });

    mapInstanceRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapRef.current);

    return () => {
      clearInterval(terminatorInterval);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []); // Empty dependency array for initialization
	
// Update tile layer and handle night light clipping

  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;
    const map = mapInstanceRef.current; // Define map reference
    
    // 1. Base Map (Day)
    let url = MAP_STYLES[mapStyle].url;
    if (mapStyle === 'MODIS') { url = getGibsUrl(gibsOffset); }
    tileLayerRef.current.setUrl(url);

    // This clears the "map data not yet available" placeholders
    map.invalidateSize({ animate: false }); 
    tileLayerRef.current.redraw(); // Optional: forces a fresh download of the tiles
    // ----------------------------------------------------------------

    tileLayerRef.current.setOpacity(1.0);
    tileLayerRef.current.setZIndex(10);


    // 3. Terminator Shadow (Gray Line) Set Color to transparent to hide terminator verticle lines at 180° and -180° -limited fix though
    if (terminatorRef.current) {
        terminatorRef.current.setStyle({
            fillOpacity: 0.6, 
            fillColor: '#000008',
            color: 'transparent',
            weight: 2
        });
        
        if (typeof terminatorRef.current.bringToFront === 'function') {
            terminatorRef.current.bringToFront();
        }
    }

    // 4. Handle Clipping Mask
    const updateMask = () => {
      const nightPane = document.getElementById('night-lights-pane');
      const terminatorPath = document.querySelector('.terminator-path');
      
      if (nightPane && terminatorPath) {
        const pathData = terminatorPath.getAttribute('d');
        if (pathData) {
          nightPane.style.clipPath = `path('${pathData}')`;
          nightPane.style.webkitClipPath = `path('${pathData}')`;
        }
      }
    };

    updateMask();
    const maskInterval = setInterval(updateMask, 3000); 

    return () => clearInterval(maskInterval);
}, [mapStyle, gibsOffset]); // Added gibsOffset  and night slider so the map refreshes when you move the slider
  
  // End code dynamic GIBS generator if 'MODIS' is selected

  // Countries overlay for "Countries" map style
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    // Remove existing countries layer
    if (countriesLayerRef.current) {
      map.removeLayer(countriesLayerRef.current);
      countriesLayerRef.current = null;
    }
    
    // Only add overlay for countries style
    if (!MAP_STYLES[mapStyle]?.countriesOverlay) return;
    
    // Bright distinct colors for countries (designed for maximum contrast between neighbors)
    const COLORS = [
      '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
      '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
      '#dcbeff', '#9A6324', '#800000', '#aaffc3', '#808000',
      '#000075', '#e6beff', '#ff6961', '#77dd77', '#fdfd96',
      '#84b6f4', '#fdcae1', '#c1e1c1', '#b39eb5', '#ffb347'
    ];
    
    // Simple string hash for consistent color assignment
    const hashColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return COLORS[Math.abs(hash) % COLORS.length];
    };
    
    // Fetch world countries GeoJSON (Natural Earth 110m simplified, ~240KB)
    fetch('https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(geojson => {
        if (!mapInstanceRef.current) return;
        
        countriesLayerRef.current = L.geoJSON(geojson, {
          style: (feature) => {
            const name = feature.properties?.name || feature.id || 'Unknown';
            return {
              fillColor: hashColor(name),
              fillOpacity: 0.65,
              color: '#fff',
              weight: 1,
              opacity: 0.8
            };
          },
          onEachFeature: (feature, layer) => {
            const name = feature.properties?.name || 'Unknown';
            layer.bindTooltip(name, {
              sticky: true,
              className: 'country-tooltip',
              direction: 'top',
              offset: [0, -5]
            });
          }
        }).addTo(map);
        
        // Ensure countries layer is below markers but above tiles
        countriesLayerRef.current.bringToBack();
        // Put tile layer behind countries
        if (tileLayerRef.current) tileLayerRef.current.bringToBack();
        // Terminator on top
        if (terminatorRef.current) terminatorRef.current.bringToFront();
      })
      .catch(err => {
        console.warn('Could not load countries GeoJSON:', err);
      });
  }, [mapStyle]);

  // Update DE/DX markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old markers
    if (deMarkerRef.current) map.removeLayer(deMarkerRef.current);
    if (dxMarkerRef.current) map.removeLayer(dxMarkerRef.current);

    // DE Marker
    const deIcon = L.divIcon({
      className: 'custom-marker de-marker',
      html: 'DE',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    deMarkerRef.current = L.marker([deLocation.lat, deLocation.lon], { icon: deIcon })
      .bindPopup(`<b>DE - Your Location</b><br>${calculateGridSquare(deLocation.lat, deLocation.lon)}<br>${deLocation.lat.toFixed(4)}°, ${deLocation.lon.toFixed(4)}°`)
      .addTo(map);

    // DX Marker
    const dxIcon = L.divIcon({
      className: 'custom-marker dx-marker',
      html: 'DX',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    dxMarkerRef.current = L.marker([dxLocation.lat, dxLocation.lon], { icon: dxIcon })
      .bindPopup(`<b>DX - Target</b><br>${calculateGridSquare(dxLocation.lat, dxLocation.lon)}<br>${dxLocation.lat.toFixed(4)}°, ${dxLocation.lon.toFixed(4)}°`)
      .addTo(map);
  }, [deLocation, dxLocation]);

  // Update sun/moon markers every 60 seconds (matches terminator refresh)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const updateCelestial = () => {
      if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
      if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);

      const now = new Date();

      // Sun marker
      const sunPos = getSunPosition(now);
      const sunIcon = L.divIcon({
        className: 'custom-marker sun-marker',
        html: '☼',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      sunMarkerRef.current = L.marker([sunPos.lat, sunPos.lon], { icon: sunIcon })
        .bindPopup(`<b>☼ Subsolar Point</b><br>${sunPos.lat.toFixed(2)}°, ${sunPos.lon.toFixed(2)}°`)
        .addTo(map);

      // Moon marker
      const moonPos = getMoonPosition(now);
      const moonIcon = L.divIcon({
        className: 'custom-marker moon-marker',
        html: '☽',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      moonMarkerRef.current = L.marker([moonPos.lat, moonPos.lon], { icon: moonIcon })
        .bindPopup(`<b>☽ Sublunar Point</b><br>${moonPos.lat.toFixed(2)}°, ${moonPos.lon.toFixed(2)}°`)
        .addTo(map);
    };

    // Initial render
    updateCelestial();

    // Update every 60 seconds to match terminator
    const interval = setInterval(updateCelestial, 60000);
    return () => {
      clearInterval(interval);
      if (sunMarkerRef.current) map.removeLayer(sunMarkerRef.current);
      if (moonMarkerRef.current) map.removeLayer(moonMarkerRef.current);
    };
  }, []);

  // Update DX paths
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Remove old DX paths
    dxPathsLinesRef.current.forEach(l => map.removeLayer(l));
    dxPathsLinesRef.current = [];
    dxPathsMarkersRef.current.forEach(m => map.removeLayer(m));
    dxPathsMarkersRef.current = [];

    // Add new DX paths if enabled
    if (showDXPaths && dxPaths && dxPaths.length > 0) {
      const filteredPaths = filterDXPaths(dxPaths, dxFilters);
      
      filteredPaths.forEach((path) => {
        try {
          if (!path.spotterLat || !path.spotterLon || !path.dxLat || !path.dxLon) return;
          if (isNaN(path.spotterLat) || isNaN(path.spotterLon) || isNaN(path.dxLat) || isNaN(path.dxLon)) return;
          
          const pathPoints = getGreatCirclePoints(
            path.spotterLat, path.spotterLon,
            path.dxLat, path.dxLon
          );
          
          if (!pathPoints || !Array.isArray(pathPoints) || pathPoints.length === 0) return;
          
          const freq = parseFloat(path.freq);
          const color = getBandColor(freq);
          
          const isHovered = hoveredSpot && 
                           hoveredSpot.call?.toUpperCase() === path.dxCall?.toUpperCase();
          
          // Render polyline on all 3 world copies so it's visible across the dateline
          replicatePath(pathPoints).forEach(copy => {
            const line = L.polyline(copy, {
              color: isHovered ? '#ffffff' : color,
              weight: isHovered ? 4 : 1.5,
              opacity: isHovered ? 1 : 0.5
            }).addTo(map);
            if (isHovered) line.bringToFront();
            dxPathsLinesRef.current.push(line);
          });

          // Render circleMarker on all 3 world copies
          replicatePoint(path.dxLat, path.dxLon).forEach(([lat, lon]) => {
            const dxCircle = L.circleMarker([lat, lon], {
              radius: isHovered ? 12 : 6,
              fillColor: isHovered ? '#ffffff' : color,
              color: isHovered ? color : '#fff',
              weight: isHovered ? 3 : 1.5,
              opacity: 1,
              fillOpacity: isHovered ? 1 : 0.9
            })
              .bindPopup(`<b style="color: ${color}">${path.dxCall}</b><br>${path.freq} MHz<br>by ${path.spotter}`)
              .addTo(map);
            if (isHovered) dxCircle.bringToFront();
            dxPathsMarkersRef.current.push(dxCircle);
          });
          
          // Add label if enabled (L.marker with divIcon auto-duplicates across world copies)
          if (showDXLabels || isHovered) {
            const dxLonNorm = normalizeLon(path.dxLon);
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:${isHovered ? '#fff' : color};color:${isHovered ? color : '#000'};padding:${isHovered ? '5px 10px' : '4px 8px'};border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:${isHovered ? '14px' : '12px'};font-weight:700;white-space:nowrap;border:2px solid ${isHovered ? color : 'rgba(0,0,0,0.5)'};box-shadow:0 2px ${isHovered ? '8px' : '4px'} rgba(0,0,0,${isHovered ? '0.6' : '0.4'});">${path.dxCall}</span>`,
              iconSize: null,
              iconAnchor: [0, 0]
            });
            const label = L.marker([path.dxLat, dxLonNorm], { 
              icon: labelIcon, 
              interactive: false,
              zIndexOffset: isHovered ? 10000 : 0
            }).addTo(map);
            dxPathsMarkersRef.current.push(label);
          }
        } catch (err) {
          console.error('Error rendering DX path:', err);
        }
      });
    }
  }, [dxPaths, dxFilters, showDXPaths, showDXLabels, hoveredSpot]);

  // Update POTA markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    potaMarkersRef.current.forEach(m => map.removeLayer(m));
    potaMarkersRef.current = [];

    if (showPOTA && potaSpots) {
      potaSpots.forEach(spot => {
        if (spot.lat && spot.lon) {
          // Green triangle marker for POTA activators
          const triangleIcon = L.divIcon({
            className: '',
            html: `<span style="display:inline-block;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid #44cc44;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
            iconSize: [14, 14],
            iconAnchor: [7, 14]
          });
          const marker = L.marker([spot.lat, spot.lon], { icon: triangleIcon })
            .bindPopup(`<b style="color:#44cc44">${spot.call}</b><br><span style="color:#888">${spot.ref}</span> ${spot.locationDesc || ''}<br>${spot.name ? `<i>${spot.name}</i><br>` : ''}${spot.freq} ${spot.mode || ''} <span style="color:#888">${spot.time || ''}</span>`)
            .addTo(map);
          potaMarkersRef.current.push(marker);

          // Only show callsign label when labels are enabled
          if (showDXLabels) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:#44cc44;color:#000;padding:4px 8px;border-radius:4px;font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:2px solid rgba(0,0,0,0.5);box-shadow:0 2px 4px rgba(0,0,0,0.4);">${spot.call}</span>`,
              iconSize: null,
              iconAnchor: [0, -2]
            });
            const label = L.marker([spot.lat, spot.lon], { icon: labelIcon, interactive: false }).addTo(map);
            potaMarkersRef.current.push(label);
          }
        }
      });
    }
  }, [potaSpots, showPOTA, showDXLabels]);

  // Update SOTA markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    sotaMarkersRef.current.forEach(m => map.removeLayer(m));
    sotaMarkersRef.current = [];

    if (showSOTA && sotaSpots) {
      sotaSpots.forEach(spot => {
        if (spot.lat && spot.lon) {
          // Orange diamond marker for SOTA activators
          const diamondIcon = L.divIcon({
            className: '',
            html: `<span style="display:inline-block;width:12px;height:12px;background:#ff9632;transform:rotate(45deg);border:1px solid rgba(0,0,0,0.4);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          });
          const marker = L.marker([spot.lat, spot.lon], { icon: diamondIcon })
            .bindPopup(`<b style="color:#ff9632">${spot.call}</b><br><span style="color:#888">${spot.ref}</span>${spot.summit ? ` — ${spot.summit}` : ''}${spot.points ? ` <span style="color:#ff9632">(${spot.points}pt)</span>` : ''}<br>${spot.freq} ${spot.mode || ''} <span style="color:#888">${spot.time || ''}</span>`)
            .addTo(map);
          sotaMarkersRef.current.push(marker);

          // Only show callsign label when labels are enabled
          if (showDXLabels) {
            const labelIcon = L.divIcon({
              className: '',
              html: `<span style="display:inline-block;background:#ff9632;color:#000;padding:4px 8px;border-radius:4px;font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap;border:2px solid rgba(0,0,0,0.5);box-shadow:0 2px 4px rgba(0,0,0,0.4);">${spot.call}</span>`,
              iconSize: null,
              iconAnchor: [0, -2]
            });
            const label = L.marker([spot.lat, spot.lon], { icon: labelIcon, interactive: false }).addTo(map);
            sotaMarkersRef.current.push(label);
          }
        }
      });
    }
  }, [sotaSpots, showSOTA, showDXLabels]);

    // Plugin layer system - properly load saved states
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    try {
      const availableLayers = getAvailableLayers();
      const settings = getStoredMapSettings();
      const savedLayers = settings.layers || {};

      // Build initial states from localStorage
      const initialStates = {};
      availableLayers.forEach(layerDef => {
        // Use saved state if it exists, otherwise use defaults
        if (savedLayers[layerDef.id]) {
          initialStates[layerDef.id] = savedLayers[layerDef.id];
        } else {
          initialStates[layerDef.id] = {
            enabled: layerDef.defaultEnabled,
            opacity: layerDef.defaultOpacity
          };
        }
      });

      // Initialize state ONLY on first mount (when empty)
      if (Object.keys(pluginLayerStates).length === 0) {
        console.log('Loading saved layer states:', initialStates);
        setPluginLayerStates(initialStates);
      }

      // Expose controls for SettingsPanel
		window.hamclockLayerControls = {
		  layers: availableLayers.map(l => ({
			...l,
			enabled: pluginLayerStates[l.id]?.enabled ?? initialStates[l.id]?.enabled ?? l.defaultEnabled,
			opacity: pluginLayerStates[l.id]?.opacity ?? initialStates[l.id]?.opacity ?? l.defaultOpacity,
			// ADD: Pass the current config (showTracks/showFootprints) to the settings menu
			config: pluginLayerStates[l.id]?.config ?? initialStates[l.id]?.config ?? l.config
		  })),
		  
		  toggleLayer: (id, enabled) => {
			const settings = getStoredMapSettings();
			const layers = settings.layers || {};
			layers[id] = { ...(layers[id] || {}), enabled };
			localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
			setPluginLayerStates(prev => ({ ...prev, [id]: { ...prev[id], enabled } }));
		  },

		  setOpacity: (id, opacity) => {
			const settings = getStoredMapSettings();
			const layers = settings.layers || {};
			layers[id] = { ...(layers[id] || {}), opacity };
			localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
			setPluginLayerStates(prev => ({ ...prev, [id]: { ...prev[id], opacity } }));
		  },

		  // ADD THIS NEW FUNCTION:
		  updateLayerConfig: (id, configDelta) => {
			const settings = getStoredMapSettings();
			const layers = settings.layers || {};
			const currentLayer = layers[id] || {};
			
			// Merge the new checkbox state (e.g., {showTracks: false}) into existing config
			layers[id] = {
			  ...currentLayer,
			  config: { ...(currentLayer.config || {}), ...configDelta }
			};
			
			// Save to localStorage so it persists after refresh
			localStorage.setItem('openhamclock_mapSettings', JSON.stringify({ ...settings, layers }));
			
			// Update React state to trigger the map redraw
			setPluginLayerStates(prev => ({
			  ...prev,
			  [id]: { ...prev[id], config: { ...(prev[id]?.config || {}), ...configDelta } }
			}));
		  }
		};
		
    } catch (err) {
      console.error('Plugin system error:', err);
    }
  }, [pluginLayerStates]);

  // Update PSKReporter markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    pskMarkersRef.current.forEach(m => map.removeLayer(m));
    pskMarkersRef.current = [];

    // Validate deLocation exists and has valid coordinates
    const hasValidDE = deLocation && 
      typeof deLocation.lat === 'number' && !isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' && !isNaN(deLocation.lon);

    if (showPSKReporter && pskReporterSpots && pskReporterSpots.length > 0 && hasValidDE) {
      pskReporterSpots.forEach(spot => {
        // Validate spot coordinates are valid numbers
        let spotLat = parseFloat(spot.lat);
        let spotLon = parseFloat(spot.lon);
        
        if (!isNaN(spotLat) && !isNaN(spotLon)) {
          const displayCall = spot.receiver || spot.sender;
          const freqMHz = spot.freqMHz || (spot.freq ? (spot.freq / 1000000).toFixed(3) : '?');
          const bandColor = getBandColor(parseFloat(freqMHz));
          
          try {
            // Draw line from DE to spot location
            const points = getGreatCirclePoints(
              deLocation.lat, deLocation.lon,
              spotLat, spotLon,
              50
            );
            
            // Render polyline on all 3 world copies
            if (points && Array.isArray(points) && points.length > 1 && 
                points.every(p => Array.isArray(p) && !isNaN(p[0]) && !isNaN(p[1]))) {
              replicatePath(points).forEach(copy => {
                const line = L.polyline(copy, {
                  color: bandColor,
                  weight: 1.5,
                  opacity: 0.5,
                  dashArray: '4, 4'
                }).addTo(map);
                pskMarkersRef.current.push(line);
              });
            }
            
            // Render circleMarker on all 3 world copies
            replicatePoint(spotLat, spotLon).forEach(([rLat, rLon]) => {
              const circle = L.circleMarker([rLat, rLon], {
                radius: 4,
                fillColor: bandColor,
                color: '#fff',
                weight: 1,
                opacity: 0.9,
                fillOpacity: 0.8
              }).bindPopup(`
                <b>${displayCall}</b><br>
                ${spot.mode} @ ${freqMHz} MHz<br>
                ${spot.snr !== null ? `SNR: ${spot.snr > 0 ? '+' : ''}${spot.snr} dB` : ''}
              `).addTo(map);
              pskMarkersRef.current.push(circle);
            });
          } catch (err) {
            console.warn('Error rendering PSKReporter spot:', err);
          }
        }
      });
    }
  }, [pskReporterSpots, showPSKReporter, deLocation]);

  // Update WSJT-X markers (CQ callers with grid locators)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    wsjtxMarkersRef.current.forEach(m => map.removeLayer(m));
    wsjtxMarkersRef.current = [];

    const hasValidDE = deLocation && 
      typeof deLocation.lat === 'number' && !isNaN(deLocation.lat) &&
      typeof deLocation.lon === 'number' && !isNaN(deLocation.lon);

    if (showWSJTX && wsjtxSpots && wsjtxSpots.length > 0 && hasValidDE) {
      // Deduplicate by callsign - keep most recent
      // For CQ: caller is the station. For QSO: dxCall is the remote station.
      const seen = new Map();
      wsjtxSpots.forEach(spot => {
        const call = spot.caller || spot.dxCall || '';
        if (call && (!seen.has(call) || spot.timestamp > seen.get(call).timestamp)) {
          seen.set(call, spot);
        }
      });

      seen.forEach((spot, call) => {
        let spotLat = parseFloat(spot.lat);
        let spotLon = parseFloat(spot.lon);

        if (!isNaN(spotLat) && !isNaN(spotLon)) {
          const freqMHz = spot.dialFrequency ? (spot.dialFrequency / 1000000) : 0;
          const bandColor = freqMHz ? getBandColor(freqMHz) : '#a78bfa';
          // Prefix-estimated locations get reduced opacity
          const isEstimated = spot.gridSource === 'prefix';

          try {
            // Draw line from DE to decoded station
            const points = getGreatCirclePoints(
              deLocation.lat, deLocation.lon,
              spotLat, spotLon,
              50
            );

            if (points && Array.isArray(points) && points.length > 1 &&
                points.every(p => Array.isArray(p) && !isNaN(p[0]) && !isNaN(p[1]))) {
              // Render polyline on all 3 world copies
              replicatePath(points).forEach(copy => {
                const line = L.polyline(copy, {
                  color: '#a78bfa',
                  weight: 1.5,
                  opacity: isEstimated ? 0.15 : 0.4,
                  dashArray: '2, 6'
                }).addTo(map);
                wsjtxMarkersRef.current.push(line);
              });
            }

            // Diamond-shaped marker (L.marker with divIcon auto-duplicates across world copies)
            const diamond = L.marker([spotLat, normalizeLon(spotLon)], {
              icon: L.divIcon({
                className: '',
                html: `<div style="
                  width: 8px; height: 8px;
                  background: ${bandColor};
                  border: 1px solid ${isEstimated ? '#888' : '#fff'};
                  transform: rotate(45deg);
                  opacity: ${isEstimated ? 0.5 : 0.9};
                "></div>`,
                iconSize: [8, 8],
                iconAnchor: [4, 4]
              })
            }).bindPopup(`
              <b>${call}</b> ${spot.type === 'CQ' ? 'CQ' : ''}<br>
              ${spot.grid || ''} ${spot.band || ''}${spot.gridSource === 'prefix' ? ' <i>(est)</i>' : spot.gridSource === 'cache' ? ' <i>(prev)</i>' : ''}<br>
              ${spot.mode || ''} SNR: ${spot.snr != null ? (spot.snr >= 0 ? '+' : '') + spot.snr : '?'} dB
            `).addTo(map);
            wsjtxMarkersRef.current.push(diamond);
          } catch (err) {
            // skip bad spots
          }
        }
      });
    }
  }, [wsjtxSpots, showWSJTX, deLocation]);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: '200px' }}>
      <div ref={mapRef} style={{ height: '100%', width: '100%', borderRadius: '8px', background: mapStyle === 'countries' ? '#4a90d9' : undefined }} />

      {/* Render all plugin layers */}
      {mapInstanceRef.current && getAllLayers().map(layerDef => (
	  <PluginLayer
		key={layerDef.id}
		plugin={layerDef}
		enabled={pluginLayerStates[layerDef.id]?.enabled ?? layerDef.defaultEnabled}
		opacity={pluginLayerStates[layerDef.id]?.opacity ?? layerDef.defaultOpacity}
		config={pluginLayerStates[layerDef.id]?.config ?? layerDef.config}
		  
		  map={mapInstanceRef.current}
		  satellites={satellites}
		  units={units}
		  callsign={callsign}
		  locator={deLocator}
		  lowMemoryMode={lowMemoryMode}
		/>
		))}

      {/* MODIS Control (Only shows when MODIS map style is active) */}
      {mapStyle === 'MODIS' && (
        <div style={{
          position: 'absolute',
          top: '50px', 
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid #444',
          padding: '8px',
          borderRadius: '4px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{ color: '#00ffcc', fontSize: '10px', fontFamily: 'JetBrains Mono' }}>
            {gibsOffset === 0 ? 'LATEST IMAGERY' : `${gibsOffset} DAYS AGO`}
          </div>
          <input 
            type="range" min="0" max="7" value={gibsOffset} 
            onChange={(e) => setGibsOffset(parseInt(e.target.value))}
            style={{ cursor: 'pointer', width: '100px' }}
          />
        </div>
      )}

      {/* Map style dropdown */}
      <select
        value={mapStyle}
        onChange={(e) => setMapStyle(e.target.value)}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid #444',
          color: '#00ffcc',
          padding: '6px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'JetBrains Mono',
          cursor: 'pointer',
          zIndex: 1000,
          outline: 'none'
        }}
      >
        {Object.entries(MAP_STYLES).map(([key, style]) => (
          <option key={key} value={key}>{style.name}</option>
        ))}
      </select>
      
      {/* Satellite toggle */}

      
      {/* Labels toggle */}
      {onToggleDXLabels && showDXPaths && (
        <button
          onClick={onToggleDXLabels}
          title={showDXLabels ? 'Hide callsign labels on map' : 'Show callsign labels on map'}
          style={{
            position: 'absolute',
            top: '10px',
            left: '145px',
            background: showDXLabels ? 'rgba(255, 170, 0, 0.2)' : 'rgba(0, 0, 0, 0.8)',
            border: `1px solid ${showDXLabels ? '#ffaa00' : '#666'}`,
            color: showDXLabels ? '#ffaa00' : '#888',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontFamily: 'JetBrains Mono',
            cursor: 'pointer',
            zIndex: 1000
          }}
        >
          ⊞ CALLS {showDXLabels ? 'ON' : 'OFF'}
        </button>
      )}
      
      {/* DX News Ticker - left side of bottom bar */}
      {!hideOverlays && showDXNews && <DXNewsTicker />}

      {/* Legend - centered above news ticker */}
      {!hideOverlays && (
        <div style={{
          position: 'absolute',
          bottom: '44px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.85)',
          border: '1px solid #444',
          borderRadius: '6px',
          padding: '6px 10px',
          zIndex: 1000,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          fontSize: '11px',
          fontFamily: 'JetBrains Mono, monospace',
          flexWrap: 'nowrap'
        }}>
          {showDXPaths && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ color: '#888' }}>DX:</span>
              <span style={{ background: '#ff6666', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>160m</span>
              <span style={{ background: '#ff9966', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>80m</span>
              <span style={{ background: '#ffcc66', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>40m</span>
              <span style={{ background: '#ccff66', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>30m</span>
              <span style={{ background: '#66ff99', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>20m</span>
              <span style={{ background: '#66ffcc', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>17m</span>
              <span style={{ background: '#66ccff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>15m</span>
              <span style={{ background: '#6699ff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>12m</span>
              <span style={{ background: '#9966ff', color: '#fff', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>10m</span>
              <span style={{ background: '#cc66ff', color: '#fff', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>6m</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ background: 'var(--accent-amber)', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>● DE</span>
            <span style={{ background: '#00aaff', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>● DX</span>
          </div>
          {showPOTA && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ background: '#44cc44', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>▲ POTA</span>
            </div>
          )}
          {showSOTA && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ background: '#ff9632', color: '#000', padding: '2px 5px', borderRadius: '3px', fontWeight: '600' }}>◆ SOTA</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ color: '#ffcc00' }}>☼ Sun</span>
            <span style={{ color: '#aaaaaa' }}>☽ Moon</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldMap;