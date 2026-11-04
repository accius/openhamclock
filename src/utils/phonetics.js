/**
 * ITU phonetic alphabet — spell callsigns for spoken alerts.
 *
 * Letters use the ITU/NATO words, digits are spoken as plain words (the ITU
 * radiotelephony digits "niner"/"fife" are aviation-style; hams on the air
 * say "nine", so we do too), "/" becomes "stroke" and "-" (APRS SSIDs)
 * becomes "dash". Anything else is dropped.
 */

export const ITU_LETTERS = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
};

export const DIGIT_WORDS = {
  0: 'Zero',
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
};

/**
 * Spell a callsign (or any token) phonetically.
 * @param {string} text  e.g. 'VK9MA', 'PJ2/W9WI', 'N0CALL-9'
 * @returns {string}     e.g. 'Victor Kilo Nine Mike Alfa'
 */
export function spellPhonetic(text) {
  if (text == null) return '';
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    if (ITU_LETTERS[ch]) out.push(ITU_LETTERS[ch]);
    else if (DIGIT_WORDS[ch]) out.push(DIGIT_WORDS[ch]);
    else if (ch === '/') out.push('stroke');
    else if (ch === '-') out.push('dash');
    // whitespace / punctuation: skip
  }
  return out.join(' ');
}

/**
 * Speak a callsign either phonetically or as spaced characters (so the
 * synthesizer does not try to pronounce "VK9MA" as a word).
 */
export function speakableCallsign(call, { phonetic = true } = {}) {
  if (!call) return '';
  if (phonetic) return spellPhonetic(call);
  return String(call)
    .toUpperCase()
    .replace(/\//g, ' stroke ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => (tok === 'stroke' ? tok : tok.split('').join(' ')))
    .join(' ');
}

export default { ITU_LETTERS, DIGIT_WORDS, spellPhonetic, speakableCallsign };
