/**
 * Time Shift "layer" — toggles the floating display-time scrubber.
 *
 * The scrubber itself is a React overlay (components/TimeShiftControl.jsx)
 * that WorldMap mounts over whichever projection is active, so this plugin
 * draws nothing on Leaflet; it exists so the control has a place in the
 * layer list, the command palette, and the keyboard-shortcut table like any
 * other map feature. The offset lives in utils/displayTime.js.
 */
export const metadata = {
  id: 'time-shift',
  name: 'Time Shift',
  description: 'Shift the displayed time (terminator, sun/moon, satellites, VOACAP) up to ±30 days',
  icon: '⏱️',
  category: 'utility',
  defaultEnabled: false,
  defaultOpacity: 1,
  version: '1.0.0',
};

export function useLayer() {
  return { layers: [] };
}
