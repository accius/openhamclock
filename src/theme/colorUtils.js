export function rgbaStringToObject(str) {
  if (!str) return { r: 0, g: 0, b: 0, a: 1 };

  const match = str.match(/rgba?\(([^)]+)\)/);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };

  const parts = match[1].split(',').map((p) => p.trim());

  return {
    r: parseInt(parts[0], 10),
    g: parseInt(parts[1], 10),
    b: parseInt(parts[2], 10),
    a: parts[3] !== undefined ? parseFloat(parts[3]) : 1,
  };
}

export function rgbaObjectToString({ r, g, b, a }) {
  /* in case we get a malformed object, adjust it to be valid */
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  a = Math.max(0, Math.min(1, a ?? 1));

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
