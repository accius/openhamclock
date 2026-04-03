/**
 * Visitor tracking and session tracking service.
 * Persistent visitor stats that survive server restarts.
 * Privacy: No raw IPs are stored to disk or sent to third parties.
 */

const fs = require('fs');
const path = require('path');
const { formatDuration } = require('../utils/helpers');

/**
 * Initialize and return the visitor stats service.
 * @param {object} ctx - Shared context (logInfo, ROOT_DIR)
 * @returns {object} { visitorStats, sessionTracker, visitorMiddleware, saveVisitorStats, rolloverVisitorStats, formatDuration, STATS_FILE }
 */
function createVisitorStatsService(ctx) {
  const { logInfo, ROOT_DIR } = ctx;

  // Determine best location for stats file with write permission check
  function getStatsFilePath() {
    if (process.env.STATS_FILE) {
      console.log(`[Stats] Using STATS_FILE env: ${process.env.STATS_FILE}`);
      return process.env.STATS_FILE;
    }

    const pathsToTry = ['/data/stats.json', path.join(ROOT_DIR, 'data', 'stats.json'), '/tmp/openhamclock-stats.json'];

    for (const statsPath of pathsToTry) {
      try {
        const dir = path.dirname(statsPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const testFile = path.join(dir, '.write-test-' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log(`[Stats] ✓ Using: ${statsPath}`);
        return statsPath;
      } catch (err) {
        console.log(`[Stats] ✗ ${statsPath}: ${err.code || err.message}`);
      }
    }

    console.log('[Stats] ⚠ No writable storage - stats will be memory-only');
    return null;
  }

  const STATS_FILE = getStatsFilePath();
  const STATS_SAVE_INTERVAL = 5 * 60 * 1000;

  // Load persistent stats from disk
  function loadVisitorStats() {
    const defaults = {
      today: new Date().toISOString().slice(0, 10),
      uniqueVisitorsToday: 0,
      totalRequestsToday: 0,
      allTimeVisitors: 0,
      allTimeRequests: 0,
      serverFirstStarted: new Date().toISOString(),
      lastDeployment: new Date().toISOString(),
      deploymentCount: 1,
      history: [],
      lastSaved: null,
    };

    if (!STATS_FILE) {
      console.log('[Stats] Running in memory-only mode');
      return defaults;
    }

    try {
      if (fs.existsSync(STATS_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        console.log(`[Stats] Loaded from ${STATS_FILE}`);
        console.log(
          `[Stats]   📊 All-time: ${data.allTimeVisitors || 0} unique visitors, ${data.allTimeRequests || 0} requests`,
        );
        console.log(`[Stats]   📅 History: ${(data.history || []).length} days tracked`);
        console.log(
          `[Stats]   🚀 Deployment #${(data.deploymentCount || 0) + 1} (first: ${data.serverFirstStarted || 'unknown'})`,
        );

        const isSameDay = data.today === new Date().toISOString().slice(0, 10);

        return {
          today: new Date().toISOString().slice(0, 10),
          uniqueVisitorsToday: isSameDay ? data.uniqueVisitorsToday || (data.uniqueIPsToday || []).length || 0 : 0,
          totalRequestsToday: isSameDay ? data.totalRequestsToday || 0 : 0,
          allTimeVisitors: data.allTimeVisitors || 0,
          allTimeRequests: data.allTimeRequests || 0,
          serverFirstStarted: data.serverFirstStarted || defaults.serverFirstStarted,
          lastDeployment: new Date().toISOString(),
          deploymentCount: (data.deploymentCount || 0) + 1,
          history: (data.history || []).map(({ countries, ...rest }) => rest),
          lastSaved: data.lastSaved,
        };
      }
    } catch (err) {
      console.error('[Stats] Failed to load:', err.message);
    }

    console.log('[Stats] Starting fresh (no existing stats file)');
    return defaults;
  }

  // Save stats to disk (no PII — only aggregate counts)
  let saveErrorCount = 0;
  function saveVisitorStats() {
    if (!STATS_FILE) return;

    try {
      const dir = path.dirname(STATS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        ...visitorStats,
        lastSaved: new Date().toISOString(),
      };

      fs.writeFileSync(STATS_FILE, JSON.stringify(data));
      visitorStats.lastSaved = data.lastSaved;
      saveErrorCount = 0;
      if (Math.random() < 0.1) {
        console.log(
          `[Stats] Saved - ${visitorStats.allTimeVisitors} all-time visitors, ${visitorStats.uniqueVisitorsToday} today`,
        );
      }
    } catch (err) {
      saveErrorCount++;
      if (saveErrorCount === 1 || saveErrorCount % 10 === 0) {
        console.error(`[Stats] Failed to save (attempt #${saveErrorCount}):`, err.message);
        if (saveErrorCount === 1) {
          console.error("[Stats] Stats will be kept in memory but won't persist across restarts");
        }
      }
    }
  }

  // Initialize stats
  const visitorStats = loadVisitorStats();

  // In-memory sets for dedup (never persisted to disk)
  const crypto = require('crypto');
  const todayIPHashes = new Set();
  const allTimeIPHashes = new Set();
  const MAX_TRACKED_HASHES = 10000;

  function hashIP(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  }

  // Strip legacy fields that may have been loaded from old stats files
  delete visitorStats.countryStats;
  delete visitorStats.countryStatsToday;
  delete visitorStats.geoIPCache;
  delete visitorStats.uniqueIPsToday;
  delete visitorStats.allTimeUniqueIPs;

  // Save immediately on startup
  if (STATS_FILE) {
    saveVisitorStats();
    console.log('[Stats] Initial save complete - persistence confirmed');
  }

  // Periodic save
  setInterval(saveVisitorStats, STATS_SAVE_INTERVAL);

  function rolloverVisitorStats() {
    const now = new Date().toISOString().slice(0, 10);
    if (now !== visitorStats.today) {
      if (visitorStats.uniqueVisitorsToday > 0 || visitorStats.totalRequestsToday > 0) {
        visitorStats.history.push({
          date: visitorStats.today,
          uniqueVisitors: visitorStats.uniqueVisitorsToday,
          totalRequests: visitorStats.totalRequestsToday,
        });
      }
      if (visitorStats.history.length > 90) {
        visitorStats.history = visitorStats.history.slice(-90);
      }
      const avg =
        visitorStats.history.length > 0
          ? Math.round(visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length)
          : 0;
      console.log(
        `[Stats] Daily rollover for ${visitorStats.today}: ${visitorStats.uniqueVisitorsToday} unique, ${visitorStats.totalRequestsToday} requests | All-time: ${visitorStats.allTimeVisitors} visitors | ${visitorStats.history.length}-day avg: ${avg}/day`,
      );

      visitorStats.today = now;
      visitorStats.uniqueVisitorsToday = 0;
      visitorStats.totalRequestsToday = 0;
      todayIPHashes.clear();
      saveVisitorStats();
    }
  }

  // CONCURRENT USER & SESSION TRACKING
  const SESSION_TIMEOUT = 5 * 60 * 1000;
  const SESSION_CLEANUP_INTERVAL = 60 * 1000;

  const sessionTracker = {
    activeSessions: new Map(), // keyed by hashed IP (in-memory only)
    completedSessions: [],
    peakConcurrent: 0,
    peakConcurrentTime: null,

    touch(ip) {
      const key = hashIP(ip);
      const now = Date.now();
      if (this.activeSessions.has(key)) {
        const session = this.activeSessions.get(key);
        session.lastSeen = now;
        session.requests++;
      } else {
        this.activeSessions.set(key, {
          firstSeen: now,
          lastSeen: now,
          requests: 1,
        });
      }
      const current = this.activeSessions.size;
      if (current > this.peakConcurrent) {
        this.peakConcurrent = current;
        this.peakConcurrentTime = new Date().toISOString();
      }
    },

    cleanup() {
      const now = Date.now();
      const expired = [];
      for (const [key, session] of this.activeSessions) {
        if (now - session.lastSeen > SESSION_TIMEOUT) {
          expired.push(key);
          const duration = session.lastSeen - session.firstSeen;
          if (duration > 10000) {
            this.completedSessions.push({
              duration,
              endedAt: new Date(session.lastSeen).toISOString(),
              requests: session.requests,
            });
          }
        }
      }
      expired.forEach((key) => this.activeSessions.delete(key));
      if (this.completedSessions.length > 1000) {
        this.completedSessions = this.completedSessions.slice(-1000);
      }
    },

    getConcurrent() {
      this.cleanup();
      return this.activeSessions.size;
    },

    getStats() {
      this.cleanup();
      const sessions = this.completedSessions;
      if (sessions.length === 0) {
        return {
          concurrent: this.activeSessions.size,
          peakConcurrent: this.peakConcurrent,
          peakConcurrentTime: this.peakConcurrentTime,
          completedSessions: 0,
          avgDuration: 0,
          medianDuration: 0,
          p90Duration: 0,
          maxDuration: 0,
          durationBuckets: {
            under1m: 0,
            '1to5m': 0,
            '5to15m': 0,
            '15to30m': 0,
            '30to60m': 0,
            over1h: 0,
          },
          recentTrend: [],
          activeSessions: [],
        };
      }

      const durations = sessions.map((s) => s.duration).sort((a, b) => a - b);
      const avg = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
      const median = durations[Math.floor(durations.length / 2)];
      const p90 = durations[Math.floor(durations.length * 0.9)];
      const max = durations[durations.length - 1];

      const buckets = {
        under1m: 0,
        '1to5m': 0,
        '5to15m': 0,
        '15to30m': 0,
        '30to60m': 0,
        over1h: 0,
      };
      for (const d of durations) {
        if (d < 60000) buckets.under1m++;
        else if (d < 300000) buckets['1to5m']++;
        else if (d < 900000) buckets['5to15m']++;
        else if (d < 1800000) buckets['15to30m']++;
        else if (d < 3600000) buckets['30to60m']++;
        else buckets.over1h++;
      }

      const recentTrend = [];
      const now = Date.now();
      for (let h = 23; h >= 0; h--) {
        const hourStart = now - (h + 1) * 3600000;
        const hourEnd = now - h * 3600000;
        const hourSessions = sessions.filter((s) => {
          const t = new Date(s.endedAt).getTime();
          return t >= hourStart && t < hourEnd;
        });
        const hourLabel = new Date(hourStart).toISOString().slice(11, 16);
        recentTrend.push({
          hour: hourLabel,
          sessions: hourSessions.length,
          avgDuration:
            hourSessions.length > 0
              ? Math.round(hourSessions.reduce((s, x) => s + x.duration, 0) / hourSessions.length)
              : 0,
          avgDurationFormatted:
            hourSessions.length > 0
              ? formatDuration(Math.round(hourSessions.reduce((s, x) => s + x.duration, 0) / hourSessions.length))
              : '--',
        });
      }

      const activeList = [];
      for (const [, session] of this.activeSessions) {
        activeList.push({
          duration: now - session.firstSeen,
          durationFormatted: formatDuration(now - session.firstSeen),
          requests: session.requests,
        });
      }
      activeList.sort((a, b) => b.duration - a.duration);

      return {
        concurrent: this.activeSessions.size,
        peakConcurrent: this.peakConcurrent,
        peakConcurrentTime: this.peakConcurrentTime,
        completedSessions: sessions.length,
        avgDuration: avg,
        avgDurationFormatted: formatDuration(avg),
        medianDuration: median,
        medianDurationFormatted: formatDuration(median),
        p90Duration: p90,
        p90DurationFormatted: formatDuration(p90),
        maxDuration: max,
        maxDurationFormatted: formatDuration(max),
        durationBuckets: buckets,
        recentTrend,
        activeSessions: activeList.slice(0, 20),
      };
    },
  };

  // Periodic cleanup of stale sessions
  setInterval(() => sessionTracker.cleanup(), SESSION_CLEANUP_INTERVAL);

  // Visitor tracking middleware (privacy-safe: only hashed IPs held in memory, never persisted)
  function visitorMiddleware(req, res, next) {
    rolloverVisitorStats();

    const rawIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const isTrackable = req.path !== '/api/health' && !req.path.startsWith('/assets/');

    if (isTrackable) {
      sessionTracker.touch(rawIp);

      const ipHash = hashIP(rawIp);

      const isNewToday = !todayIPHashes.has(ipHash);
      if (isNewToday) {
        todayIPHashes.add(ipHash);
        visitorStats.uniqueVisitorsToday++;
      }
      visitorStats.totalRequestsToday++;
      visitorStats.allTimeRequests++;

      const isNewAllTime = !allTimeIPHashes.has(ipHash);
      if (isNewAllTime) {
        if (allTimeIPHashes.size < MAX_TRACKED_HASHES) {
          allTimeIPHashes.add(ipHash);
        }
        visitorStats.allTimeVisitors++;
        logInfo(
          `[Stats] New visitor (#${visitorStats.uniqueVisitorsToday} today, #${visitorStats.allTimeVisitors} all-time)`,
        );
      }
    }

    next();
  }

  // Log visitor count every hour
  setInterval(
    () => {
      rolloverVisitorStats();
      if (visitorStats.uniqueVisitorsToday > 0 || visitorStats.allTimeVisitors > 0) {
        const avg =
          visitorStats.history.length > 0
            ? Math.round(
                visitorStats.history.reduce((sum, d) => sum + d.uniqueVisitors, 0) / visitorStats.history.length,
              )
            : visitorStats.uniqueVisitorsToday;
        console.log(
          `[Stats] Hourly: ${visitorStats.uniqueVisitorsToday} unique today, ${visitorStats.totalRequestsToday} requests | All-time: ${visitorStats.allTimeVisitors} visitors | Avg: ${avg}/day`,
        );
      }
      saveVisitorStats();
    },
    60 * 60 * 1000,
  );

  // Periodic GC compaction
  setInterval(
    () => {
      if (typeof global.gc === 'function') {
        const memBefore = process.memoryUsage();
        global.gc();
        const memAfter = process.memoryUsage();
        const heapFreed = ((memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024).toFixed(1);
        const rssNow = (memAfter.rss / 1024 / 1024).toFixed(0);
        if (heapFreed > 5) {
          console.log(`[GC] Compaction freed ${heapFreed}MB heap (RSS=${rssNow}MB)`);
        }
        if (memAfter.rss > 400 * 1024 * 1024) {
          global.gc();
          const rssAfter2 = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
          console.log(`[GC] High RSS — double compaction (${rssNow}MB -> ${rssAfter2}MB)`);
        }
      }
    },
    10 * 60 * 1000,
  );

  return {
    visitorStats,
    sessionTracker,
    visitorMiddleware,
    saveVisitorStats,
    rolloverVisitorStats,
    formatDuration,
    STATS_FILE,
  };
}

module.exports = createVisitorStatsService;
