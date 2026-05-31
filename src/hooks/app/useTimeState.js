'use strict';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { latLonToMaidenhead, calculateSunTimes, calculateSolarTimezone } from '../../utils';

/**
 * Convert UTC sunrise/sunset times to local time using Intl.
 */
function convertTimeUTCtoLocal(sunTimes, tz, currentTime) {
  if (sunTimes.sunset === '') {
    return { sunrise: sunTimes.sunrise, sunset: sunTimes.sunset };
  }

  // Get today's date in UTC
  const parts = currentTime.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  let [month, day, year] = parts.split('/').map(Number);
  month--; // Month is 0-indexed

  const [riseHr, riseMn] = sunTimes.sunrise.split(':').map(Number);
  const [setHr, setMn] = sunTimes.sunset.split(':').map(Number);

  const riseDate = new Date(Date.UTC(year, month, day, riseHr, riseMn));
  const setDate = new Date(Date.UTC(year, month, day, setHr, setMn));

  const fmtOpts = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (tz) fmtOpts.timeZone = tz;

  const local = {
    sunrise: new Intl.DateTimeFormat(undefined, fmtOpts).format(riseDate),
    sunset: new Intl.DateTimeFormat(undefined, fmtOpts).format(setDate),
  };

  // Add minutes since midnight for comparison
  const [rH, rM] = local.sunrise.split(':').map(Number);
  const [sH, sM] = local.sunset.split(':').map(Number);
  local.sunriseMin = (rH % 24) * 60 + rM;
  local.sunsetMin = (sH % 24) * 60 + sM;

  return local;
}

export default function useTimeState(configLocation, dxLocation, timezone) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime] = useState(Date.now());
  const [uptime, setUptime] = useState('0d 0h 0m');

  const [use12Hour, setUse12Hour] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_use12Hour') === 'true';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_use12Hour', use12Hour.toString());
    } catch (e) {}
  }, [use12Hour]);

  const handleTimeFormatToggle = useCallback(() => setUse12Hour((prev) => !prev), []);

  // Fetch DX timezone from server API based on dxLocation lat/lon.
  // Uses AbortController to cancel stale requests when coordinates change
  // quickly, and to enforce a 5-second timeout so a hung server doesn't
  // block the solar fallback indefinitely.
  const [dxTimezone, setDxTimezone] = useState(null);

  useEffect(() => {
    if (dxLocation.lat == null || dxLocation.lon == null) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const params = new URLSearchParams({
      lat: dxLocation.lat,
      lon: dxLocation.lon,
    });
    fetch(`/api/geo-time?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.timezone) {
          setDxTimezone(data.timezone);
        } else {
          setDxTimezone(null);
        }
      })
      .catch((err) => {
        setDxTimezone(null);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [dxLocation.lat, dxLocation.lon]);

  // Solar-time fallback: compute an IANA-compatible "Etc/GMT" zone from longitude.
  // Always available regardless of API status.
  const dxSolarFallback = useMemo(() => calculateSolarTimezone(dxLocation.lon), [dxLocation.lon]);

  // ─── Timer ───
  useEffect(() => {
    let timeout;

    const tick = () => {
      const now = new Date();
      setCurrentTime(now);
      const elapsed = Date.now() - startTime;
      const d = Math.floor(elapsed / 86400000);
      const h = Math.floor((elapsed % 86400000) / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      setUptime(`${d}d ${h}h ${m}m`);

      // Re-align to the next wall-clock second boundary to prevent drift
      const msUntilNextSecond = 1000 - (Date.now() % 1000);
      timeout = setTimeout(tick, msUntilNextSecond);
    };

    // Initial fire aligned to the next whole second
    const msUntilNextSecond = 1000 - (Date.now() % 1000);
    timeout = setTimeout(tick, msUntilNextSecond);

    return () => clearTimeout(timeout);
  }, [startTime]);

  const deGrid = useMemo(() => latLonToMaidenhead(configLocation), [configLocation]);
  const dxGrid = useMemo(() => latLonToMaidenhead(dxLocation), [dxLocation]);

  // Validate the DE timezone once per changed value, not on every render.
  const safeTimezone = useMemo(() => {
    if (!timezone) return '';
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return timezone;
    } catch {
      return '';
    }
  }, [timezone]);

  // Sunrise/sunset in local time for DE station
  const deSunTimes = useMemo(() => {
    const sunTimes = calculateSunTimes(configLocation.lat, configLocation.lon, currentTime);
    const local = convertTimeUTCtoLocal(sunTimes, safeTimezone, currentTime);
    return { ...sunTimes, local };
  }, [configLocation, currentTime, safeTimezone]);

  // Sunrise/sunset for DX station (UTC only — local shown via DXLocalTime)
  const dxSunTimes = useMemo(
    () => calculateSunTimes(dxLocation.lat, dxLocation.lon, currentTime),
    [dxLocation, currentTime],
  );

  const utcTime = currentTime.toISOString().substr(11, 8);
  const utcDate = currentTime.toISOString().substr(0, 10);

  // Local time for DE station using Intl (no toLocaleString)
  const timeOpts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: use12Hour };
  if (safeTimezone) timeOpts.timeZone = safeTimezone;
  const localTime = new Intl.DateTimeFormat(undefined, timeOpts).format(currentTime);

  const dateOpts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (safeTimezone) dateOpts.timeZone = safeTimezone;
  const localDate = new Intl.DateTimeFormat(undefined, dateOpts).format(currentTime);

  return {
    currentTime,
    uptime,
    use12Hour,
    handleTimeFormatToggle,
    utcTime,
    utcDate,
    localTime,
    localDate,
    deGrid,
    dxGrid,
    deSunTimes,
    dxSunTimes,
    dxTimezone,
    dxSolarFallback,
  };
}
