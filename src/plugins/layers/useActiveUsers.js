import { useState, useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { apiFetch } from '../../utils/apiFetch';

// 👥 Active Users layer — shows all active OpenHamClock users on the map.
// Presence heartbeats are sent globally from usePresence hook in App.jsx
// for ALL configured users. This layer only controls display.

export const metadata = {
  id: 'active-users',
  name: 'Active Users',
  description: 'Show other OpenHamClock operators on the map',
  icon: '👥',
  category: 'fun',
  defaultEnabled: false,
  defaultOpacity: 0.85,
  version: '1.0.0',
};

const FETCH_INTERVAL = 60 * 1000; // 1 minute

export function useLayer({ enabled = false, opacity = 0.85, map = null, callsign }) {
  const [users, setUsers] = useState([]);
  const markersRef = useRef([]);

  // Fetch active users
  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      return;
    }

    const fetchUsers = async () => {
      try {
        const res = await apiFetch('/api/presence');
        if (res?.ok) {
          const data = await res.json();
          setUsers(data.users || []);
        }
      } catch {
        // Silently fail
      }
    };

    fetchUsers();
    const interval = setInterval(fetchUsers, FETCH_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled]);

  // Render markers
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    // Clear old markers
    markersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    markersRef.current = [];

    if (!enabled || users.length === 0) return;

    const myCall = (callsign || '').toUpperCase();
    const newMarkers = [];

    users.forEach((user) => {
      if (user.lat == null || user.lon == null) return;
      const isMe = user.call === myCall;

      const bg = isMe ? 'rgba(34, 197, 94, 0.9)' : 'rgba(99, 102, 241, 0.85)';
      const border = isMe ? 'rgba(34, 197, 94, 0.6)' : 'rgba(255,255,255,0.3)';
      const label = isMe ? `${user.call} (you)` : user.call;

      const icon = L.divIcon({
        className: 'active-user-icon',
        html: `<div style="
          background: ${bg};
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          padding: 2px 5px;
          border-radius: 4px;
          border: 1px solid ${border};
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
          line-height: 1.2;
        ">${esc(label)}</div>`,
        iconSize: null,
        iconAnchor: [20, 10],
      });

      const marker = L.marker([user.lat, user.lon], {
        icon,
        opacity,
        zIndexOffset: isMe ? 6000 : 5000,
      }).addTo(map);

      const ageStr = user.age < 1 ? 'just now' : `${user.age}m ago`;
      const popupColor = isMe ? '#22c55e' : '#6366f1';
      marker.bindPopup(`
        <div style="font-family: 'JetBrains Mono', monospace; min-width: 140px;">
          <div style="font-size: 14px; font-weight: bold; color: ${popupColor}; margin-bottom: 4px;">
            👥 ${esc(user.call)}${isMe ? ' (you)' : ''}
          </div>
          <div style="font-size: 11px; color: #888;">
            ${user.grid ? `Grid: ${esc(user.grid)}<br>` : ''}
            Last seen: ${ageStr}
          </div>
        </div>
      `);

      newMarkers.push(marker);
    });

    markersRef.current = newMarkers;

    return () => {
      newMarkers.forEach((m) => {
        try {
          map.removeLayer(m);
        } catch {}
      });
    };
  }, [enabled, users, map, opacity, callsign]);

  return { users, userCount: users.length };
}
