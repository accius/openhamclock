/**
 * firstVisitPlan — what to do the first time this browser opens the app.
 *
 * "First visit" means no real setup has been saved: openhamclock_config has
 * no layout in it. The key alone is not a usable signal, because the theme
 * module (src/theme/useTheme.js) stores `{ theme, customTheme }` under the
 * same key as soon as the Settings panel mounts — before App's first-visit
 * check runs — so testing for the key made every visit look like a return
 * visit (Settings stopped auto-opening, phones and tablets stopped getting
 * their layout).
 *
 * The visitor gets at most ONE prompt:
 *   - Station not configured (N0CALL): Settings opens, and a touch device
 *     gets a layout picked for it — a phone the Mobile layout, a small
 *     tablet Compact, a tablet Tablet. No separate Mobile offer: the layout
 *     is already chosen and can be changed in that same Settings dialog.
 *   - Station already configured (callsign from the server's .env): no
 *     Settings; a phone-sized screen gets the one-time Mobile offer instead.
 */
import { hasSavedLayout, isPhoneViewport, MOBILE_LAYOUT_ID } from './mobileLayout.js';

export function firstVisitPlan({
  savedConfigRaw = null,
  callsign = 'N0CALL',
  layout = null,
  width = 0,
  height = 0,
  isTouch = false,
  alreadySuggested = false,
} = {}) {
  const plan = { firstVisit: false, openSettings: false, layout: null, suggestMobile: false, markSuggested: false };
  if (hasSavedLayout(savedConfigRaw)) return plan;
  plan.firstVisit = true;
  const phone = isPhoneViewport(width, height);

  if (!callsign || callsign === 'N0CALL') {
    plan.openSettings = true;
    if (isTouch && phone) plan.layout = MOBILE_LAYOUT_ID;
    else if (isTouch && width <= 768) plan.layout = 'compact';
    else if (isTouch && width > 768 && width <= 1200) plan.layout = 'tablet';
    // Settings is this visit's prompt; never stack the Mobile offer on it
    if (phone) plan.markSuggested = true;
    return plan;
  }

  if (phone && !alreadySuggested && layout !== MOBILE_LAYOUT_ID) {
    plan.suggestMobile = true;
  }
  return plan;
}
