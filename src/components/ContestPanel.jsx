/**
 * ContestPanel Component
 * Displays upcoming and active contests with live indicators
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CONTEST_REMINDERS_EVENT,
  contestReminderId,
  getContestReminders,
  toggleContestReminder,
} from '../utils/contestReminders';
import { useAlarmState } from '../hooks/app/useAlarmClock.js';
import { useSolarOutlook } from '../hooks/useSolarOutlook.js';
import { KP_CATEGORIES, describeOutlook, outlookForRange } from '../utils/solarOutlook.js';

export const ContestPanel = ({ data, loading }) => {
  const { t, i18n } = useTranslation();
  // SWPC 27-day outlook → per-contest "weekend outlook" pill (predicted Kp + SFI)
  const { days: outlookDays, issued: outlookIssued } = useSolarOutlook();

  // Per-contest start reminders (opt-in for the "Contest Starts" alert feed).
  // Synced across panel instances/tabs via the change event + storage event.
  const [reminders, setReminders] = useState(() => getContestReminders());
  useEffect(() => {
    const sync = () => setReminders(getContestReminders());
    window.addEventListener(CONTEST_REMINDERS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CONTEST_REMINDERS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Once-only alarm clock (utils/alarmClock.js): "set alarm for contest start".
  const { alarm, setOnceAt, update: updateAlarm } = useAlarmState();
  const handleAlarmToggle = (contest, e) => {
    e.stopPropagation();
    const startIso = contest?.start ? new Date(contest.start).toISOString() : null;
    if (!startIso) return;
    if (alarm.once.armed && alarm.once.at === startIso) updateAlarm('once', { armed: false, at: null });
    else setOnceAt(startIso, contest.name || '');
  };

  const handleReminderToggle = (contest, e) => {
    e.stopPropagation();
    setReminders(toggleContestReminder(contest));
  };

  // Switchable option: open WA7BNM contest page on click
  const [openContestLinks, setOpenContestLinks] = useState(() => {
    try {
      return localStorage.getItem('ohc_contest_links') !== 'false';
    } catch {
      return true;
    }
  });

  const toggleContestLinks = () => {
    const next = !openContestLinks;
    setOpenContestLinks(next);
    try {
      localStorage.setItem('ohc_contest_links', String(next));
    } catch {}
  };

  // Build WA7BNM URL: use RSS link if available, otherwise link to calendar
  const getContestUrl = (contest) => {
    if (contest.url) return contest.url;
    // Fallback: link to WA7BNM 8-day contest listing
    return 'https://www.contestcalendar.com/weeklycont.php';
  };

  const handleContestClick = (contest, e) => {
    if (!openContestLinks) return;
    e.stopPropagation();
    window.open(getContestUrl(contest), '_blank', 'noopener,noreferrer');
  };

  const getModeColor = (mode) => {
    switch (mode) {
      case 'CW':
        return 'var(--accent-cyan)';
      case 'SSB':
        return 'var(--accent-amber)';
      case 'RTTY':
        return 'var(--accent-purple)';
      case 'FT8':
      case 'FT4':
      case 'Digital':
        return 'var(--accent-green)';
      case 'VHF':
        return 'var(--accent-blue)';
      case 'Mixed':
        return 'var(--text-secondary)';
      default:
        return 'var(--text-secondary)';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const language = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0].toLowerCase();

    if (language === 'de') {
      const parts = new Intl.DateTimeFormat('de-DE', {
        day: 'numeric',
        month: 'short',
      }).formatToParts(date);
      const day = parts.find((p) => p.type === 'day')?.value || '';
      const month = (parts.find((p) => p.type === 'month')?.value || '').replace(/\.$/, '');
      return `${day}. ${month}`;
    }

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Check if contest is live (happening now)
  const isContestLive = (contest) => {
    if (!contest.start || !contest.end) return false;
    const now = new Date();
    const start = new Date(contest.start);
    const end = new Date(contest.end);
    return now >= start && now <= end;
  };

  // Check if contest starts within 24 hours
  const isStartingSoon = (contest) => {
    if (!contest.start) return false;
    const now = new Date();
    const start = new Date(contest.start);
    const hoursUntil = (start - now) / (1000 * 60 * 60);
    return hoursUntil > 0 && hoursUntil <= 24;
  };

  // Get time remaining or time until start
  const getTimeInfo = (contest) => {
    if (!contest.start || !contest.end) return formatDate(contest.start);

    const now = new Date();
    const start = new Date(contest.start);
    const end = new Date(contest.end);

    if (now >= start && now <= end) {
      // Contest is live - show time remaining (always include hours for readability)
      const hoursLeft = Math.floor((end - now) / (1000 * 60 * 60));
      const minsLeft = Math.floor(((end - now) % (1000 * 60 * 60)) / (1000 * 60));
      return t('contest.panel.time.live.hoursMinutes', {
        hours: hoursLeft,
        minutes: minsLeft,
      });
    } else if (now < start) {
      // Contest hasn't started
      const hoursUntil = Math.floor((start - now) / (1000 * 60 * 60));
      if (hoursUntil < 24) {
        return t('contest.panel.time.startsIn', { hours: hoursUntil });
      }
      return formatDate(contest.start);
    }
    return formatDate(contest.start);
  };

  // Sort contests: live first, then starting soon, then by date
  const sortedContests = data
    ? [...data].sort((a, b) => {
        const aLive = isContestLive(a);
        const bLive = isContestLive(b);
        const aSoon = isStartingSoon(a);
        const bSoon = isStartingSoon(b);

        if (aLive && !bLive) return -1;
        if (!aLive && bLive) return 1;
        if (aSoon && !bSoon) return -1;
        if (!aSoon && bSoon) return 1;

        return new Date(a.start) - new Date(b.start);
      })
    : [];

  // Count live contests
  const liveCount = sortedContests.filter(isContestLive).length;

  return (
    <div
      className="panel"
      style={{
        padding: '8px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span>{t('contest.panel.title')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {liveCount > 0 && (
            <span
              style={{
                background: 'rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '9px',
                fontWeight: '700',
                border: '1px solid #ef4444',
              }}
            >
              <span>{t('contest.panel.live', { liveCount })}</span>
            </span>
          )}
          {/* Toggle: open contest links in WA7BNM */}
          <button
            type="button"
            onClick={toggleContestLinks}
            title={openContestLinks ? 'Click contest names to open WA7BNM (ON)' : 'Contest links disabled (OFF)'}
            aria-label={openContestLinks ? 'Disable contest links' : 'Enable contest links'}
            aria-pressed={openContestLinks}
            style={{
              cursor: 'pointer',
              fontSize: '11px',
              opacity: openContestLinks ? 1 : 0.4,
              userSelect: 'none',
              transition: 'opacity 0.2s',
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
            }}
          >
            🔗
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '10px',
            }}
          >
            <div className="loading-spinner" />
          </div>
        ) : sortedContests.length > 0 ? (
          <div
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {sortedContests.map((contest, i) => {
              const live = isContestLive(contest);
              const soon = isStartingSoon(contest);

              return (
                <div
                  key={`${contest.name}-${i}`}
                  style={{
                    padding: '5px 6px',
                    marginBottom: '3px',
                    borderRadius: '4px',
                    background: live
                      ? 'rgba(239, 68, 68, 0.15)'
                      : soon
                        ? 'rgba(251, 191, 36, 0.1)'
                        : 'rgba(255,255,255,0.03)',
                    border: live ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {live && (
                      <span
                        style={{
                          color: '#ef4444',
                          fontSize: '8px',
                          animation: 'pulse 1.5s infinite',
                        }}
                      >
                        ●
                      </span>
                    )}
                    {soon && !live && <span style={{ color: '#fbbf24', fontSize: '8px' }}>◐</span>}
                    <button
                      type="button"
                      onClick={(e) => handleContestClick(contest, e)}
                      title={openContestLinks ? `Open ${contest.name} on WA7BNM Contest Calendar` : contest.name}
                      aria-label={openContestLinks ? `Open ${contest.name} on WA7BNM Contest Calendar` : contest.name}
                      style={{
                        color: live ? '#ef4444' : 'var(--text-primary)',
                        fontWeight: '600',
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: openContestLinks ? 'pointer' : 'default',
                        textDecoration: 'none',
                        border: 'none',
                        borderBottom: openContestLinks ? '1px dotted rgba(255,255,255,0.2)' : 'none',
                        transition: 'color 0.15s',
                        background: 'none',
                        padding: 0,
                        textAlign: 'left',
                        font: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        if (openContestLinks) e.currentTarget.style.color = 'var(--accent-cyan)';
                      }}
                      onMouseLeave={(e) => {
                        if (openContestLinks) e.currentTarget.style.color = live ? '#ef4444' : 'var(--text-primary)';
                      }}
                    >
                      {contest.name}
                    </button>
                    {/* Per-contest start reminder (Contest Starts alert feed) */}
                    {!live &&
                      (() => {
                        const reminded = reminders.includes(contestReminderId(contest));
                        return (
                          <button
                            type="button"
                            onClick={(e) => handleReminderToggle(contest, e)}
                            title={t(reminded ? 'contest.panel.notify.on' : 'contest.panel.notify.off')}
                            aria-label={t(reminded ? 'contest.panel.notify.on' : 'contest.panel.notify.off')}
                            aria-pressed={reminded}
                            style={{
                              cursor: 'pointer',
                              fontSize: '10px',
                              opacity: reminded ? 1 : 0.35,
                              userSelect: 'none',
                              transition: 'opacity 0.2s',
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: reminded ? 'var(--accent-amber)' : 'inherit',
                              flexShrink: 0,
                            }}
                          >
                            🔔
                          </button>
                        );
                      })()}
                    {/* Once-only alarm clock at contest start */}
                    {!live &&
                      contest.start &&
                      (() => {
                        const startIso = new Date(contest.start).toISOString();
                        const set = alarm.once.armed && alarm.once.at === startIso;
                        return (
                          <button
                            type="button"
                            onClick={(e) => handleAlarmToggle(contest, e)}
                            title={t(set ? 'contest.panel.alarm.on' : 'contest.panel.alarm.off')}
                            aria-label={t(set ? 'contest.panel.alarm.on' : 'contest.panel.alarm.off')}
                            aria-pressed={set}
                            style={{
                              cursor: 'pointer',
                              fontSize: '10px',
                              opacity: set ? 1 : 0.35,
                              userSelect: 'none',
                              transition: 'opacity 0.2s',
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: set ? '#4ade80' : 'inherit',
                              flexShrink: 0,
                            }}
                          >
                            ⏰
                          </button>
                        );
                      })()}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '3px',
                    }}
                  >
                    <span style={{ color: getModeColor(contest.mode) }}>
                      {contest.mode}
                      {(() => {
                        // Weekend outlook pill — only for contests inside the 27-day window
                        const range = outlookForRange(outlookDays, contest.start, contest.end || contest.start);
                        if (!range?.category) return null;
                        const cat = KP_CATEGORIES[range.category];
                        const label = `${cat.label}${range.minSfi != null ? ` · SFI ${range.minSfi}` : ''}`;
                        return (
                          <span
                            title={describeOutlook(range, outlookIssued)}
                            aria-label={describeOutlook(range, outlookIssued)}
                            style={{
                              marginLeft: '6px',
                              padding: '0 4px',
                              fontSize: '8px',
                              fontWeight: 700,
                              letterSpacing: '0.3px',
                              color: cat.color,
                              border: `1px solid ${cat.color}`,
                              borderRadius: '3px',
                              verticalAlign: 'middle',
                            }}
                          >
                            {label}
                          </span>
                        );
                      })()}
                    </span>
                    <span
                      style={{
                        color: live ? '#ef4444' : soon ? '#fbbf24' : 'var(--text-muted)',
                        fontWeight: live ? '600' : '400',
                      }}
                    >
                      {getTimeInfo(contest)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              padding: '10px',
              fontSize: '11px',
            }}
          >
            {t('contest.panel.no.contests')}
          </div>
        )}
      </div>

      {/* Contest Calendar Credit */}
      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
        }}
      >
        <a
          href="https://www.contestcalendar.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '9px',
            color: 'var(--text-muted)',
            textDecoration: 'none',
          }}
        >
          {t('contest.panel.calendar')}
        </a>
      </div>
    </div>
  );
};

export default ContestPanel;
