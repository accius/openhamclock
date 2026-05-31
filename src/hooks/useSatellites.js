/**
 * useSatellites Hook
 * Tracks amateur radio satellites using API data source provided by satellite.js server-side service.
 * Includes orbit track prediction
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import * as satellite from 'satellite.js';
import Orbit from '../utils/orbit.js';
import { getDebugConfig } from '../debug/debugConfig.js';

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export const useSatellites = (observerLocation, satelliteConfig, filteredNames = null) => {
  const [data, setData] = useState([]);
  const [nextPassData, setNextPassData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingNextPass, setLoadingNextPass] = useState(true);
  const satelliteDataRef = useRef({});
  const [satelliteData, setSatelliteData] = useState({});
  const satelliteDataTimestampRef = useRef(0);

  const fetchSatelliteData = useCallback(async () => {
    try {
      const { timestamp: ts } = await fetch('/api/satellites/data/timestamp').then((r) => r.json());

      if (ts && satelliteDataTimestampRef.current && ts <= satelliteDataTimestampRef.current) {
        console.debug(`[Satellite] data is up to date (timestamp: ${ts}), no update needed.`);
        return;
      }

      console.debug(
        `[Satellite] New data available, updating... (new timestamp: ${ts || 'N/A'}, previous timestamp: ${satelliteDataTimestampRef.current || 'N/A'})`,
      );

      const response = await fetch('/api/satellites/data');
      if (response.ok) {
        const { timestamp: newTimestamp, data } = await response.json();

        satelliteDataRef.current = data;
        satelliteDataTimestampRef.current = newTimestamp;

        setSatelliteData(data);
      }
    } catch (err) {
      console.error('[Satellite] data fetch error:', err);
    }
  }, []);

  // Fetch satellite data
  useEffect(() => {
    fetchSatelliteData(); // prefetch immediately on mount
  }, [fetchSatelliteData]);

  useEffect(() => {
    const ONE_MINUTE = 60 * 1000;
    const ONE_HOUR = 60 * 60 * 1000;

    // interval is short if data set is empty, otherwise long
    const isEmptyDataSet = Object.keys(satelliteDataRef.current).length === 0;
    const delay = isEmptyDataSet ? ONE_MINUTE : ONE_HOUR;

    const interval = setInterval(fetchSatelliteData, delay);

    return () => clearInterval(interval);
  }, [fetchSatelliteData, satelliteData]);

  // Calculate satellite positions and orbits
  const calculatePositions = useCallback(() => {
    if (!observerLocation || Object.keys(satelliteData).length === 0) {
      setLoading(false);
      return;
    }

    try {
      const now = new Date();
      const gmst = satellite.gstime(now);
      const positions = [];

      // Observer position in radians
      const observerGd = {
        longitude: satellite.degreesToRadians(observerLocation.lon),
        latitude: satellite.degreesToRadians(observerLocation.lat),
        height: (observerLocation.stationAlt ?? 100) / 1000, // above sea level [km], stationAlt is [m]), defaults to 100m
      };

      Object.entries(satelliteData).forEach(([name, satData]) => {
        // calculation needed only if satellite appears in filter, or if filter is missing completely
        const isCalcNeeded = (satData) => !(filteredNames && satData?.name && !filteredNames.includes(satData.name));

        // Find corresponding next pass data for this satellite
        const nextPass = nextPassData.find(
          (pass) => pass.keyName === (satData.name || '') || pass.keyName === (name || ''),
        );
        const startTimes = nextPass?.startTimes || [];
        const endTimes = nextPass?.endTimes || [];

        if (isCalcNeeded(satData)) {
          try {
            const satrec = satellite.json2satrec(satData.omm);
            const positionAndVelocity = satellite.propagate(satrec, now);
            const positionEci = positionAndVelocity.position;
            const velocityEci = positionAndVelocity.velocity;

            if (!positionEci) return;

            const positionGd = satellite.eciToGeodetic(positionEci, gmst);

            // Convert to degrees
            const lat = satellite.degreesLat(positionGd.latitude);
            const lon = satellite.degreesLong(positionGd.longitude);
            const alt = positionGd.height;

            // Calculate look angles
            const positionEcf = satellite.eciToEcf(positionEci, gmst);
            const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
            const azimuth = satellite.radiansToDegrees(lookAngles.azimuth);
            const elevation = satellite.radiansToDegrees(lookAngles.elevation);
            const rangeSat = lookAngles.rangeSat;

            const isVisible = elevation >= (satelliteConfig?.minElev ?? 5.0); // visible only if above minimum elevation

            // Calculate range-rate and doppler factor, only if satellite is visible
            let dopplerFactor = 1;
            let rangeRate = 0;

            if (isVisible) {
              const observerEcf = satellite.geodeticToEcf(observerGd);
              const velocityEcf = satellite.eciToEcf(velocityEci, gmst);
              dopplerFactor = satellite.dopplerFactor(observerEcf, positionEcf, velocityEcf);
              const c = 299792.458; // Speed of light [km/s]
              rangeRate = (1 - dopplerFactor) * c; // [km/s]
            }

            // Calculate speed from ECI velocity vector [km/s]
            let speedKmH = 0;
            if (velocityEci) {
              const v = velocityEci;
              speedKmH = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3600; // [km/s] → [km/h]
            }

            // Calculate orbit track (past 45 min and future 45 min = 90 min total)
            const track = [];
            const trackMinutes = 90;
            const stepMinutes = 1;

            for (let m = -trackMinutes / 2; m <= trackMinutes / 2; m += stepMinutes) {
              const trackTime = new Date(now.getTime() + m * 60 * 1000);
              const trackPV = satellite.propagate(satrec, trackTime);

              if (trackPV.position) {
                const trackGmst = satellite.gstime(trackTime);
                const trackGd = satellite.eciToGeodetic(trackPV.position, trackGmst);
                const trackLat = satellite.degreesLat(trackGd.latitude);
                const trackLon = satellite.degreesLong(trackGd.longitude);
                track.push([trackLat, trackLon]);
              }
            }

            // Calculate footprint radius (visibility circle)
            // Formula: radius = Earth_radius * arccos(Earth_radius / (Earth_radius + altitude))
            const earthRadius = 6371; // [km]
            const footprintRadius = earthRadius * Math.acos(earthRadius / (earthRadius + alt));

            positions.push({
              name: satData.name || name,
              omm: satData.omm,
              lat,
              lon,
              alt: round(alt, 1),
              speedKmH: round(speedKmH, 1),
              azimuth: round(azimuth, 0),
              elevation: round(elevation, 0),
              range: round(rangeSat, 1),
              rangeRate: round(rangeRate, 3),
              dopplerFactor: round(dopplerFactor, 9),
              isVisible, // visible if above minimum elevation
              nextPassStartTimes: startTimes,
              nextPassEndTimes: endTimes,
              isPopular: satData.priority <= 2,
              track,
              footprintRadius: Math.round(footprintRadius),
              mode: satData.mode || 'Unknown',
              color: satData.color || '#00ffff',
              // Radio metadata from satellites.json
              downlink: satData.downlink || '',
              uplink: satData.uplink || '',
              tone: satData.tone || '',
              beacon: satData.beacon || '',
              notes: satData.notes || '',
            });
          } catch (e) {
            // Skip satellites with invalid data, continue processing others
          }
        } else {
          // Case where isCalcNeeded() is false, satellite location calculation is not needed.
          // Note that data set is consumed by OHC settings panel which displays all satellites
          // with data that has been downloaded from server.
          // Satellite needs to appear there to be selectable but that panel requires name only
          // for all known satellites and not their full details.
          positions.push({
            name: satData.name || name,
          });
        }
      });

      // Sort alphabetically by name for a consistent, static list
      positions.sort((a, b) => a.name.localeCompare(b.name));
      // Show all satellites (no limit for ham sats)
      setData(positions);
      setLoading(false);
    } catch (err) {
      console.error('Satellite calculation error:', err);
      setLoading(false);
    }
  }, [observerLocation, satelliteData, nextPassData, filteredNames]);

  // Calculate satellite next passes, finds the start/end times of the next 2 passes for each satellite that are above the minimum elevation
  // Loops every hour since passes don't change often
  // When consumed check that the first pass hasn't already ended
  const calculateNextPasses = useCallback(() => {
    if (!observerLocation || Object.keys(satelliteData).length === 0) {
      setLoadingNextPass(false);
      return;
    }

    const { logLevel } = getDebugConfig();

    const groundStation = {
      latitude: observerLocation.lat,
      longitude: observerLocation.lon,
      height: observerLocation.stationAlt || 100, // above sea level [m], defaults to 100m
    };
    const startDate = new Date(); // from now
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // until 7 days from now
    const minElevation = satelliteConfig?.minElev || 5.0;
    const maxPasses = 2;

    if (logLevel === 'debug') {
      const formatDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
      let logStr = `[Satellite] calculating next passes,`;
      logStr += `\n observer lat=${groundStation.latitude}, lon=${groundStation.longitude}, alt=${groundStation.height}m,`;
      logStr += `\n time range=${formatDate(startDate)} to ${formatDate(endDate)},`;
      logStr += `\n minElevation=${minElevation}°`;
      logStr += `\n maxPasses=${maxPasses}`;
      console.debug(logStr);
    }

    const nextPasses = [];
    Object.entries(satelliteData).forEach(([keyName, satData]) => {
      try {
        const orbit = new Orbit(keyName, satData.omm);
        if (orbit.error) console.warn('Satellite orbit error:', orbit.error);
        const passes = orbit.computePassesElevation(groundStation, startDate, endDate, minElevation, maxPasses);

        const startTimes = [];
        const endTimes = [];
        passes.forEach((pass) => {
          if (pass.start && pass.end) {
            startTimes.push(pass.start);
            endTimes.push(pass.end);
          }
        });

        nextPasses.push({
          keyName,
          startTimes,
          endTimes,
        });
      } catch (e) {
        // Skip satellite with invalid data, continue processing others
      }
    });

    // Sort alphabetically by name for a consistent, static list
    nextPasses.sort((a, b) => a.keyName.localeCompare(b.keyName));

    if (logLevel === 'debug') {
      const formatDate = (date) => new Date(date).toISOString().slice(0, 19).replace('T', ' ');
      nextPasses.forEach(({ keyName, startTimes, endTimes }) => {
        let logStr = `[Satellite] Next passes for keyname \'${keyName}\': `;
        if (startTimes.length === 0) {
          logStr += '\n  None.';
        } else {
          startTimes.forEach((start, i) => {
            const end = endTimes[i];
            logStr += `\n  Pass ${i + 1}: ${formatDate(start)} to ${formatDate(end)}`;
          });
        }

        console.debug(logStr);
      });
    }

    setNextPassData(nextPasses);
    setLoadingNextPass(false);
  }, [observerLocation, satelliteData, satelliteConfig]);

  // Update positions every 5 seconds
  useEffect(() => {
    const interval = setInterval(calculatePositions, 5000);
    return () => clearInterval(interval);
  }, [calculatePositions]);

  // Update next passes every hour
  useEffect(() => {
    calculateNextPasses();
    const interval = setInterval(calculateNextPasses, 60 * 60 * 1000); // 1 hour
    return () => clearInterval(interval);
  }, [calculateNextPasses]);

  return { data, loading };
};

export default useSatellites;
