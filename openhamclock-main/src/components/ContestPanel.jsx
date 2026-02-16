/**
 * ContestPanel Component
 * Displays upcoming and active contests with live indicators
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';


export const ContestPanel = ({ data, loading }) => {
  const { t } = useTranslation();
  
  // Switchable option: open WA7BNM contest page on click
  const [openContestLinks, setOpenContestLinks] = useState(() => {
    try { return localStorage.getItem('ohc_contest_links') !== 'false'; } catch { return true; }
  });
  
  const toggleContestLinks = () => {
    const next = !openContestLinks;
    setOpenContestLinks(next);
    try { localStorage.setItem('ohc_contest_links', String(next)); } catch {}
  };

  // Build WA7BNM URL: use RSS link if available, otherwise link to calendar
  const getContestUrl = (contest) => {
    if (contest.url) return contest.url;
    // Fallback: link to WA7BNM current contest listing
    return 'https://www.contestcalendar.com/fwcont.php';
  };
  
  const handleContestClick = (contest, e) => {
    if (!openContestLinks) return;
    e.stopPropagation();
    window.open(getContestUrl(contest), '_blank', 'noopener,noreferrer');
  };

  const getModeColor = (mode) => {
    switch (mode) {
      case 'CW': return 'var(--accent-cyan)';
      case 'SSB': return 'var(--accent-amber)';
      case 'RTTY': return 'var(--accent-purple)';
      case 'FT8': case 'FT4': return 'var(--accent-green)';
      case 'Mixed': return 'var(--text-secondary)';
      default: return 'var(--text-secondary)';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + 'z';
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
      // Contest is live - show time remaining
      const hoursLeft = Math.floor((end - now) / (1000 * 60 * 60));
      const minsLeft = Math.floor(((end - now) % (1000 * 60 * 60)) / (1000 * 60));
      if (hoursLeft > 0) {
        return `${hoursLeft}h ${minsLeft}m left`;
      }
      return `${minsLeft}m left`;
    } else if (now < start) {
      // Contest hasn't started
      const hoursUntil = Math.floor((start - now) / (1000 * 60 * 60));
      if (hoursUntil < 24) {
        return `Starts in ${hoursUntil}h`;
      }
      return formatDate(contest.start);
    }
    return formatDate(contest.start);
  };

  // Sort contests: live first, then starting soon, then by date
  const sortedContests = data ? [...data].sort((a, b) => {
    const aLive = isContestLive(a);
    const bLive = isContestLive(b);
    const aSoon = isStartingSoon(a);
    const bSoon = isStartingSoon(b);

    if (aLive && !bLive) return -1;
    if (!aLive && bLive) return 1;
    if (aSoon && !bSoon) return -1;
    if (!aSoon && bSoon) return 1;

    return new Date(a.start) - new Date(b.start);
  }) : [];

  // Count live contests
  const liveCount = sortedContests.filter(isContestLive).length;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        marginBottom: '6px',
        fontSize: '11px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: 'var(--accent-primary)',
        fontWeight: '700'
      }}>
        <span>{t('contest.panel.title')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {liveCount > 0 && (
            <span style={{
              background: 'rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '9px',
              fontWeight: '700',
              border: '1px solid #ef4444'
            }}>
              <span>{t('contest.panel.live', { liveCount })}</span>
            </span>
          )}
          {/* Toggle: open contest links in WA7BNM */}
          <span
            onClick={toggleContestLinks}
            title={openContestLinks ? 'Click contest names to open WA7BNM (ON)' : 'Contest links disabled (OFF)'}
            style={{
              cursor: 'pointer',
              fontSize: '11px',
              opacity: openContestLinks ? 1 : 0.4,
              userSelect: 'none',
              transition: 'opacity 0.2s'
            }}
          >🔗</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : sortedContests.length > 0 ? (
          <div style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>
            {sortedContests.slice(0, 4).map((contest, i) => {
              const live = isContestLive(contest);
              const soon = isStartingSoon(contest);

              return (
                <div
                  key={`${contest.name}-${i}`}
                  style={{
                    padding: '5px 6px',
                    marginBottom: '3px',
                    borderRadius: '4px',
                    background: live ? 'rgba(239, 68, 68, 0.15)' : soon ? 'rgba(251, 191, 36, 0.1)' : 'rgba(255,255,255,0.03)',
                    border: live ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    {live && (
                      <span style={{
                        color: '#ef4444',
                        fontSize: '8px',
                        animation: 'pulse 1.5s infinite'
                      }}>●</span>
                    )}
                    {soon && !live && (
                      <span style={{ color: '#fbbf24', fontSize: '8px' }}>◐</span>
                    )}
                    <span
                      onClick={(e) => handleContestClick(contest, e)}
                      style={{
                        color: live ? '#ef4444' : 'var(--text-primary)',
                        fontWeight: '600',
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: openContestLinks ? 'pointer' : 'default',
                        textDecoration: openContestLinks ? 'none' : 'none',
                        borderBottom: openContestLinks ? '1px dotted rgba(255,255,255,0.2)' : 'none',
                        transition: 'color 0.15s'
                      }}
                      onMouseEnter={(e) => { if (openContestLinks) e.target.style.color = 'var(--accent-cyan)'; }}
                      onMouseLeave={(e) => { if (openContestLinks) e.target.style.color = live ? '#ef4444' : 'var(--text-primary)'; }}
                      title={openContestLinks ? `Open ${contest.name} on WA7BNM Contest Calendar` : contest.name}
                    >
                      {contest.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                    <span style={{ color: getModeColor(contest.mode) }}>{contest.mode}</span>
                    <span style={{
                      color: live ? '#ef4444' : soon ? '#fbbf24' : 'var(--text-muted)',
                      fontWeight: live ? '600' : '400'
                    }}>
                      {getTimeInfo(contest)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            {t('contest.panel.no.contests')}
          </div>
        )}
      </div>

      {/* Contest Calendar Credit */}
      <div style={{
        marginTop: '4px',
        paddingTop: '4px',
        borderTop: '1px solid var(--border-color)',
        textAlign: 'right'
      }}>
        <a
          href="https://www.contestcalendar.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '9px',
            color: 'var(--text-muted)',
            textDecoration: 'none'
          }}
        >
          {t('contest.panel.calendar')}
        </a>
      </div>
    </div>
  );
};

export default ContestPanel;
