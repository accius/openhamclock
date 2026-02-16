import { useEffect, useRef, useState } from 'react';
import { getBandColor } from '../../utils/callsign.js';
import { getGreatCirclePoints, replicatePath, replicatePoint } from '../../utils/geo.js';

export const metadata = {
  id: 'contest_qsos',
  name: 'Contest QSOs',
  description: 'Recent QSOs from contest loggers (N1MM/DXLog)',
  icon: 'QSO',
  category: 'amateur',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.0'
};

export function useLayer({ enabled = false, opacity = 0.7, map = null }) {
  const [qsos, setQsos] = useState([]);
  const [deLocation, setDeLocation] = useState(null);
  const markersRef = useRef([]);
  const linesRef = useRef([]);
  const pollRef = useRef(null);
  const configLoadedRef = useRef(false);

  useEffect(() => {
    if (!enabled || configLoadedRef.current) return;
    const loadConfig = async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = await res.json();
        if (Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
          setDeLocation({ lat: data.latitude, lon: data.longitude, callsign: data.callsign || '' });
          configLoadedRef.current = true;
        }
      } catch (e) {
        // ignore
      }
    };
    loadConfig();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const fetchQsos = async () => {
      try {
        const res = await fetch('/api/contest/qsos?limit=200');
        if (!res.ok) return;
        const data = await res.json();
        setQsos(Array.isArray(data.qsos) ? data.qsos : []);
      } catch (e) {
        // ignore
      }
    };

    fetchQsos();
    pollRef.current = setInterval(fetchQsos, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    linesRef.current.forEach(line => {
      try { map.removeLayer(line); } catch (e) {}
    });
    markersRef.current.forEach(marker => {
      try { map.removeLayer(marker); } catch (e) {}
    });
    linesRef.current = [];
    markersRef.current = [];

    if (!enabled || qsos.length === 0) return;

    const recent = qsos.slice(-120);
    const de = deLocation;

    recent.forEach(qso => {
      const lat = parseFloat(qso.lat);
      const lon = parseFloat(qso.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

      const freqMHz = qso.freqMHz || qso.bandMHz || qso.band;
      const bandColor = freqMHz ? getBandColor(parseFloat(freqMHz)) : '#22c55e';
      const lineOpacity = Math.max(0.15, Math.min(0.7, opacity * 0.35));
      const markerOpacity = Math.max(0.2, Math.min(0.9, opacity));

      if (de && Number.isFinite(de.lat) && Number.isFinite(de.lon)) {
        const points = getGreatCirclePoints(de.lat, de.lon, lat, lon, 50);
        if (Array.isArray(points) && points.length > 1) {
          replicatePath(points).forEach(copy => {
            const line = L.polyline(copy, {
              color: bandColor,
              weight: 1.5,
              opacity: lineOpacity,
              dashArray: '2, 6'
            }).addTo(map);
            linesRef.current.push(line);
          });
        }
      }

      const bandLabel = qso.bandMHz ? `${qso.bandMHz} MHz` : (qso.band || '');
      const timeLabel = qso.time || (qso.timestamp ? new Date(qso.timestamp).toLocaleTimeString() : '');
      const sourceLabel = qso.source ? qso.source.toUpperCase() : '';

      replicatePoint(lat, lon).forEach(([rLat, rLon]) => {
        const marker = L.circleMarker([rLat, rLon], {
          radius: 5,
          fillColor: bandColor,
          color: '#fff',
          weight: 1,
          opacity: 0.9,
          fillOpacity: markerOpacity
        }).bindPopup(`
          <b>${qso.dxCall || ''}</b><br>
          ${qso.mode || ''} ${bandLabel}<br>
          ${timeLabel ? `${timeLabel}<br>` : ''}
          ${sourceLabel}
        `).addTo(map);

        markersRef.current.push(marker);
      });
    });
  }, [qsos, enabled, opacity, map, deLocation]);

  return { layer: markersRef.current };
}
