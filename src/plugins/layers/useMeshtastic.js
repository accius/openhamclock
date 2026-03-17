/**
 * Meshtastic Map Layer
 * Shows mesh network nodes on the world map with position, name, and status.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

export const metadata = {
  id: 'meshtastic',
  name: 'Meshtastic Nodes',
  description: 'Mesh network nodes from your Meshtastic device',
  icon: '📡',
  category: 'amateur-radio',
  defaultEnabled: false,
  defaultOpacity: 0.9,
  shortcut: 'M',
};

export const useLayer = ({ map, enabled, opacity }) => {
  const layerGroupRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const intervalRef = useRef(null);

  // Fetch nodes from API
  const fetchNodes = useCallback(async () => {
    try {
      const res = await fetch('/api/meshtastic/nodes');
      if (!res.ok) return;
      const data = await res.json();
      if (data.nodes) setNodes(data.nodes);
    } catch {
      // Silent — Meshtastic may not be enabled
    }
  }, []);

  // Polling
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    fetchNodes();
    intervalRef.current = setInterval(fetchNodes, 15000);
    return () => clearInterval(intervalRef.current);
  }, [enabled, fetchNodes]);

  // Render markers
  useEffect(() => {
    if (!map || !enabled) {
      if (layerGroupRef.current) {
        layerGroupRef.current.clearLayers();
      }
      return;
    }

    // Lazy-init layer group
    if (!layerGroupRef.current) {
      const L = window.L;
      if (!L) return;
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const L = window.L;
    layerGroupRef.current.clearLayers();

    const nodesWithPos = nodes.filter((n) => n.hasPosition && n.lat != null && n.lon != null);

    nodesWithPos.forEach((node) => {
      const age = Date.now() - (node.lastHeard || 0);
      const isRecent = age < 30 * 60 * 1000; // 30 min
      const isStale = age > 2 * 60 * 60 * 1000; // 2 hours

      const color = isStale ? '#666666' : isRecent ? '#00ff88' : '#ffaa00';

      // Create marker
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width: 14px; height: 14px;
          background: ${color};
          border: 2px solid rgba(0,0,0,0.5);
          border-radius: 50%;
          opacity: ${opacity};
          box-shadow: 0 0 6px ${color}80;
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([node.lat, node.lon], { icon });

      // Popup
      const snrColor = node.snr != null ? (node.snr > 0 ? '#00ff88' : '#ff4444') : '#888';
      const battStr =
        node.batteryLevel != null
          ? `<tr><td style="color:#888;">Battery:</td><td align="right">${node.batteryLevel}%</td></tr>`
          : '';
      const snrStr =
        node.snr != null
          ? `<tr><td style="color:#888;">SNR:</td><td align="right" style="color:${snrColor};">${node.snr} dB</td></tr>`
          : '';
      const altStr =
        node.alt != null ? `<tr><td style="color:#888;">Altitude:</td><td align="right">${node.alt} m</td></tr>` : '';
      const hopsStr =
        node.hopsAway != null
          ? `<tr><td style="color:#888;">Hops:</td><td align="right">${node.hopsAway}</td></tr>`
          : '';
      const hwStr = node.hwModel
        ? `<tr><td style="color:#888;">Hardware:</td><td align="right">${node.hwModel}</td></tr>`
        : '';
      const ageStr = node.lastHeard
        ? `<tr><td style="color:#888;">Last heard:</td><td align="right">${Math.round(age / 60000)}m ago</td></tr>`
        : '';

      marker.bindPopup(
        `<div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; min-width: 160px;">
          <div style="font-weight:700; color:#fff; font-size:13px; margin-bottom:4px;">
            📡 ${node.longName || node.shortName || node.id}
          </div>
          ${node.shortName && node.longName ? `<div style="color:#888; font-size:9px; margin-bottom:4px;">${node.id}</div>` : ''}
          <table style="width:100%; border-collapse:collapse;">
            <tr><td style="color:#888;">Position:</td><td align="right">${node.lat.toFixed(4)}°, ${node.lon.toFixed(4)}°</td></tr>
            ${altStr}${snrStr}${battStr}${hopsStr}${hwStr}${ageStr}
          </table>
        </div>`,
        {
          className: 'meshtastic-popup',
          maxWidth: 250,
        },
      );

      // Tooltip on hover
      const displayName = node.shortName || node.longName || node.id;
      marker.bindTooltip(displayName, {
        permanent: false,
        direction: 'top',
        offset: [0, -10],
        className: 'meshtastic-tooltip',
      });

      marker.addTo(layerGroupRef.current);
    });

    // Draw mesh lines between nodes that are within reasonable range
    if (nodesWithPos.length > 1) {
      for (let i = 0; i < nodesWithPos.length; i++) {
        for (let j = i + 1; j < nodesWithPos.length; j++) {
          const a = nodesWithPos[i];
          const b = nodesWithPos[j];
          // Only draw lines for nodes heard recently (both within 1 hour)
          const aAge = Date.now() - (a.lastHeard || 0);
          const bAge = Date.now() - (b.lastHeard || 0);
          if (aAge > 60 * 60 * 1000 || bAge > 60 * 60 * 1000) continue;

          const line = L.polyline(
            [
              [a.lat, a.lon],
              [b.lat, b.lon],
            ],
            {
              color: '#00ff8840',
              weight: 1,
              dashArray: '4,4',
              opacity: opacity * 0.5,
            },
          );
          line.addTo(layerGroupRef.current);
        }
      }
    }

    return () => {
      if (layerGroupRef.current) layerGroupRef.current.clearLayers();
    };
  }, [map, enabled, nodes, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (layerGroupRef.current && map) {
        try {
          map.removeLayer(layerGroupRef.current);
        } catch {}
      }
    };
  }, [map]);

  return null;
};
