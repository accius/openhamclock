'use strict';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { calculateGridSquare, calculateSunTimes } from '../../utils';

function convertTimeUTCtoLocal(sunTimes, tz) {
  // We are only ever going to be doing this for local timezone

  if (sunTimes.sunset === '')
    // SunTimes.rise will be 'Midnight sun' or 'Polar night'
    return sunTimes;

  let rise = {};
  let set = {};
  let local = {};
  [rise.hr, rise.mn] = sunTimes.sunrise.split(':').map(Number);
  [set.hr, set.mn] = sunTimes.sunset.split(':').map(Number);

  rise.date = new Date(Date.UTC(0, 0, 0, rise.hr, rise.mn));
  set.date = new Date(Date.UTC(0, 0, 0, set.hr, set.mn));

  local.sunrise = rise.date.toLocaleString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  local.sunset = set.date.toLocaleString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  // Add an element for the minutes since midnight for sunrise/sunset for comparisons
  [rise.hr, rise.mn] = local.sunrise.split(':').map(Number);
  [set.hr, set.mn] = local.sunset.split(':').map(Number);

  local.sunriseMin = (rise.hr % 24) * 60 + rise.mn;
  local.sunsetMin = (set.hr % 24) * 60 + set.mn;

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

  const deGrid = useMemo(() => calculateGridSquare(configLocation.lat, configLocation.lon), [configLocation]);
  const dxGrid = useMemo(() => calculateGridSquare(dxLocation.lat, dxLocation.lon), [dxLocation]);

  // Validate the timezone once per changed value, not on every render.
  // new Intl.DateTimeFormat throws a RangeError for invalid values such as
  // "Etc/Unknown" (returned by Node on minimal Linux containers with no TZ set).
  const safeTimezone = useMemo(() => {
    if (!timezone) return '';
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return timezone;
    } catch {
      return '';
    }
  }, [timezone]);

  const deSunTimes = useMemo(() => {
    // Calculate what sunrise and sunset are in local time.
    let sunTimes = calculateSunTimes(configLocation.lat, configLocation.lon, currentTime);
    sunTimes.local = convertTimeUTCtoLocal(sunTimes, safeTimezone);
    return sunTimes;
  }, [configLocation, currentTime]);
  const dxSunTimes = useMemo(
    () => calculateSunTimes(dxLocation.lat, dxLocation.lon, currentTime),
    [dxLocation, currentTime],
  );

  const utcTime = currentTime.toISOString().substr(11, 8);
  const utcDate = currentTime.toISOString().substr(0, 10);

  const localTimeOpts = { hour12: use12Hour };
  const localDateOpts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (safeTimezone) {
    localTimeOpts.timeZone = safeTimezone;
    localDateOpts.timeZone = safeTimezone;
  }
  const localTime = currentTime.toLocaleTimeString('en-US', localTimeOpts);
  const localDate = currentTime.toLocaleDateString('en-US', localDateOpts);

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
  };
}
