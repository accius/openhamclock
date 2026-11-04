/**
 * useDisplayBrightness — Settings → Display → Brightness.
 *
 * Three layers, strongest available wins:
 *   1. Rig Bridge `brightness` plugin with a writable backlight: the bridge
 *      dims the panel itself (and the display-schedule sleep turns it off via
 *      POST /api/brightness { power:false }). No overlay needed.
 *   2. Rig Bridge plugin without hardware (light sensor only): it publishes
 *      the level it computed; we dim with a translucent black overlay.
 *   3. No bridge: the manual slider (0–100 %) drives the overlay directly.
 *
 * The Settings slider sends `ohc-brightness-preview` events for live feedback
 * before Save; Save persists config.displayBrightness = { manual, auto }.
 *
 * @returns {{ overlayOpacity: number, effective: number, bridge: object|null, hardware: boolean }}
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBridgeEvent } from '../useBridgeEvent.js';
import { buildRigUrl } from '../../contexts/RigContext.jsx';
import { isRelayConfigured } from '../../utils/relaySession.js';

export const BRIGHTNESS_PREVIEW_EVENT = 'ohc-brightness-preview';
const BRIDGE_STALE_MS = 90000;
const MAX_OVERLAY = 0.95; // never fully black — the user must be able to find the slider again

const clampPct = (v, d = 100) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : d);

export default function useDisplayBrightness(config, displaySleeping) {
  const { data: bridge, stale } = useBridgeEvent('brightness', { staleMs: BRIDGE_STALE_MS });
  const bridgeLive = !!bridge && !stale;
  const hardware = bridgeLive && !!bridge.hardware;

  const settings = config?.displayBrightness || {};
  const manual = clampPct(parseFloat(settings.manual), 100);
  const auto = settings.auto === true;
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const onPreview = (e) => setPreview(e?.detail?.manual ?? null);
    window.addEventListener(BRIGHTNESS_PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(BRIGHTNESS_PREVIEW_EVENT, onPreview);
  }, []);
  // A saved value ends the preview
  useEffect(() => setPreview(null), [manual, auto]);

  const rigConfig = config?.rigControl;
  const canTalk = !!rigConfig?.enabled && !isRelayConfigured();
  const rigUrl = buildRigUrl(rigConfig);
  const apiToken = rigConfig?.apiToken?.trim() || '';

  const post = useRef(null);
  post.current = async (body) => {
    if (!canTalk || !bridgeLive) return;
    try {
      await fetch(`${rigUrl}/api/brightness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-RigBridge-Token': apiToken } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      /* bridge away — overlay still works */
    }
  };

  // Push the saved manual/auto choice to the bridge whenever it changes
  const lastPushedRef = useRef('');
  useEffect(() => {
    if (!bridgeLive) return;
    const key = `${auto}|${manual}`;
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    post.current(auto ? { auto: true } : { brightness: manual, auto: false });
  }, [auto, manual, bridgeLive]);

  // Display schedule → backlight power
  const prevSleepRef = useRef(null);
  useEffect(() => {
    if (!bridgeLive) return;
    if (prevSleepRef.current === displaySleeping) return;
    prevSleepRef.current = displaySleeping;
    post.current({ power: !displaySleeping });
  }, [displaySleeping, bridgeLive]);

  const effective = useMemo(() => {
    if (preview != null) return clampPct(parseFloat(preview), manual);
    if (bridgeLive && Number.isFinite(bridge.brightness)) return clampPct(bridge.brightness, manual);
    return manual;
  }, [preview, bridgeLive, bridge, manual]);

  // Hardware dims the panel; dim with the overlay only when it cannot
  const overlayOpacity = hardware && preview == null ? 0 : Math.min(MAX_OVERLAY, (100 - effective) / 100);

  return { overlayOpacity, effective, bridge: bridgeLive ? bridge : null, hardware };
}
