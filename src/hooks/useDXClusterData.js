/**
 * useDXClusterData Hook
 * Unified DX cluster data - fetches once, filters once, provides both list and map data
 * Replaces separate useDXCluster and useDXPaths hooks
 */
import { useState, useEffect, useCallback, useRef } from 'react';

import { applyDXFilters } from '../utils/dxClusterFilters';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useDXClusterData = (filters = {}, config = {}) => {
  const [allData, setAllData] = useState([]);
  const [spots, setSpots] = useState([]); // For list display
  const [paths, setPaths] = useState([]); // For map display
  const [loading, setLoading] = useState(true);
  const lastFetchRef = useRef(0);
  const fetchRef = useRef(null);

  const spotRetentionMs = (filters?.spotRetentionMinutes || 30) * 60 * 1000;
  const pollInterval = config.lowMemoryMode ? 120000 : 60000; // 120s in low memory, 60s otherwise

  // Build query params for custom cluster settings
  const buildQueryParams = useCallback(() => {
    const params = new URLSearchParams();

    // Add source
    const source = config.dxClusterSource || 'dxspider-proxy';
    params.append('source', source);

    // Add custom cluster settings if using custom source
    if (source === 'custom' && config.customDxCluster) {
      if (config.customDxCluster.host) {
        params.append('host', config.customDxCluster.host);
      }
      if (config.customDxCluster.port) {
        params.append('port', config.customDxCluster.port);
      }
    }

    // Always send callsign for login (with SSID)
    if (config.callsign && config.callsign !== 'N0CALL') {
      params.append('callsign', config.callsign);
    }

    return params.toString();
  }, [config.dxClusterSource, config.customDxCluster, config.callsign]);

  // Apply filters using the consolidated filter function from callsign.js
  const applyFilters = useCallback((data, filters) => {
    if (!filters || Object.keys(filters).length === 0) return data;
    return data.filter((item) => applyDXFilters(item, filters));
  }, []);

  // Fetch data from unified paths endpoint (has all the data we need)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const queryParams = buildQueryParams();
        const response = await apiFetch(`/api/dxcluster/paths?${queryParams}`);
        if (response?.ok) {
          const newData = await response.json();
          const now = Date.now();

          setAllData((prev) => {
            // Create map of existing items by unique key
            const existingMap = new Map(prev.map((item) => [`${item.dxCall}-${item.freq}-${item.spotter}`, item]));

            // Add or update with new data
            newData.forEach((item) => {
              const key = `${item.dxCall}-${item.freq}-${item.spotter}`;
              existingMap.set(key, { ...item, timestamp: item.timestamp || now });
            });

            // Filter out items older than retention time
            const validItems = Array.from(existingMap.values()).filter(
              (item) => now - (item.timestamp || now) < spotRetentionMs,
            );

            // Sort by timestamp (newest first) and limit
            return validItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 200);
          });

          lastFetchRef.current = now;
        }
      } catch (err) {
        console.error('DX cluster data error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, pollInterval);
    fetchRef.current = fetchData;
    return () => clearInterval(interval);
  }, [spotRetentionMs, buildQueryParams]);

  // Refresh immediately when tab becomes visible (handles browser throttling)
  useVisibilityRefresh(() => fetchRef.current?.(), pollInterval);

  // Clean up data when retention time changes
  useEffect(() => {
    setAllData((prev) => {
      const now = Date.now();
      return prev.filter((item) => now - (item.timestamp || now) < spotRetentionMs);
    });
  }, [spotRetentionMs]);

  // Apply filters and split into spots (for list) and paths (for map)
  useEffect(() => {
    const filtered = applyFilters(allData, filters);

    // Low memory mode limits
    const lowMemoryMode = config.lowMemoryMode || false;
    const MAX_SPOTS = lowMemoryMode ? 50 : 500;
    const MAX_PATHS = lowMemoryMode ? 25 : 200;

    // Format for list display (matches old useDXCluster format)
    const spotList = filtered.slice(0, MAX_SPOTS).map((item) => ({
      call: item.dxCall,
      freq: item.freq,
      comment: item.comment || '',
      time: item.time || '',
      spotter: item.spotter,
      source: 'DXCluster',
      dxGrid: item.dxGrid,
      dxLat: item.dxLat,
      dxLon: item.dxLon,
      timestamp: item.timestamp,
    }));

    // Format for map display (matches old useDXPaths format)
    // Only include items that have valid coordinates
    const pathList = filtered
      .filter((item) => item.spotterLat != null && item.spotterLon != null && item.dxLat != null && item.dxLon != null)
      .slice(0, MAX_PATHS);

    setSpots(spotList);
    setPaths(pathList);
  }, [allData, filters, applyFilters, config.lowMemoryMode]);

  return {
    spots, // For DXClusterPanel list
    paths, // For WorldMap
    loading,
    totalSpots: allData.length,
  };
};

export default useDXClusterData;
