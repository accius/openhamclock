/**
 * Country Flags Utility
 * Maps DXCC entity names to emoji flags + ISO image rendering
 * Based on ARRL DXCC List
 */

/**
 * Extract ISO 3166-1 alpha-2 code from a flag emoji.
 * Flag emojis are pairs of Regional Indicator Symbols:
 *   🇺 = U+1F1FA (letter U), 🇸 = U+1F1F8 (letter S) → "us"
 */
export const emojiToIso2 = (emoji) => {
  if (!emoji) return null;
  const codePoints = [...emoji].map((c) => c.codePointAt(0));
  // Regional indicator symbols live at U+1F1E6 (A) through U+1F1FF (Z)
  const letters = codePoints
    .filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff)
    .map((cp) => String.fromCharCode(cp - 0x1f1e6 + 65));
  if (letters.length === 2) return letters.join('').toLowerCase();
  return null;
};

/**
 * Get a flag image URL for a DXCC entity name.
 * Uses flagcdn.com (free, no API key, SVG flags).
 * Returns null if entity not found.
 */
export const getFlagUrl = (entityName, size = 'w40') => {
  const emoji = getFlagForEntity(entityName);
  const iso = emojiToIso2(emoji);
  if (!iso) return null;
  return `https://flagcdn.com/${size}/${iso}.png`;
};

