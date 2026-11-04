#!/usr/bin/env node
/**
 * Generate src/assets/geodata/cities.json — a compact list of the world's larger
 * cities for the map's "nearest city" cursor readout.
 *
 * Source: GeoNames cities15000 dump (CC BY 4.0, https://www.geonames.org/)
 *   curl -O https://download.geonames.org/export/dump/cities15000.zip
 *   unzip cities15000.zip
 *   node scripts/generate-cities.mjs cities15000.txt
 *
 * Output rows: [name, lat, lon, population, countryCode] — ~2,000 cities
 * with population > 300,000, lat/lon rounded to 0.01° (≈1 km), well under
 * the 150 KB budget for a bundled asset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_POPULATION = 300_000;
const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/generate-cities.mjs <cities15000.txt>');
  process.exit(1);
}

const rows = fs
  .readFileSync(src, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
  // GeoNames columns: 1 name, 4 lat, 5 lon, 8 country code, 14 population
  .map((c) => [c[1], Number(c[4]), Number(c[5]), Number(c[14] || 0), c[8]])
  .filter(([, lat, lon, pop]) => pop > MIN_POPULATION && Number.isFinite(lat) && Number.isFinite(lon))
  .sort((a, b) => b[3] - a[3])
  .map(([name, lat, lon, pop, cc]) => [name, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100, pop, cc]);

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'data', 'cities.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} cities → ${out} (${fs.statSync(out).size} bytes)`);
