/**
 * useDXCluster Hook
 * Fetches and filters DX cluster spots with 30-minute default retention
 */
import { useState, useEffect, useCallback } from 'react';

import {applyDXFilters} from "../utils/dxClusterFilters";

export const useDXCluster = (source = 'auto', filters = {}) => {
  const [allSpots, setAllSpots] = useState([]); // All accumulated spots
  const [data, setData] = useState([]); // Filtered spots for display
  const [loading, setLoading] = useState(true);
  const [activeSource, setActiveSource] = useState('');
  
  // Get retention time from filters, default to 30 minutes
  const spotRetentionMs = (filters?.spotRetentionMinutes || 30) * 60 * 1000;
  const pollInterval = 60000; // 60 seconds - reduced from 30s to save bandwidth

  // Apply filters to spots using the consolidated filter function
  const applyFilters = useCallback((spots, filters) => {
    if (!filters || Object.keys(filters).length === 0) return spots;
    return spots.filter(spot => applyDXFilters(spot, filters));
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/dxcluster/spots?source=${encodeURIComponent(source)}`);
        if (response.ok) {
          const newSpots = await response.json();
          
          setAllSpots(prev => {
            const now = Date.now();
            // Create map of existing spots by unique key
            const existingMap = new Map(
              prev.map(s => [`${s.call}-${s.freq}-${s.spotter}`, s])
            );
            
            // Add or update with new spots
            newSpots.forEach(spot => {
              const key = `${spot.call}-${spot.freq}-${spot.spotter}`;
              existingMap.set(key, { ...spot, timestamp: now });
            });
            
            // Filter out spots older than retention time
            const validSpots = Array.from(existingMap.values())
              .filter(s => (now - (s.timestamp || now)) < spotRetentionMs);
            
            // Sort by timestamp (newest first) and limit
            return validSpots
              .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
              .slice(0, 200);
          });
          
          setActiveSource('dxcluster');
        }
      } catch (err) {
        console.error('DX cluster error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, pollInterval);
    return () => clearInterval(interval);
  }, [source, spotRetentionMs]);

  // Clean up spots immediately when retention time changes
  useEffect(() => {
    setAllSpots(prev => {
      const now = Date.now();
      return prev.filter(s => (now - (s.timestamp || now)) < spotRetentionMs);
    });
  }, [spotRetentionMs]);

  // Apply filters whenever allSpots or filters change
  useEffect(() => {
    const filtered = applyFilters(allSpots, filters);
    setData(filtered);
  }, [allSpots, filters, applyFilters]);

  return { data, loading, activeSource, totalSpots: allSpots.length };
};

export default useDXCluster;
