'use strict';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { calculateGridSquare, calculateSunTimes } from '../../utils';

export default function useTimeState(configLocation, dxLocation, timezone) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime] = useState(Date.now());
  const [uptime, setUptime] = useState('0d 0h 0m');

  const [use12Hour, setUse12Hour] = useState(() => {
    try {
      return localStorage.getItem('openhamclock_use12Hour') === 'true';
    } catch (e) { return false; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('openhamclock_use12Hour', use12Hour.toString());
    } catch (e) {}
  }, [use12Hour]);

  const handleTimeFormatToggle = useCallback(() => setUse12Hour(prev => !prev), []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      const elapsed = Date.now() - startTime;
      const d = Math.floor(elapsed / 86400000);
      const h = Math.floor((elapsed % 86400000) / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      setUptime(`${d}d ${h}h ${m}m`);
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const deGrid = useMemo(() => calculateGridSquare(configLocation.lat, configLocation.lon), [configLocation]);
  const dxGrid = useMemo(() => calculateGridSquare(dxLocation.lat, dxLocation.lon), [dxLocation]);
  const deSunTimes = useMemo(() => calculateSunTimes(configLocation.lat, configLocation.lon, currentTime), [configLocation, currentTime]);
  const dxSunTimes = useMemo(() => calculateSunTimes(dxLocation.lat, dxLocation.lon, currentTime), [dxLocation, currentTime]);

  const utcTime = currentTime.toISOString().substr(11, 8);
  const utcDate = currentTime.toISOString().substr(0, 10);
  const localTimeOpts = { hour12: use12Hour };
  const localDateOpts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (timezone) {
    localTimeOpts.timeZone = timezone;
    localDateOpts.timeZone = timezone;
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
    dxSunTimes
  };
}
