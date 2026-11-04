/**
 * OfflineTilesBadge — a small, quiet "offline tiles" tag on the map while
 * the service worker is drawing the basemap from an offline area pack
 * (network down, browser offline, or the tile server not answering).
 *
 * The worker posts { type: 'OHC_OFFLINE_PACK_TILE' } at most every few
 * seconds while it serves pack tiles; the badge stays up for a short while
 * after the last notice and then fades away once tiles come live again.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAsOf } from '../utils/offlinePackManifest.js';

const VISIBLE_MS = 20000;

export default function OfflineTilesBadge() {
  const { t } = useTranslation();
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
    if (!sw?.addEventListener) return undefined;
    const onMessage = (e) => {
      if (e?.data?.type === 'OHC_OFFLINE_PACK_TILE') {
        setLastAt(Date.now());
        setNow(Date.now());
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, []);

  const visible = lastAt > 0 && now - lastAt < VISIBLE_MS;

  // Tick only while visible, to hide the badge once tiles are live again.
  useEffect(() => {
    if (!visible) return undefined;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      role="status"
      title={t('offlinePacks.badge.title', {
        defaultValue: 'The basemap is being drawn from an offline area pack you downloaded (last tile {{time}}).',
        time: formatAsOf(lastAt),
      })}
      style={{
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'auto',
        padding: '2px 8px',
        borderRadius: '10px',
        background: 'rgba(0, 0, 0, 0.7)',
        border: '1px solid var(--accent-amber, #fbbf24)',
        color: 'var(--accent-amber, #fbbf24)',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        letterSpacing: '0.5px',
        opacity: 0.85,
      }}
    >
      {t('offlinePacks.badge.label', { defaultValue: 'OFFLINE TILES' })}
    </div>
  );
}
