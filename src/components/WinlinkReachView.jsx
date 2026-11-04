/**
 * WinlinkReachView — the Winlink panel's "Reachable" view.
 *
 * Ranked list of HF gateways within range by predicted P.533 circuit
 * reliability from the station to each gateway, on the gateway's own
 * frequencies, for the current (display-time) UTC hour; gateways outside
 * their published operating hours are shown as Off the air. Nearby VHF/UHF
 * gateways are ranked by distance with a line-of-sight hint.
 *
 * Reads the shared runner (services/winlinkReachStore.js) — the map layer
 * and the EmComm list use the same results, so nothing is predicted twice.
 * Kept mounted (hidden) after first use while the panel is open so the
 * map keeps its reachability colouring when the operator flips to the inbox.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRig } from '../contexts/RigContext.jsx';
import { useWinlinkReach, REACH_PRIORITY } from '../hooks/useWinlinkReach.js';
import { ANTENNA_PROFILES } from '../utils/propagationAdjust.js';
import { formatDistance } from '../utils/geo.js';
import { winlinkModeColor } from '../utils/winlinkModes.js';
import {
  DEFAULT_THRESHOLDS,
  RANGE_OPTIONS_KM,
  STATUS_COLORS,
  modeSnrInfo,
  passesReachFilter,
  patConnectUrl,
  rigModeForChannel,
} from '../utils/winlinkReach.js';

const FILTER_STORAGE_KEY = 'ohc_winlinkReachFilter';
const FILTERS = ['all', 'reachable', 'good'];

function loadFilter() {
  try {
    const v = localStorage.getItem(FILTER_STORAGE_KEY);
    return FILTERS.includes(v) ? v : 'all';
  } catch {
    return 'all';
  }
}

function utcHHMM(ms) {
  if (!ms) return '--';
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z`;
}

function compass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const smallBtn = {
  padding: '2px 6px',
  fontSize: '10px',
  borderRadius: '3px',
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};

const selectStyle = {
  padding: '2px 4px',
  fontSize: '10px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
};

const numberStyle = { ...selectStyle, width: '46px' };

const headingStyle = {
  padding: '4px 4px 2px',
  fontSize: '10px',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

export default function WinlinkReachView({
  hidden = false,
  deLocation,
  propConfig,
  solarIndices,
  units = 'imperial',
  onSelectGateway,
}) {
  const { t } = useTranslation();
  const rig = useRig();
  const [expanded, setExpanded] = useState(null);
  const [copied, setCopied] = useState(null);
  const [filter, setFilter] = useState(loadFilter);
  const [showThresholds, setShowThresholds] = useState(false);
  const ssn = solarIndices?.data?.ssn?.current ?? null;

  const reach = useWinlinkReach({
    id: 'panel',
    priority: REACH_PRIORITY.panel,
    active: true,
    deLocation,
    propConfig,
    ssn,
  });
  const hasDe = Number.isFinite(deLocation?.lat) && Number.isFinite(deLocation?.lon);
  const th = reach.thresholds || DEFAULT_THRESHOLDS;

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, filter);
    } catch {
      /* storage unavailable */
    }
  }, [filter]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(id);
  }, [copied]);

  const canTune = !!(rig?.enabled && rig?.connected && typeof rig?.tuneTo === 'function');

  const tune = useCallback(
    (channel) => {
      if (!canTune || !channel?.dialHz) return;
      rig.tuneTo(channel.dialHz, rigModeForChannel(channel));
    },
    [canTune, rig],
  );

  const select = useCallback(
    (row, channel) => {
      onSelectGateway?.({ lat: row.lat, lon: row.lon, callsign: row.callsign });
      tune(channel);
    },
    [onSelectGateway, tune],
  );

  const copyPat = useCallback(async (callsign, channel) => {
    const url = patConnectUrl(callsign, channel);
    if (!url) return;
    const ok = await copyText(url);
    setCopied(ok ? url : null);
  }, []);

  const visibleRows = useMemo(
    () =>
      reach.rows.filter((r) =>
        passesReachFilter(reach.byCall?.[r.callsign] || { kind: 'hf', status: r.status }, filter),
      ),
    [reach.rows, reach.byCall, filter],
  );
  const visiblePacket = useMemo(
    () =>
      reach.packet.filter((p) =>
        passesReachFilter({ kind: 'packet', los: p.los, status: p.onAir === false ? 'offair' : 'unknown' }, filter),
      ),
    [reach.packet, filter],
  );

  const statusLabel = (s) =>
    ({
      good: t('winlinkReach.status.good', { defaultValue: 'Good' }),
      marginal: t('winlinkReach.status.marginal', { defaultValue: 'Marginal' }),
      closed: t('winlinkReach.status.closed', { defaultValue: 'Closed' }),
      offair: t('winlinkReach.status.offair', { defaultValue: 'Off the air' }),
      unknown: t('winlinkReach.status.unknown', { defaultValue: '…' }),
    })[s] || s;

  const losLabel = (los) =>
    ({
      los: t('winlinkReach.los.los', { defaultValue: 'Line of sight' }),
      extended: t('winlinkReach.los.extended', { defaultValue: 'Needs height / good antenna' }),
      beyond: t('winlinkReach.los.beyond', { defaultValue: 'Beyond line of sight' }),
    })[los] || '';

  const engineLabel =
    reach.engine === 'wasm'
      ? t('winlinkReach.engine.wasm', { defaultValue: 'ITU-R P.533, computed in your browser' })
      : reach.engine === 'server'
        ? t('winlinkReach.engine.server', { defaultValue: 'ITU-R P.533 on the server (band-level)' })
        : reach.engine === 'est'
          ? t('winlinkReach.engine.est', { defaultValue: 'Solar-indices estimate (P.533 engine unavailable)' })
          : '';

  const antennaName = (ANTENNA_PROFILES[propConfig?.antenna] || ANTENNA_PROFILES.isotropic).name;
  const { done, total } = reach.progress;

  const floorTitle = (c) => {
    if (!c) return '';
    const info = modeSnrInfo(c.mode, { pactor4: !!reach.pactor4 });
    const basis = {
      measured: t('winlinkReach.basis.measured', { defaultValue: 'measured' }),
      vendor: t('winlinkReach.basis.vendor', { defaultValue: 'manufacturer figure' }),
      estimate: t('winlinkReach.estimated', { defaultValue: 'estimate' }),
    }[info.basis];
    return t('winlinkReach.floorTitle', {
      defaultValue: '{{mode}} holds a link down to {{floor}} dB SNR (3 kHz) — {{source}}',
      mode: c.modeLabel,
      floor: info.floorDb,
      source: `${basis}: ${info.source}`,
    });
  };

  const bandText = (c) => (c?.band ? `${c.bandApprox ? '≈' : ''}${c.band}` : '—');

  const renderChip = (status) => (
    <span
      style={{
        display: 'inline-block',
        minWidth: '52px',
        textAlign: 'center',
        padding: '1px 5px',
        borderRadius: '3px',
        fontSize: '9px',
        fontWeight: 700,
        color: status === 'unknown' ? 'var(--text-muted)' : status === 'offair' ? '#fff' : '#000',
        background: status === 'unknown' ? 'var(--bg-tertiary)' : STATUS_COLORS[status],
        flexShrink: 0,
      }}
      data-status={status}
    >
      {statusLabel(status)}
    </span>
  );

  const renderHoursBadge = (note) => (
    <span
      data-testid="hours-unknown"
      title={
        note?.hoursPerDay
          ? t('winlinkReach.hoursUnknownPerDay', {
              defaultValue:
                'Published hours "{{text}}": about {{n}} h a day, but not which hours — it may be off the air now.',
              text: note.text,
              n: note.hoursPerDay,
            })
          : t('winlinkReach.hoursUnknownTitle', {
              defaultValue: 'Published hours "{{text}}" do not say when it is on the air — it may be off the air now.',
              text: note?.text ?? '',
            })
      }
      style={{
        fontSize: '9px',
        padding: '0 4px',
        borderRadius: '3px',
        border: '1px dashed var(--text-muted)',
        color: 'var(--text-muted)',
      }}
    >
      {t('winlinkReach.hoursUnknown', { defaultValue: 'hours ?' })}
    </span>
  );

  const renderChannelActions = (callsign, channel) => {
    const url = patConnectUrl(callsign, channel);
    return (
      <span style={{ display: 'inline-flex', gap: '3px' }} onClick={(e) => e.stopPropagation()}>
        {canTune && channel?.dialHz && (
          <button
            type="button"
            style={smallBtn}
            onClick={() => tune(channel)}
            title={t('winlinkReach.tuneTitle', {
              defaultValue: 'Tune the rig to {{dial}} kHz dial',
              dial: String(channel.dialHz / 1000),
            })}
          >
            {t('winlinkReach.tune', { defaultValue: 'Tune' })}
          </button>
        )}
        {url && (
          <button
            type="button"
            style={smallBtn}
            onClick={() => copyPat(callsign, channel)}
            title={t('winlinkReach.copyTitle', { defaultValue: 'Copy the Pat connect string: {{url}}', url })}
          >
            {t('winlinkReach.copy', { defaultValue: 'Pat' })}
          </button>
        )}
      </span>
    );
  };

  const setTh = (key, value) => reach.setThresholds({ ...th, [key]: value });

  return (
    <div style={{ display: hidden ? 'none' : 'block' }} aria-hidden={hidden}>
      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '4px',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '10px',
          color: 'var(--text-muted)',
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {t('winlinkReach.range', { defaultValue: 'Range' })}
          <select
            value={reach.rangeKm}
            onChange={(e) => reach.setRange(parseInt(e.target.value, 10))}
            style={selectStyle}
          >
            {RANGE_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                {formatDistance(km, units)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {t('winlinkReach.show', { defaultValue: 'Show' })}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={selectStyle}
            aria-label={t('winlinkReach.showAria', { defaultValue: 'Which gateways to show' })}
          >
            <option value="all">{t('winlinkReach.layer.all', { defaultValue: 'All gateways' })}</option>
            <option value="reachable">
              {t('winlinkReach.layer.reachable', { defaultValue: 'Predicted reachable' })}
            </option>
            <option value="good">{t('winlinkReach.layer.good', { defaultValue: 'Good only' })}</option>
          </select>
        </label>
        <button
          type="button"
          style={{ ...smallBtn, opacity: reach.running ? 0.5 : 1 }}
          disabled={reach.running}
          onClick={reach.refresh}
        >
          {t('winlinkReach.refresh', { defaultValue: 'Refresh' })}
        </button>
        <button
          type="button"
          style={smallBtn}
          aria-expanded={showThresholds}
          onClick={() => setShowThresholds((v) => !v)}
          title={t('winlinkReach.thresholdsTitle', { defaultValue: 'Status cut-offs' })}
        >
          {t('winlinkReach.thresholds', { defaultValue: 'Cut-offs' })}
        </button>
        {reach.hour != null && (
          <span title={reach.timeShifted ? t('winlinkReach.shifted', { defaultValue: 'Display time is shifted' }) : ''}>
            {String(reach.hour).padStart(2, '0')}:00z{reach.timeShifted ? ' ⏱' : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }} title={engineLabel}>
          {t('winlinkReach.station', {
            defaultValue: '{{power}} W · {{antenna}} · SSN {{ssn}}',
            power: parseFloat(propConfig?.power) || 100,
            antenna: antennaName,
            ssn: Math.round(reach.ssnUsed ?? ssn ?? 100),
          })}
          {reach.ssnSource === 'solar-cycle' && (
            <span
              data-testid="ssn-month"
              title={t('winlinkReach.ssnMonthTitle', {
                defaultValue:
                  'Display time is in another month: predictions use that month’s smoothed sunspot number from the NOAA SWPC solar-cycle data.',
              })}
            >
              {' '}
              {t('winlinkReach.ssnMonth', { defaultValue: '(month)' })}
            </span>
          )}
        </span>
      </div>

      {/* Status cut-offs */}
      {showThresholds && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '4px',
            borderBottom: '1px solid var(--border-color)',
            fontSize: '10px',
            color: 'var(--text-muted)',
          }}
        >
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {t('winlinkReach.thGood', { defaultValue: 'Good ≥' })}
            <input
              type="number"
              min="1"
              max="99"
              value={th.goodReliability}
              onChange={(e) => setTh('goodReliability', e.target.value)}
              style={numberStyle}
            />
            %
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {t('winlinkReach.thMarginal', { defaultValue: 'Marginal ≥' })}
            <input
              type="number"
              min="0"
              max="99"
              value={th.marginalReliability}
              onChange={(e) => setTh('marginalReliability', e.target.value)}
              style={numberStyle}
            />
            %
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            {t('winlinkReach.thMargin', { defaultValue: 'or SNR margin ≥' })}
            <input
              type="number"
              min="-30"
              max="30"
              value={th.marginalSnrMargin}
              onChange={(e) => setTh('marginalSnrMargin', e.target.value)}
              style={numberStyle}
            />
            dB
          </label>
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
            title={t('winlinkReach.pactor4Title', {
              defaultValue:
                'PACTOR-4 gateways are scored at the SCS −19 dB floor when your modem supports PACTOR 4; otherwise as PACTOR 3.',
            })}
          >
            <input type="checkbox" checked={!!reach.pactor4} onChange={(e) => reach.setPactor4(e.target.checked)} />
            {t('winlinkReach.pactor4', { defaultValue: 'My modem supports PACTOR 4' })}
          </label>
          <button type="button" style={smallBtn} onClick={() => reach.setThresholds({ ...DEFAULT_THRESHOLDS })}>
            {t('winlinkReach.thReset', { defaultValue: 'Defaults' })}
          </button>
        </div>
      )}

      {/* Progress */}
      {reach.running && total > 0 && (
        <div style={{ padding: '4px' }} role="status" aria-live="polite">
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
            {t('winlinkReach.progress', {
              defaultValue: 'Predicting paths… {{done}}/{{total}}',
              done,
              total,
            })}
          </div>
          <div style={{ height: '3px', background: 'var(--bg-tertiary)', borderRadius: '2px' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.round((done / total) * 100)}%`,
                background: 'var(--accent-cyan)',
                borderRadius: '2px',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {copied && (
        <div
          style={{
            padding: '3px 6px',
            fontSize: '10px',
            color: '#22c55e',
            background: 'rgba(34,197,94,0.12)',
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
          }}
        >
          {t('winlinkReach.copied', { defaultValue: 'Copied {{url}}', url: copied })}
        </div>
      )}

      {/* Empty states */}
      {!hasDe ? (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
          {t('winlinkReach.noDe', { defaultValue: 'Set your station location to predict gateway paths.' })}
        </div>
      ) : reach.listError && !reach.gatewayCount ? (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
          {t('winlinkReach.noList', {
            defaultValue:
              'The gateway list is unavailable: this server has no Winlink API key and no Rig Bridge Winlink plugin answered.',
          })}
        </div>
      ) : !reach.listLoaded ? (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
          {t('winlinkReach.loading', { defaultValue: 'Loading the gateway list…' })}
        </div>
      ) : (
        <>
          {/* HF list */}
          <div style={headingStyle}>
            {t('winlinkReach.hfHeading', {
              defaultValue: 'HF gateways within {{range}} ({{count}})',
              range: formatDistance(reach.rangeKm, units),
              count: visibleRows.length,
            })}
          </div>
          {visibleRows.length === 0 && (
            <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>
              {reach.rows.length
                ? t('winlinkReach.noneMatch', { defaultValue: 'No gateways match this filter right now.' })
                : t('winlinkReach.noneInRange', { defaultValue: 'No HF gateways in range. Try a larger range.' })}
            </div>
          )}
          {visibleRows.map((row) => {
            const best = row.best;
            const isOpen = expanded === row.callsign;
            return (
              <div
                key={row.callsign}
                style={{ borderBottom: '1px solid var(--border-color)' }}
                data-testid={`reach-row-${row.callsign}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => select(row, row.status === 'offair' ? null : best)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select(row, row.status === 'offair' ? null : best);
                    }
                  }}
                  title={
                    canTune && row.status !== 'offair'
                      ? t('winlinkReach.rowTitleTune', { defaultValue: 'Set as DX and tune the rig' })
                      : t('winlinkReach.rowTitle', { defaultValue: 'Set as DX' })
                  }
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px', cursor: 'pointer' }}
                >
                  {renderChip(row.status)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {row.callsign}
                      </span>
                      {row.hoursUnknown && renderHoursBadge(row.hoursNote)}
                      {best && (
                        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} title={floorTitle(best)}>
                          {bandText(best)} {(best.frequency / 1e6).toFixed(3)}{' '}
                          <span style={{ color: winlinkModeColor(best.mode), fontWeight: 600 }}>{best.modeLabel}</span>
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {row.bearing}° {compass(row.bearing)} · {formatDistance(row.distanceKm, units)}
                      {row.status === 'offair' && best?.hours && (
                        <>
                          {' · '}
                          {t('winlinkReach.hours', { defaultValue: 'on the air {{hours}} UTC', hours: best.hours })}
                        </>
                      )}
                      {row.reliability != null && (
                        <>
                          {' · '}
                          {t('winlinkReach.rel', { defaultValue: '{{rel}}% rel', rel: row.reliability })}
                          {row.approx ? ' ≈' : ''}
                          {best?.aboveMuf && (
                            <span
                              data-testid="above-muf"
                              style={{ color: 'var(--accent-amber)' }}
                              title={t('winlinkReach.aboveMufTitle', {
                                defaultValue:
                                  'Above the predicted MUF ({{muf}} MHz, a monthly median): the band supports this frequency on half the days or fewer, so it is never rated Good.',
                                muf: best.muf,
                              })}
                            >
                              {' · '}
                              {t('winlinkReach.aboveMuf', { defaultValue: 'above MUF {{muf}}', muf: best.muf })}
                            </span>
                          )}
                        </>
                      )}
                      {row.snrMargin != null && (
                        <>
                          {' · '}
                          {t('winlinkReach.margin', {
                            defaultValue: 'SNR {{sign}}{{margin}} dB',
                            sign: row.snrMargin >= 0 ? '+' : '',
                            margin: row.snrMargin,
                          })}
                        </>
                      )}
                      {row.updatedAt && ` · ${utcHHMM(row.updatedAt)}`}
                    </div>
                  </div>
                  {best && row.status !== 'offair' && renderChannelActions(row.callsign, best)}
                  {row.channels.length > 1 && (
                    <button
                      type="button"
                      style={smallBtn}
                      aria-expanded={isOpen}
                      aria-label={t('winlinkReach.channels', {
                        defaultValue: '{{count}} channels',
                        count: row.channels.length,
                      })}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(isOpen ? null : row.callsign);
                      }}
                    >
                      {isOpen ? '▴' : `▾${row.channels.length}`}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div style={{ padding: '0 4px 4px 62px' }}>
                    {row.channels.map((c, i) => (
                      <div
                        key={`${c.frequency}-${c.mode}-${i}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono)',
                          padding: '1px 0',
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: STATUS_COLORS[c.status],
                            flexShrink: 0,
                          }}
                          title={statusLabel(c.status)}
                        />
                        <span style={{ width: '38px' }}>{bandText(c)}</span>
                        <span style={{ width: '58px' }}>{(c.frequency / 1e6).toFixed(3)}</span>
                        <span style={{ color: winlinkModeColor(c.mode), flex: 1 }} title={floorTitle(c)}>
                          {c.modeLabel}
                        </span>
                        <span style={{ width: '34px', textAlign: 'right' }}>
                          {c.status === 'offair' ? c.hours || '' : c.reliability != null ? `${c.reliability}%` : '—'}
                          {c.aboveMuf ? '↑' : ''}
                        </span>
                        <span style={{ width: '44px', textAlign: 'right' }}>
                          {c.snrMargin != null ? `${c.snrMargin >= 0 ? '+' : ''}${c.snrMargin}` : ''}
                        </span>
                        {c.status !== 'offair' && renderChannelActions(row.callsign, c)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {reach.truncated > 0 && (
            <div style={{ padding: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
              {t('winlinkReach.truncated', {
                defaultValue:
                  '{{count}} more gateways in range were not predicted (per-refresh cap). Reduce the range.',
                count: reach.truncated,
              })}
            </div>
          )}

          {/* VHF/UHF */}
          {visiblePacket.length > 0 && (
            <>
              <div style={{ ...headingStyle, paddingTop: '8px' }}>
                {t('winlinkReach.vhfHeading', {
                  defaultValue: 'VHF/UHF gateways nearby ({{count}})',
                  count: visiblePacket.length,
                })}
              </div>
              {visiblePacket.slice(0, 25).map((p) => {
                const ch = { ...p.channels[0], dialHz: p.channels[0].frequency };
                const target = { lat: p.gateway.lat, lon: p.gateway.lon, callsign: p.callsign };
                const offAir = p.onAir === false;
                return (
                  <div
                    key={`pk-${p.callsign}`}
                    role="button"
                    tabIndex={0}
                    data-testid={`reach-packet-${p.callsign}`}
                    onClick={() => select(target, offAir ? null : ch)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(target, offAir ? null : ch);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    {offAir ? (
                      renderChip('offair')
                    ) : (
                      <span
                        style={{
                          minWidth: '52px',
                          fontSize: '9px',
                          color: p.los === 'beyond' ? 'var(--text-muted)' : 'var(--accent-green)',
                          flexShrink: 0,
                        }}
                      >
                        {losLabel(p.los)}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {p.callsign}
                      </span>{' '}
                      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                        {(ch.frequency / 1e6).toFixed(3)}{' '}
                        <span style={{ color: winlinkModeColor(ch.mode) }}>{ch.modeLabel}</span>
                      </span>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {p.bearing}° {compass(p.bearing)} · {formatDistance(p.distanceKm, units)}
                        {offAir && ch.hours ? ` · ${ch.hours} UTC` : ''}
                      </div>
                    </div>
                    {!offAir && renderChannelActions(p.callsign, ch)}
                  </div>
                );
              })}
            </>
          )}

          <div style={{ padding: '6px 4px', fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {engineLabel && <div>{engineLabel}</div>}
            {t('winlinkReach.footnote2', {
              defaultValue:
                'Reliability is the share of days this hour the path can hold a link in the gateway’s mode (monthly median model). Good ≥ {{good}}%; Marginal ≥ {{marginal}}% or SNR margin ≥ {{margin}} dB; Off the air = outside the gateway’s published hours. ≈ marks a band-level estimate for a 60 m or out-of-band channel. VHF/UHF is by distance only. Click a gateway to set it as DX; with rig control connected it also tunes the dial frequency.',
              good: th.goodReliability,
              marginal: th.marginalReliability,
              margin: th.marginalSnrMargin,
            })}
          </div>
        </>
      )}
    </div>
  );
}
