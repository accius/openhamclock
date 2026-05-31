/**
 * Standard ARIA tablist keyboard handler (W3C APG Tabs pattern).
 * Pass to onKeyDown on the role="tablist" container.
 *
 * @param {KeyboardEvent} e
 * @param {string[]} tabs - ordered list of tab ids
 * @param {string} activeTab
 * @param {(id: string) => void} setActiveTab
 * @param {React.RefObject<Record<string, HTMLElement>>} tabRefs - map of id → button element
 */
export function ariaTabKeyDown(e, tabs, activeTab, setActiveTab, tabRefs) {
  let next = null;
  const idx = tabs.indexOf(activeTab);
  if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
  else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
  else if (e.key === 'Home') next = tabs[0];
  else if (e.key === 'End') next = tabs[tabs.length - 1];
  if (next) {
    e.preventDefault();
    setActiveTab(next);
    tabRefs.current?.[next]?.focus();
  }
}
