/**
 * useSatellites Hook
 * Tracks amateur radio satellites using TLE data and satellite.js
 * Includes orbit track prediction
 */
import { useState, useEffect, useCallback } from 'react';
import * as satellite from 'satellite.js';
import Orbit from '../utils/orbit.js';

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export const useSatellites = (observerLocation, satelliteConfig) => {
  const [data, setData] = useState([]);
  const [nextPassData, setNextPassData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingNextPass, setLoadingNextPass] = useState(true);
  const [tleData, setTleData] = useState({});

  const enableLogging = false; // Set to true to enable detailed logging for debugging

  // Fetch TLE data
  useEffect(() => {
    const fetchTLE = async () => {
      try {
        const response = await fetch('/api/satellites/tle');
        if (response.ok) {
          const tle = await response.json();
          setTleData(tle);
        }
      } catch (err) {
        console.error('TLE fetch error:', err);
      }
    };

    fetchTLE();
    const interval = setInterval(fetchTLE, 6 * 60 * 60 * 1000); // 6 hours
    return () => clearInterval(interval);
  }, []);

  // Calculate satellite positions and orbits
  const calculatePositions = useCallback(() => {
    if (!observerLocation || Object.keys(tleData).length === 0) {
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

      Object.entries(tleData).forEach(([name, tle]) => {
        // Handle both line1/line2 and tle1/tle2 formats
        const line1 = tle.line1 || tle.tle1;
        const line2 = tle.line2 || tle.tle2;
        if (!line1 || !line2) return;

        // Find corresponding next pass data for this satellite
        const nextPass = nextPassData.find((pass) => pass.name === (tle.name || name));
        const startTimes = nextPass?.startTimes || [];
        const endTimes = nextPass?.endTimes || [];

        try {
          const satrec = satellite.twoline2satrec(line1, line2);
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
            name: tle.name || name,
            tle1: line1,
            tle2: line2,
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
            isPopular: tle.priority <= 2,
            track,
            footprintRadius: Math.round(footprintRadius),
            mode: tle.mode || 'Unknown',
            color: tle.color || '#00ffff',
            // Radio metadata from satellites.json
            downlink: tle.downlink || '',
            uplink: tle.uplink || '',
            tone: tle.tone || '',
            beacon: tle.beacon || '',
            notes: tle.notes || '',
          });
        } catch (e) {
          // Skip satellites with invalid TLE
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
  }, [observerLocation, tleData, nextPassData]);

  // Calculate satellite next passes, finds the start/end times of the next 2 passes for each satellite that are above the minimum elevation
  // Loops every hour since passes don't change often
  // When consumed check that the first pass hasn't already ended
  const calculateNextPasses = useCallback(() => {
    if (!observerLocation || Object.keys(tleData).length === 0) {
      setLoadingNextPass(false);
      return;
    }

    const groundStation = {
      latitude: observerLocation.lat,
      longitude: observerLocation.lon,
      height: observerLocation.stationAlt || 100, // above sea level [m], defaults to 100m
    };
    const startDate = new Date(); // from now
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // until 7 days from now
    const minElevation = satelliteConfig?.minElev || 5.0;
    const maxPasses = 2;

    if (typeof enableLogging !== 'undefined' && enableLogging) {
      const formatDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
      let logStr = `[Satellite] calculating next passes,`;
      logStr += `\n observer lat=${groundStation.latitude}, lon=${groundStation.longitude}, alt=${groundStation.height}m,`;
      logStr += `\n time range=${formatDate(startDate)} to ${formatDate(endDate)},`;
      logStr += `\n minElevation=${minElevation}°`;
      logStr += `\n maxPasses=${maxPasses}`;
      console.log(logStr);
    }

    const nextPasses = [];
    Object.entries(tleData).forEach(([name, tle]) => {
      try {
        // Handle both line1/line2 and tle1/tle2 formats
        const line1 = tle.line1 || tle.tle1;
        const line2 = tle.line2 || tle.tle2;
        if (!line1 || !line2) return;

        const orbit = new Orbit(name, `${name}\n${line1}\n${line2}`);
        orbit.error && console.warn('Satellite orbit error:', orbit.error);
        const passes = orbit.computePassesElevation(groundStation, startDate, endDate, minElevation, maxPasses);

        const startTimes = [];
        const endTimes = [];
        passes.forEach((pass) => {
          if (pass.start && pass.end) {
            (startTimes.push(pass.start), endTimes.push(pass.end));
          }
        });

        nextPasses.push({
          name: tle.name || name,
          startTimes,
          endTimes,
        });
      } catch (e) {
        // Skip satellite with invalid TLE, continue processing others
      }
    });

    // Sort alphabetically by name for a consistent, static list
    nextPasses.sort((a, b) => a.name.localeCompare(b.name));

    // log passes for debugging
    if (typeof enableLogging !== 'undefined' && enableLogging) {
      const formatDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
      nextPasses.forEach(({ name, startTimes, endTimes }) => {
        let logStr = `[Satellite] Next passes for ${name}: `;
        if (startTimes.length === 0) {
          logStr += '\n  None.';
        } else {
          startTimes.forEach((start, i) => {
            const end = endTimes[i];
            logStr += `\n  Pass ${i + 1}: ${formatDate(start)} to ${formatDate(end)}`;
          });
        }

        console.log(logStr);
      });
    }

    setNextPassData(nextPasses);
    setLoadingNextPass(false);
  }, [observerLocation, tleData, satelliteConfig]);

  // Update positions every 5 seconds
  useEffect(() => {
    calculatePositions();
    const interval = setInterval(calculatePositions, 5000);
    return () => clearInterval(interval);
  }, [calculatePositions]);

  // Update next passes every hour
  useEffect(() => {
    calculateNextPasses();
    const interval = setInterval(calculateNextPasses, 3600000); // 1 hour
    return () => clearInterval(interval);
  }, [calculateNextPasses]);

  return { data, loading };
};

export default useSatellites;