export const getFlagForEntity = (entityName) => {
  if (!entityName) return null;

  const flagMap = {
    // North America
    'United States': '🇺🇸',
    Canada: '🇨🇦',
    Mexico: '🇲🇽',
    Alaska: '🇺🇸',
    Hawaii: '🇺🇸',
    'Puerto Rico': '🇵🇷',
    'US Virgin Is.': '🇻🇮',
    Bermuda: '🇧🇲',
    Bahamas: '🇧🇸',
    Jamaica: '🇯🇲',
    Barbados: '🇧🇧',
    'Trinidad & Tobago': '🇹🇹',
    Belize: '🇧🇿',
    Guatemala: '🇬🇹',
    'El Salvador': '🇸🇻',
    Honduras: '🇭🇳',
    Nicaragua: '🇳🇮',
    'Costa Rica': '🇨🇷',
    Panama: '🇵🇦',
    Cuba: '🇨🇺',
    Haiti: '🇭🇹',
    'Dominican Republic': '🇩🇴',
    'St. Lucia': '🇱🇨',
    Dominica: '🇩🇲',
    'Antigua & Barbuda': '🇦🇬',
    Grenada: '🇬🇩',
    'St. Vincent': '🇻🇨',
    'St. Kitts & Nevis': '🇰🇳',
    'Cayman Is.': '🇰🇾',
    'Turks & Caicos Is.': '🇹🇨',
    Aruba: '🇦🇼',
    Curacao: '🇨🇼',
    'Bonaire, Curacao, Neth. Antilles': '🇧🇶', // often just Bonaire in modern logs
    Bonaire: '🇧🇶',
    'Sint Maarten': '🇸🇽',
    'St. Martin': '🇲🇫',
    Guadeloupe: '🇬🇵',
    Martinique: '🇲🇶',
    'St. Barthelemy': '🇧🇱',
    'St. Pierre & Miquelon': '🇵🇲',
    Greenland: '🇬🇱',
    'Clipperton Is.': '🇨🇵',
    Revillagigedo: '🇲🇽', // Part of Mexico

    // South America
    Brazil: '🇧🇷',
    Argentina: '🇦🇷',
    Chile: '🇨🇱',
    Uruguay: '🇺🇾',
    Paraguay: '🇵🇾',
    Peru: '🇵🇪',
    Colombia: '🇨🇴',
    Venezuela: '🇻🇪',
    Ecuador: '🇪🇨',
    Bolivia: '🇧🇴',
    Guyana: '🇬🇾',
    Suriname: '🇸🇷',
    'French Guiana': '🇬🇫',
    'Falkland Is.': '🇫🇰',
    'South Georgia': '🇬🇸',
    'South Shetland Is.': '🇦🇶', // Antarctica treaty, but often assoc with claiming nations. Using generic Antarctica flag usually better or specific claim.
    'South Orkney Is.': '🇦🇶',
    'South Sandwich Is.': '🇬🇸',
    'Peter I Is.': '🇦🇶',
    'Bouvet Is.': '🇧🇻',
    'Easter Is.': '🇨🇱',
    'San Felix & San Ambrosio': '🇨🇱',
    'Juan Fernandez Is.': '🇨🇱',
    'Galapagos Is.': '🇪🇨',
    'Fernando de Noronha': '🇧🇷',
    'St. Peter & St. Paul Rocks': '🇧🇷',
    'Trindade & Martim Vaz Is.': '🇧🇷',

    // Europe
    'United Kingdom': '🇬🇧',
    England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    Scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    Wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    'Northern Ireland': '🇬🇧',
    Ireland: '🇮🇪',
    Guernsey: '🇬🇬',
    Jersey: '🇯🇪',
    'Isle of Man': '🇮🇲',
    France: '🇫🇷',
    Germany: '🇩🇪',
    Italy: '🇮🇹',
    Spain: '🇪🇸',
    Portugal: '🇵🇹',
    Netherlands: '🇳🇱',
    Belgium: '🇧🇪',
    Luxembourg: '🇱🇺',
    Switzerland: '🇨🇭',
    Liechtenstein: '🇱🇮',
    Austria: '🇦🇹',
    Sweden: '🇸🇪',
    Norway: '🇳🇴',
    Denmark: '🇩🇰',
    Finland: '🇫🇮',
    Iceland: '🇮🇸',
    Poland: '🇵🇱',
    'Czech Republic': '🇨🇿',
    Slovakia: '🇸🇰',
    Hungary: '🇭🇺',
    Romania: '🇷🇴',
    Bulgaria: '🇧🇬',
    Greece: '🇬🇷',
    Cyprus: '🇨🇾',
    Malta: '🇲🇹',
    Russia: '🇷🇺',
    'European Russia': '🇷🇺',
    Kaliningrad: '🇷🇺',
    Ukraine: '🇺🇦',
    Belarus: '🇧🇾',
    Estonia: '🇪🇪',
    Latvia: '🇱🇻',
    Lithuania: '🇱🇹',
    Moldova: '🇲🇩',
    'Vatican City': '🇻🇦',
    Monaco: '🇲🇨',
    'San Marino': '🇸🇲',
    Andorra: '🇦🇩',
    Gibraltar: '🇬🇮',
    'Balearic Is.': '🇪🇸',
    'Canary Is.': '🇮🇨', // Or ES-CN
    'Ceuta & Melilla': '🇪🇸',
    Azores: '🇵🇹',
    'Madeira Is.': '🇵🇹',
    'Faroe Is.': '🇫🇴',
    'Aland Is.': '🇦🇽',
    Svalbard: '🇸🇯',
    'Jan Mayen': '🇸🇯', // Or NO
    Albania: '🇦🇱',
    'Bosnia-Herzegovina': '🇧🇦',
    Croatia: '🇭🇷',
    Macedonia: '🇲🇰',
    'North Macedonia': '🇲🇰',
    Montenegro: '🇲🇪',
    Serbia: '🇷🇸',
    Slovenia: '🇸🇮',
    Turkey: '🇹🇷',
    Corsica: '🇫🇷',
    Sardinia: '🇮🇹',
    Sicily: '🇮🇹',
    Dodecanese: '🇬🇷',
    Crete: '🇬🇷',
    'Mount Athos': '🇬🇷',
    'Sovereign Military Order of Malta': '🇲🇹', // Often treated specially, but using Malta flag or standard flag

    // Asia
    Japan: '🇯🇵',
    'South Korea': '🇰🇷',
    'North Korea': '🇰🇵',
    China: '🇨🇳',
    Taiwan: '🇹🇼',
    'Hong Kong': '🇭🇰',
    Macau: '🇲🇴',
    Mongolia: '🇲🇳',
    India: '🇮🇳',
    Thailand: '🇹🇭',
    Vietnam: '🇻🇳',
    Laos: '🇱🇦',
    Cambodia: '🇰🇭',
    Myanmar: '🇲🇲',
    Malaysia: '🇲🇾',
    'West Malaysia': '🇲🇾',
    'East Malaysia': '🇲🇾',
    Singapore: '🇸🇬',
    Philippines: '🇵🇭',
    Indonesia: '🇮🇩',
    'Brunei Darussalam': '🇧🇳',
    'Timor-Leste': '🇹🇱',
    Pakistan: '🇵🇰',
    Bangladesh: '🇧🇩',
    'Sri Lanka': '🇱🇰',
    Maldives: '🇲🇻',
    Nepal: '🇳🇵',
    Bhutan: '🇧🇹',
    Afghanistan: '🇦🇫',
    Kazakhstan: '🇰🇿',
    Kyrgyzstan: '🇰🇬',
    Tajikistan: '🇹🇯',
    Turkmenistan: '🇹🇲',
    Uzbekistan: '🇺🇿',
    Israel: '🇮🇱',
    Jordan: '🇯🇴',
    Lebanon: '🇱🇧',
    Syria: '🇸🇾',
    Iraq: '🇮🇶',
    'Saudi Arabia': '🇸🇦',
    Yemen: '🇾🇪',
    Oman: '🇴🇲',
    UAE: '🇦🇪',
    'United Arab Emirates': '🇦🇪',
    Qatar: '🇶🇦',
    Bahrain: '🇧🇭',
    Kuwait: '🇰🇼',
    Iran: '🇮🇷',
    Armenia: '🇦🇲',
    Azerbaijan: '🇦🇿',
    Georgia: '🇬🇪',

    // Africa
    Egypt: '🇪🇬',
    Libya: '🇱🇾',
    Tunisia: '🇹🇳',
    Algeria: '🇩🇿',
    Morocco: '🇲🇦',
    'Western Sahara': '🇪🇭',
    Mauritania: '🇲🇷',
    Senegal: '🇸🇳',
    Gambia: '🇬🇲',
    'Guinea-Bissau': '🇬🇼',
    Guinea: '🇬🇳',
    'Sierra Leone': '🇸🇱',
    Liberia: '🇱🇷',
    'Ivory Coast': '🇨🇮',
    "Cote d'Ivoire": '🇨🇮',
    'Burkina Faso': '🇧🇫',
    Ghana: '🇬🇭',
    Togo: '🇹🇬',
    Benin: '🇧🇯',
    Nigeria: '🇳🇬',
    Cameroon: '🇨🇲',
    'Central Africa': '🇨🇫',
    Gabon: '🇬🇦',
    'Congo (Republic of)': '🇨🇬',
    'Congo (Dem. Rep.)': '🇨🇩',
    'Equatorial Guinea': '🇬🇶',
    'Sao Tome & Principe': '🇸🇹',
    Angola: '🇦🇴',
    Namibia: '🇳🇦',
    'South Africa': '🇿🇦',
    Lesotho: '🇱🇸',
    Eswatini: '🇸🇿',
    Swaziland: '🇸🇿',
    Mozambique: '🇲🇿',
    Madagascar: '🇲🇬',
    Zimbabwe: '🇿🇼',
    Zambia: '🇿🇲',
    Malawi: '🇲🇼',
    Tanzania: '🇹🇿',
    Kenya: '🇰🇪',
    Uganda: '🇺🇬',
    Rwanda: '🇷🇼',
    Burundi: '🇧🇮',
    Ethiopia: '🇪🇹',
    Somalia: '🇸🇴',
    Djibouti: '🇩🇯',
    Eritrea: '🇪🇷',
    Sudan: '🇸🇩',
    'South Sudan': '🇸🇸',
    Chad: '🇹🇩',
    Niger: '🇳🇪',
    Mali: '🇲🇱',
    'Cape Verde': '🇨🇻',
    Madeira: '🇵🇹', // Listed closer to Europe usually
    'Ascension Is.': '🇦🇨',
    'St. Helena': '🇸🇭',
    'Tristan da Cunha': '🇹🇦',
    Mauritius: '🇲🇺',
    'Reunion Is.': '🇷🇪',
    Seychelles: '🇸🇨',
    Comoros: '🇰🇲',
    Mayotte: '🇾🇹',
    'Rodrigues Is.': '🇲🇺', // Mauritius flag usually
    'Agalega & St. Brandon': '🇲🇺', // Mauritius flag usually

    // Oceania
    Australia: '🇦🇺',
    'New Zealand': '🇳🇿',
    'Papua New Guinea': '🇵🇬',
    Fiji: '🇫🇯',
    Vanuatu: '🇻🇺',
    'Solomon Is.': '🇸🇧',
    'New Caledonia': '🇳🇨',
    'Wallis & Futuna': '🇼🇫',
    Samoa: '🇼🇸',
    'American Samoa': '🇦🇸',
    Tonga: '🇹🇴',
    'Cook Is.': '🇨🇰',
    Niue: '🇳🇺',
    Tokelau: '🇹🇰',
    'Pitcairn Is.': '🇵🇳',
    'French Polynesia': '🇵🇫',
    'Marquesas Is.': '🇵🇫',
    'Austral Is.': '🇵🇫',
    'Tuamotu Archipelago': '🇵🇫', // Using French Polynesia flag generally
    'Gambier Is.': '🇵🇫', // Using French Polynesia flag generally
    Kiribati: '🇰🇮',
    Tuvalu: '🇹🇻',
    Nauru: '🇳🇷',
    'Marshall Is.': '🇲🇭',
    Micronesia: '🇫🇲',
    Palau: '🇵🇼',
    Guam: '🇬🇺',
    'Northern Mariana Is.': '🇲🇵',
    'Wake Is.': '🇺🇸', // US Territory
    'Johnston Is.': '🇺🇸',
    'Midway Is.': '🇺🇸',
    'Palmyra & Jarvis Is.': '🇺🇸',
    'Howland & Baker Is.': '🇺🇸',
    'Kingman Reef': '🇺🇸',
    'Kure Is.': '🇺🇸', // Often part of Hawaii/USA

    // Antarctica
    Antarctica: '🇦🇶',

    // Others / Special
    'United Nations HQ': '🇺🇳',
  };

  if (!entityName) return null;

  // Direct match
  if (flagMap[entityName]) return flagMap[entityName];

  // Try some normalize / fuzzy matching
  // 1. Check if "Republic of X" -> "X"
  const simplified = entityName
    .replace(/Republic of /i, '')
    .replace(/The /i, '')
    .trim();
  if (flagMap[simplified]) return flagMap[simplified];

  // 2. Check for "Islands" vs "Is."
  const islands = entityName.replace(/Islands/g, 'Is.').trim();
  if (flagMap[islands]) return flagMap[islands];

  return null;
};
