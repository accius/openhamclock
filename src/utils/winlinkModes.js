/**
 * Winlink Mode integer → label table.
 * Derived from Pat's embedded gateway_status.json (la5nta/pat).
 * /gateway/channel/report omits SupportedModes, so we decode the integer
 * client-side. Unknown codes fall back to "Mode <n>".
 */
export const WINLINK_MODE_LABELS = {
  0: 'Packet 1200',
  1: 'Packet 2400',
  2: 'Packet 4800',
  3: 'Packet 9600',
  5: 'Packet 38400',
  12: 'Pactor 1,2',
  13: 'Pactor 1,2,3',
  14: 'Pactor 2',
  15: 'Pactor 2,3',
  16: 'Pactor 3',
  17: 'Pactor 1,2,3,4',
  18: 'Pactor 2,3,4',
  19: 'Pactor 3,4',
  22: 'WINMOR 1600',
  30: 'Robust Packet',
  41: 'ARDOP 500',
  42: 'ARDOP 1000',
  43: 'ARDOP 2000',
  50: 'VARA',
  51: 'VARA FM',
  52: 'VARA FM WIDE',
  53: 'VARA 500',
  54: 'VARA 2750',
};

export const WINLINK_MODE_FAMILIES = [
  { id: 'packet', label: 'Packet', color: '#22c55e', match: (m) => m <= 5 || m === 30 },
  { id: 'pactor', label: 'Pactor', color: '#f59e0b', match: (m) => m >= 12 && m <= 19 },
  { id: 'winmor', label: 'WINMOR', color: '#a855f7', match: (m) => m === 22 },
  { id: 'ardop', label: 'ARDOP', color: '#06b6d4', match: (m) => m >= 40 && m <= 49 },
  { id: 'vara', label: 'VARA', color: '#3b82f6', match: (m) => m >= 50 && m <= 59 },
];

export const WINLINK_MODE_UNKNOWN_COLOR = '#9ca3af';

export function winlinkModeLabel(modeInt) {
  return WINLINK_MODE_LABELS[modeInt] || `Mode ${modeInt}`;
}

export function winlinkModeFamily(modeInt) {
  return WINLINK_MODE_FAMILIES.find((f) => f.match(modeInt)) || null;
}

export function winlinkModeColor(modeInt) {
  return winlinkModeFamily(modeInt)?.color || WINLINK_MODE_UNKNOWN_COLOR;
}
