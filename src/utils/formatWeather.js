// returns formatted Fahrenheit temperature based on celsius argument e.g. "72°F"
export function formatFahrenheit(rawCelsius) {
  return `${Math.round((rawCelsius * 9) / 5 + 32)}°F`;
}

// returns formatted Celsius temperature based on celsius argument e.g. "22°C"
export function formatCelsius(rawCelsius) {
  return `${Math.round(rawCelsius)}°C`;
}

// returns formatted temperature in both Celsius and Fahrenheit based on celsius argument e.g. "22°C / 72°F"
export function formatTemperatureBoth(rawCelsius) {
  return `${formatCelsius(rawCelsius)} / ${formatFahrenheit(rawCelsius)}`;
}

// Returns formatted temperature based on allUnits.temp, e.g. "22°C" or "72°F"
export function formatTemperature(rawCelsius, allUnits) {
  if (allUnits?.temp === 'metric') {
    return formatCelsius(rawCelsius);
  }
  return formatFahrenheit(rawCelsius);
}
