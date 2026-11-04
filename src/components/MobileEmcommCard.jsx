/**
 * MobileEmcommCard — the Mobile layout's opt-in EmComm summary: NWS alerts
 * near DE, the nearest shelters, and the APRS net roster.
 *
 * It owns its data: useEmcommData (alerts + FEMA shelters), the RF-heard
 * APRS shelter reports (useAprsShelterReports, shared with the EmComm
 * layout) and the net-roster poll run only while this card is mounted, and the Mobile layout mounts a
 * card only while it is on screen or next to it. Every other layout, and the
 * Mobile layout with the card switched off, makes no EmComm requests at all.
 */
import { filterRosterByAliases, getAliases } from '../utils/netAliases.js';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmcommData } from '../hooks/useEmcommData.js';
import { useAprsShelterReports } from '../hooks/useAprsShelterReports.js';
import { mergeShelters } from '../utils/emcommShelters.js';
import { formatDistance } from '../utils/geo.js';
import { summarizeEmcomm } from '../utils/mobileLayout.js';

const ROSTER_INTERVAL = 30 * 1000;

const SEVERITY_COLORS = {
  Extreme: '#dc2626',
  Severe: '#ea580c',
  Moderate: '#d97706',
  Minor: '#ca8a04',
};
const SHELTER_STATUS_COLORS = { OPEN: '#22c55e', CLOSED: '#ef4444', FULL: '#f59e0b' };

