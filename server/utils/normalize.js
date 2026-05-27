/**
 * Recursively normalize all values in the JSON tree, converting numeric strings to numbers.
 *
 * @param {*} node
 * @returns {*}
 */
const normalizeJsonTree = (node) => {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = normalizeJsonTree(node[i]);
    }
    return node;
  }

  if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      node[key] = normalizeJsonTree(node[key]);
    }
    return node;
  }

  return normalizeNumber(node);
};

/**
 * Normalize numeric strings, especially those in scientific notation or with leading dots.
 *
 * @param {*} value
 * @returns {*}
 */
const normalizeNumber = (value) => {
  if (typeof value !== 'string') return value;

  const v = value.trim();

  // Leading-dot float: ".001206" → "0.001206"
  if (/^[+-]?\.\d+$/.test(v)) {
    return Number('0' + v);
  }

  // Scientific notation with digits: "1.23E-4"
  if (/^[+-]?\d*\.?\d+e[+-]?\d+$/i.test(v)) {
    return Number(v);
  }

  // Scientific notation with leading dot: "-.5E-6"
  if (/^[+-]?\.\d+e[+-]?\d+$/i.test(v)) {
    return Number('0' + v);
  }

  // Plain integer or float
  if (/^[+-]?\d+(\.\d+)?$/.test(v)) {
    return Number(v);
  }

  return value;
};

module.exports = {
  normalizeJsonTree,
  normalizeNumber,
};
