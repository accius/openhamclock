/**
 * useSatellites Hook
 * Tracks amateur radio satellites using TLE data and satellite.js
 * Includes orbit track prediction
 */
import { useState, useEffect, useCallback } from 'react';
import * as satellite from 'satellite.js';

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export const useSatellites = (observerLocation, satelliteConfig) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tleData, setTleData] = useState({});

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
        height: (observerLocation.stationAlt || 100) / 1000, // above sea level [km], stationAlt is [m]), defaults to 100m
      };

      Object.entries(tleData).forEach(([name, tle]) => {
        // Handle both line1/line2 and tle1/tle2 formats
        const line1 = tle.line1 || tle.tle1;
        const line2 = tle.line2 || tle.tle2;
        if (!line1 || !line2) return;

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

          const isVisible = elevation >= satelliteConfig.minElev; // visible only if above minimum elevation

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
  }, [observerLocation, tleData]);

  // Update positions every 5 seconds
  useEffect(() => {
    calculatePositions();
    const interval = setInterval(calculatePositions, 5000);
    return () => clearInterval(interval);
  }, [calculatePositions]);

  return { data, loading };
};

export default useSatellites;