const expiresIn = (iso) => {
  if (!iso) return '';
  const diff = new Date(iso) - new Date();
  if (!(diff > 0)) return '';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const ageLabel = (age) => (age == null ? '' : age < 1 ? 'now' : age < 60 ? `${age}m` : `${Math.floor(age / 60)}h`);

function Section({ title, count, color, children }) {
  return (
    <section style={{ marginBottom: '12px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
          color,
          fontWeight: 700,
          fontSize: '12px',
          letterSpacing: '0.5px',
          marginBottom: '6px',
        }}
      >
        <span>{title}</span>
        {count != null && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({count})</span>}
      </div>
      {children}
    </section>
  );
}

const muted = { color: 'var(--text-muted)', fontSize: '12px', padding: '2px 0' };
const row = {
  padding: '6px 8px',
  marginBottom: '4px',
  borderRadius: '4px',
  background: 'var(--bg-tertiary)',
  fontSize: '12px',
};

export default function MobileEmcommCard({ location, allUnits }) {
  const { t } = useTranslation();
  const { alerts, shelters, loading } = useEmcommData({ location, enabled: true, includeDisasters: false });
  const aprsShelterReports = useAprsShelterReports({ enabled: true });
  const allShelters = useMemo(() => mergeShelters(shelters, aprsShelterReports), [shelters, aprsShelterReports]);
  const [roster, setRoster] = useState([]);
  const [openAlert, setOpenAlert] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/aprs/net');
        if (res.ok && alive) {
          const data = await res.json();
          // Only check-ins to this station's net addresses (#1237)
          setRoster(filterRosterByAliases(Array.isArray(data?.roster) ? data.roster : [], getAliases()));
        }
      } catch {
        /* offline — keep the last roster */
      }
    };
    load();
    const id = setInterval(load, ROSTER_INTERVAL);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const sum = useMemo(
    () => summarizeEmcomm({ alerts, shelters: allShelters, roster, de: location }),
    [alerts, allShelters, roster, location],
  );
  const dist = allUnits?.dist;

  return (
    <div className="panel" style={{ padding: '10px', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
      <Section
        title={t('mobileLayout.emcomm.alerts', { defaultValue: 'NWS alerts near DE' })}
        count={sum.alerts.length}
        color={SEVERITY_COLORS[sum.worstSeverity] || 'var(--accent-cyan)'}
      >
        {sum.alerts.length === 0 ? (
          <div style={muted}>
            {loading
              ? t('mobileLayout.emcomm.loading', { defaultValue: 'Loading…' })
              : t('mobileLayout.emcomm.noAlerts', { defaultValue: 'No active alerts for your area' })}
          </div>
        ) : (
          sum.alerts.slice(0, 6).map((a) => (
            <button
              type="button"
              key={a.id}
              onClick={() => setOpenAlert(openAlert === a.id ? null : a.id)}
              style={{
                ...row,
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderLeft: `3px solid ${SEVERITY_COLORS[a.severity] || '#888'}`,
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: SEVERITY_COLORS[a.severity] || 'var(--text-primary)', fontWeight: 600 }}>
                  {a.event}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', flexShrink: 0 }}>
                  {expiresIn(a.expires)}
                </span>
              </div>
              {a.headline && <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>{a.headline}</div>}
              {openAlert === a.id && a.instruction && (
                <div style={{ color: '#f59e0b', marginTop: '4px', fontStyle: 'italic' }}>
                  {String(a.instruction).slice(0, 300)}
                </div>
              )}
            </button>
          ))
        )}
      </Section>

      <Section
        title={t('mobileLayout.emcomm.shelters', { defaultValue: 'Nearby shelters' })}
        count={sum.shelterCount}
        color="#22c55e"
      >
        {sum.shelters.length === 0 ? (
          <div style={muted}>{t('mobileLayout.emcomm.noShelters', { defaultValue: 'No open shelters nearby' })}</div>
        ) : (
          sum.shelters.map((s) => {
            // RF-heard APRS report: its own entry, or attached to the FEMA site it matches
            const rf = s.source !== 'fema' ? s : s.aprsReport;
            return (
              <div
                key={s.id}
                data-shelter-source={s.source}
                style={{ ...row, borderLeft: rf ? '2px solid #22c55e' : '2px solid transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || 'Shelter'}</span>
                    <span
                      style={{ color: rf && s.source !== 'fema' ? '#22c55e' : 'var(--text-muted)', fontSize: '10px' }}
                    >
                      {s.source === 'fema' ? 'FEMA' : s.source === 'aprs-rf' ? 'RF' : 'APRS'}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0, display: 'flex', gap: '8px' }}>
                    {s.distanceKm != null && (
                      <span style={{ color: 'var(--text-muted)' }}>{formatDistance(s.distanceKm, dist)}</span>
                    )}
                    <span
                      style={{
                        color: SHELTER_STATUS_COLORS[String(s.status).toUpperCase()] || '#888',
                        fontWeight: 600,
                      }}
                    >
                      {s.status || '?'}
                    </span>
                  </span>
                </div>
                {rf?.text && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>
                    {s.source === 'fema' ? `${rf.from}: ` : ''}
                    {rf.text}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Section>

      <Section
        title={t('mobileLayout.emcomm.roster', { defaultValue: 'Net roster' })}
        count={sum.roster.length}
        color="#a855f7"
      >
        {sum.roster.length === 0 ? (
          <div style={muted}>{t('mobileLayout.emcomm.noRoster', { defaultValue: 'No operators checked in' })}</div>
        ) : (
          <>
            <div style={{ ...muted, marginBottom: '4px' }}>
              {t('mobileLayout.emcomm.activeOps', {
                defaultValue: '{{active}} active, {{stale}} not heard recently',
                active: sum.activeOps,
                stale: sum.roster.length - sum.activeOps,
              })}
            </div>
            {sum.roster.slice(0, 8).map((op) => (
              <div
                key={op.call}
                style={{
                  ...row,
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderLeft: `2px solid ${op.stale ? '#f59e0b' : '#22c55e'}`,
                }}
              >
                <span>
                  <span style={{ color: op.stale ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{op.call}</span>
                  {op.netName && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{op.netName}</span>}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{ageLabel(op.age)}</span>
              </div>
            ))}
            {sum.roster.length > 8 && <div style={muted}>+{sum.roster.length - 8}</div>}
          </>
        )}
      </Section>
    </div>
  );
}
