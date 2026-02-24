export function DXLocalTime({ currentTime, dxLocation, isLocal, onToggle, marginTop = '2px' }) {
  const lon = dxLocation?.lon;
  if (lon == null) return null;

  const lonNum = Number(lon);
  if (!Number.isFinite(lonNum)) return null;

  const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
  if (Number.isNaN(now.getTime())) return null;

  // Approximate solar local time from longitude; not an IANA civil timezone conversion.
  const utcOffsetH = Math.round(lonNum / 15);
  const localDxDate = new Date(now.getTime() + utcOffsetH * 3600000);
  const utcHh = String(now.getUTCHours()).padStart(2, '0');
  const utcMm = String(now.getUTCMinutes()).padStart(2, '0');
  const localHh = String(localDxDate.getUTCHours()).padStart(2, '0');
  const localMm = String(localDxDate.getUTCMinutes()).padStart(2, '0');
  const sign = utcOffsetH >= 0 ? '+' : '';

  return (
    <div style={{ color: 'var(--accent-cyan)', fontSize: '13px', marginTop }}>
      {isLocal ? `${localHh}:${localMm}` : `${utcHh}:${utcMm}`}{' '}
      <span
        onClick={onToggle}
        title={
          isLocal
            ? 'Show UTC time. Local time shown here is approximate solar time from longitude, not civil timezone.'
            : `Show approximate solar local time at DX destination (UTC${sign}${utcOffsetH}), not civil timezone.`
        }
        style={{ color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', userSelect: 'none' }}
      >
        ({isLocal ? `Local UTC${sign}${utcOffsetH}` : 'UTC'}) ⇄
      </span>
    </div>
  );
}

export default DXLocalTime;
