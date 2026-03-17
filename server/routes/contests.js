/**
 * Contest calendar routes.
 * Lines ~9361-9805 of original server.js
 */

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  // ============================================
  // CONTEST CALENDAR API
  // ============================================

  app.get('/api/contests', async (req, res) => {
    // Try WA7BNM Contest Calendar RSS feed
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('https://www.contestcalendar.com/calendar.rss', {
        headers: {
          'User-Agent': 'OpenHamClock/3.13.1',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const text = await response.text();
        const contests = parseContestRSS(text);

        if (contests.length > 0) {
          logDebug('[Contests] WA7BNM RSS:', contests.length, 'contests');
          return res.json(contests);
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        logErrorOnce('Contests RSS', error.message);
      }
    }

    // Fallback: Use calculated contests
    try {
      const contests = calculateUpcomingContests();
      logDebug('[Contests] Using calculated:', contests.length, 'contests');
      return res.json(contests);
    } catch (error) {
      logErrorOnce('Contests', error.message);
    }

    res.json([]);
  });

  // Parse WA7BNM RSS feed
  function parseContestRSS(xml) {
    const contests = [];
    const now = new Date();
    const currentYear = now.getFullYear();

    // Simple regex-based XML parsing (no external dependencies)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>([^<]+)<\/title>/;
    const linkRegex = /<link>([^<]+)<\/link>/;
    const descRegex = /<description>([^<]+)<\/description>/;

    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];

      const titleMatch = item.match(titleRegex);
      const linkMatch = item.match(linkRegex);
      const descMatch = item.match(descRegex);

      if (titleMatch && descMatch) {
        const name = titleMatch[1].trim();
        const desc = descMatch[1].trim();
        const url = linkMatch ? linkMatch[1].trim() : null;

        // Parse description like "1300Z, Jan 31 to 1300Z, Feb 1" or "0000Z-2359Z, Jan 31"
        const parsed = parseContestDateTime(desc, currentYear);

        if (parsed) {
          const status = now >= parsed.start && now <= parsed.end ? 'active' : 'upcoming';

          // Try to detect mode from contest name
          let mode = 'Mixed';
          const nameLower = name.toLowerCase();
          if (nameLower.includes('cw') || nameLower.includes('morse')) mode = 'CW';
          else if (nameLower.includes('ssb') || nameLower.includes('phone') || nameLower.includes('sideband'))
            mode = 'SSB';
          else if (nameLower.includes('rtty')) mode = 'RTTY';
          else if (nameLower.includes('ft4') || nameLower.includes('ft8') || nameLower.includes('digi'))
            mode = 'Digital';
          else if (nameLower.includes('vhf') || nameLower.includes('uhf')) mode = 'VHF';

          contests.push({
            name,
            start: parsed.start.toISOString(),
            end: parsed.end.toISOString(),
            mode,
            status,
            url,
          });
        }
      }
    }

    // Sort by start date, filter out past contests, and limit
    const currentAndFuture = contests.filter((c) => new Date(c.end) >= now);
    currentAndFuture.sort((a, b) => new Date(a.start) - new Date(b.start));
    return currentAndFuture.slice(0, 20);
  }

  // Parse contest date/time strings
  function parseContestDateTime(desc, year) {
    try {
      const months = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };

      // Pattern 1: "1300Z, Jan 31 to 1300Z, Feb 1"
      const rangeMatch = desc.match(/(\d{4})Z,\s*(\w+)\s+(\d+)\s+to\s+(\d{4})Z,\s*(\w+)\s+(\d+)/i);
      if (rangeMatch) {
        const [, startTime, startMon, startDay, endTime, endMon, endDay] = rangeMatch;
        const startMonth = months[startMon.toLowerCase()];
        const endMonth = months[endMon.toLowerCase()];

        let startYear = year;
        let endYear = year;
        // Handle year rollover
        if (startMonth > 10 && endMonth < 2) endYear = year + 1;

        const start = new Date(
          Date.UTC(
            startYear,
            startMonth,
            parseInt(startDay),
            parseInt(startTime.substring(0, 2)),
            parseInt(startTime.substring(2, 4)),
          ),
        );
        const end = new Date(
          Date.UTC(
            endYear,
            endMonth,
            parseInt(endDay),
            parseInt(endTime.substring(0, 2)),
            parseInt(endTime.substring(2, 4)),
          ),
        );

        return { start, end };
      }

      // Pattern 2: "0000Z-2359Z, Jan 31" (same day)
      const sameDayMatch = desc.match(/(\d{4})Z-(\d{4})Z,\s*(\w+)\s+(\d+)/i);
      if (sameDayMatch) {
        const [, startTime, endTime, mon, day] = sameDayMatch;
        const month = months[mon.toLowerCase()];

        const start = new Date(
          Date.UTC(
            year,
            month,
            parseInt(day),
            parseInt(startTime.substring(0, 2)),
            parseInt(startTime.substring(2, 4)),
          ),
        );
        const end = new Date(
          Date.UTC(year, month, parseInt(day), parseInt(endTime.substring(0, 2)), parseInt(endTime.substring(2, 4))),
        );

        // Handle overnight contests (end time < start time means next day)
        if (end <= start) end.setUTCDate(end.getUTCDate() + 1);

        return { start, end };
      }

      // Pattern 3: "0000Z-0100Z, Feb 5 and 0200Z-0300Z, Feb 6" (multiple sessions - use first)
      const multiMatch = desc.match(/(\d{4})Z-(\d{4})Z,\s*(\w+)\s+(\d+)/i);
      if (multiMatch) {
        const [, startTime, endTime, mon, day] = multiMatch;
        const month = months[mon.toLowerCase()];

        const start = new Date(
          Date.UTC(
            year,
            month,
            parseInt(day),
            parseInt(startTime.substring(0, 2)),
            parseInt(startTime.substring(2, 4)),
          ),
        );
        const end = new Date(
          Date.UTC(year, month, parseInt(day), parseInt(endTime.substring(0, 2)), parseInt(endTime.substring(2, 4))),
        );

        if (end <= start) end.setUTCDate(end.getUTCDate() + 1);

        return { start, end };
      }
    } catch (e) {
      // Parse error, skip this contest
    }

    return null;
  }

  // Helper function to calculate upcoming contests
  function calculateUpcomingContests() {
    const now = new Date();
    const contests = [];

    // Major contest definitions with typical schedules
    const majorContests = [
      { name: 'CQ WW DX CW', month: 10, weekend: -1, duration: 48, mode: 'CW' }, // Last full weekend Nov
      { name: 'CQ WW DX SSB', month: 9, weekend: -1, duration: 48, mode: 'SSB' }, // Last full weekend Oct
      { name: 'ARRL DX CW', month: 1, weekend: 3, duration: 48, mode: 'CW' }, // 3rd full weekend Feb
      { name: 'ARRL DX SSB', month: 2, weekend: 1, duration: 48, mode: 'SSB' }, // 1st full weekend Mar
      { name: 'CQ WPX SSB', month: 2, weekend: -1, duration: 48, mode: 'SSB' }, // Last full weekend Mar
      { name: 'CQ WPX CW', month: 4, weekend: -1, duration: 48, mode: 'CW' }, // Last full weekend May
      {
        name: 'IARU HF Championship',
        month: 6,
        weekend: 2,
        duration: 24,
        mode: 'Mixed',
      }, // 2nd full weekend Jul
      {
        name: 'ARRL Field Day',
        month: 5,
        weekend: 4,
        duration: 27,
        mode: 'Mixed',
      }, // 4th full weekend Jun
      {
        name: 'ARRL Sweepstakes CW',
        month: 10,
        weekend: 1,
        duration: 24,
        mode: 'CW',
      }, // 1st full weekend Nov
      {
        name: 'ARRL Sweepstakes SSB',
        month: 10,
        weekend: 3,
        duration: 24,
        mode: 'SSB',
      }, // 3rd full weekend Nov
      {
        name: 'ARRL 10m Contest',
        month: 11,
        weekend: 2,
        duration: 48,
        mode: 'Mixed',
      }, // 2nd full weekend Dec
      {
        name: 'ARRL RTTY Roundup',
        month: 0,
        weekend: 1,
        duration: 24,
        mode: 'RTTY',
      }, // 1st full weekend Jan
      { name: 'NA QSO Party CW', month: 0, weekend: 2, duration: 12, mode: 'CW' },
      {
        name: 'NA QSO Party SSB',
        month: 0,
        weekend: 3,
        duration: 12,
        mode: 'SSB',
      },
      { name: 'CQ 160m CW', month: 0, weekend: -1, duration: 42, mode: 'CW' }, // Last full weekend Jan
      { name: 'CQ 160m SSB', month: 1, weekend: -1, duration: 42, mode: 'SSB' }, // Last full weekend Feb
      { name: 'CQ WW RTTY', month: 8, weekend: -1, duration: 48, mode: 'RTTY' },
      { name: 'JIDX CW', month: 3, weekend: 2, duration: 48, mode: 'CW' },
      { name: 'JIDX SSB', month: 10, weekend: 2, duration: 48, mode: 'SSB' },
      {
        name: 'ARRL VHF Contest',
        month: 0,
        weekend: 3,
        duration: 33,
        mode: 'Mixed',
      }, // 3rd weekend Jan
      {
        name: 'ARRL June VHF',
        month: 5,
        weekend: 2,
        duration: 33,
        mode: 'Mixed',
      }, // 2nd weekend Jun
      {
        name: 'ARRL Sept VHF',
        month: 8,
        weekend: 2,
        duration: 33,
        mode: 'Mixed',
      }, // 2nd weekend Sep
      {
        name: 'Winter Field Day',
        month: 0,
        weekend: -1,
        duration: 24,
        mode: 'Mixed',
      }, // Last weekend Jan
      { name: 'CQWW WPX RTTY', month: 1, weekend: 2, duration: 48, mode: 'RTTY' }, // 2nd weekend Feb
      {
        name: 'Stew Perry Topband',
        month: 11,
        weekend: 4,
        duration: 14,
        mode: 'CW',
      }, // 4th weekend Dec
      {
        name: 'RAC Canada Day',
        month: 6,
        weekend: 1,
        duration: 24,
        mode: 'Mixed',
      }, // 1st weekend Jul
      {
        name: 'RAC Winter Contest',
        month: 11,
        weekend: -1,
        duration: 24,
        mode: 'Mixed',
      }, // Last weekend Dec
      { name: 'NAQP RTTY', month: 1, weekend: 4, duration: 12, mode: 'RTTY' }, // 4th weekend Feb
      { name: 'NAQP RTTY', month: 6, weekend: 3, duration: 12, mode: 'RTTY' }, // 3rd weekend Jul
    ];

    // Weekly mini-contests (CWT, SST, etc.) - dayOfWeek: 0=Sun, 1=Mon, ... 6=Sat
    const weeklyContests = [
      { name: 'CWT 1300z', dayOfWeek: 3, hour: 13, duration: 1, mode: 'CW' }, // Wednesday
      { name: 'CWT 1900z', dayOfWeek: 3, hour: 19, duration: 1, mode: 'CW' }, // Wednesday
      { name: 'CWT 0300z', dayOfWeek: 4, hour: 3, duration: 1, mode: 'CW' }, // Thursday
      { name: 'CWT 0700z', dayOfWeek: 4, hour: 7, duration: 1, mode: 'CW' }, // Thursday
      {
        name: 'NCCC Sprint',
        dayOfWeek: 5,
        hour: 3,
        minute: 30,
        duration: 0.5,
        mode: 'CW',
      }, // Friday
      { name: 'K1USN SST', dayOfWeek: 0, hour: 0, duration: 1, mode: 'CW' }, // Sunday 0000z (Sat evening US)
      { name: 'K1USN SST', dayOfWeek: 1, hour: 20, duration: 1, mode: 'CW' }, // Monday 2000z
      { name: 'ICWC MST', dayOfWeek: 1, hour: 13, duration: 1, mode: 'CW' }, // Monday 1300z
      { name: 'ICWC MST', dayOfWeek: 1, hour: 19, duration: 1, mode: 'CW' }, // Monday 1900z
      { name: 'ICWC MST', dayOfWeek: 2, hour: 3, duration: 1, mode: 'CW' }, // Tuesday 0300z
      { name: 'SKCC Sprint', dayOfWeek: 3, hour: 0, duration: 2, mode: 'CW' }, // Wednesday 0000z
      { name: 'QRP Fox Hunt', dayOfWeek: 3, hour: 2, duration: 1.5, mode: 'CW' }, // Wednesday 0200z
      {
        name: 'RTTY Weekday Sprint',
        dayOfWeek: 2,
        hour: 23,
        duration: 1,
        mode: 'RTTY',
      }, // Tuesday 2300z
    ];

    // Calculate next occurrences of weekly contests
    weeklyContests.forEach((contest) => {
      const next = new Date(now);
      const currentDay = now.getUTCDay();
      let daysUntil = contest.dayOfWeek - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0) {
        // Check if it's today but already passed
        const todayStart = new Date(now);
        todayStart.setUTCHours(contest.hour, contest.minute || 0, 0, 0);
        if (now > todayStart) daysUntil = 7;
      }

      next.setUTCDate(now.getUTCDate() + daysUntil);
      next.setUTCHours(contest.hour, contest.minute || 0, 0, 0);

      const endTime = new Date(next.getTime() + contest.duration * 3600000);

      contests.push({
        name: contest.name,
        start: next.toISOString(),
        end: endTime.toISOString(),
        mode: contest.mode,
        status: now >= next && now <= endTime ? 'active' : 'upcoming',
      });
    });

    // Calculate next occurrences of major contests
    const year = now.getFullYear();
    majorContests.forEach((contest) => {
      for (let y = year; y <= year + 1; y++) {
        let startDate;

        if (contest.weekend === -1) {
          // Last weekend of month
          startDate = getLastWeekendOfMonth(y, contest.month);
        } else {
          // Nth weekend of month
          startDate = getNthWeekendOfMonth(y, contest.month, contest.weekend);
        }

        // Most contests start at 00:00 UTC Saturday
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(startDate.getTime() + contest.duration * 3600000);

        if (endDate > now) {
          const status = now >= startDate && now <= endDate ? 'active' : 'upcoming';
          contests.push({
            name: contest.name,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            mode: contest.mode,
            status: status,
          });
          break; // Only add next occurrence
        }
      }
    });

    // Sort by start date
    contests.sort((a, b) => new Date(a.start) - new Date(b.start));

    return contests.slice(0, 15);
  }

  function getNthWeekendOfMonth(year, month, n) {
    const date = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    let weekendCount = 0;

    while (date.getUTCMonth() === month) {
      if (date.getUTCDay() === 6) {
        // Saturday
        weekendCount++;
        if (weekendCount === n) return new Date(date);
      }
      date.setUTCDate(date.getUTCDate() + 1);
    }

    return date;
  }

  function getLastWeekendOfMonth(year, month) {
    // Start from last day of month and work backwards
    const date = new Date(Date.UTC(year, month + 1, 0)); // Last day of month

    while (date.getUTCDay() !== 6) {
      // Find last Saturday
      date.setUTCDate(date.getUTCDate() - 1);
    }

    return date;
  }
};
