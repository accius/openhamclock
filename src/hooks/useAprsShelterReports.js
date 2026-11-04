/**
 * useAprsShelterReports — RF-heard APRS shelter status reports
 * (/api/aprs/shelters), polled every 30 s while `enabled`.
 *
 * Shared by the EmComm layout and the Mobile layout's EmComm card; merge
 * them with FEMA shelters via utils/emcommShelters.js mergeShelters().
 * No requests while disabled or unmounted.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

export const APRS_SHELTERS_INTERVAL = 30 * 1000;

export function useAprsShelterReports({ enabled = true } = {}) {
  const [reports, setReports] = useState([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch('/api/aprs/shelters', { cache: 'no-store' });
        if (res?.ok && alive) {
          const data = await res.json();
          setReports(Array.isArray(data?.shelters) ? data.shelters : []);
        }
      } catch {
        /* offline — keep the last reports */
      }
    };
    load();
    const timer = setInterval(load, APRS_SHELTERS_INTERVAL);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);

  return reports;
}

export default useAprsShelterReports;
