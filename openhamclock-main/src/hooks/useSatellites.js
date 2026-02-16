/**
 * useSatellites Hook
 * Tracks amateur radio satellites using TLE data and satellite.js
 * Includes orbit track prediction
 */
import { useState, useEffect, useCallback } from 'react';
import * as satellite from 'satellite.js';

export const useSatellites = (observerLocation) => {
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
      const positions = [];

      // Observer position in radians
      const observerGd = {
        longitude: satellite.degreesToRadians(observerLocation.lon),
        latitude: satellite.degreesToRadians(observerLocation.lat),
        height: 0.1 // km above sea level
      };

      Object.entries(tleData).forEach(([name, tle]) => {
        // Handle both line1/line2 and tle1/tle2 formats
        const line1 = tle.line1 || tle.tle1;
        const line2 = tle.line2 || tle.tle2;
        if (!line1 || !line2) return;

        try {
          const satrec = satellite.twoline2satrec(line1, line2);
          const positionAndVelocity = satellite.propagate(satrec, now);
          
          if (!positionAndVelocity.position) return;

          const gmst = satellite.gstime(now);
          const positionGd = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
          
          // Convert to degrees
          const lat = satellite.degreesLat(positionGd.latitude);
          const lon = satellite.degreesLong(positionGd.longitude);
          const alt = positionGd.height;

          // Calculate look angles
          const lookAngles = satellite.ecfToLookAngles(
            observerGd,
            satellite.eciToEcf(positionAndVelocity.position, gmst)
          );

          const azimuth = satellite.radiansToDegrees(lookAngles.azimuth);
          const elevation = satellite.radiansToDegrees(lookAngles.elevation);
          const rangeSat = lookAngles.rangeSat;

          // Include all satellites we get TLE for (they're all ham sats)
          // Calculate orbit track (past 45 min and future 45 min = 90 min total)
          const track = [];
          const trackMinutes = 90;
          const stepMinutes = 1;
          
          for (let m = -trackMinutes/2; m <= trackMinutes/2; m += stepMinutes) {
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
          const earthRadius = 6371; // km
          const footprintRadius = earthRadius * Math.acos(earthRadius / (earthRadius + alt));

          positions.push({
            name: tle.name || name,
            lat,
            lon,
            alt: Math.round(alt),
            azimuth: Math.round(azimuth),
            elevation: Math.round(elevation),
            range: Math.round(rangeSat),
            visible: elevation > 0,
            isPopular: tle.priority <= 2,
            track,
            footprintRadius: Math.round(footprintRadius),
            mode: tle.mode || 'Unknown',
            color: tle.color || '#00ffff'
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
