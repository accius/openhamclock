'use strict';
/**
 * NWS / USCG HF radiofax (WEFAX) chart catalogue.
 *
 * Every chart broadcast by the five US radiofax stations is also published
 * as a GIF at https://tgftp.nws.noaa.gov/fax/<ID>.gif. IDs and titles come
 * from the NWS "Worldwide Marine Radiofacsimile Broadcast Schedules"
 * (https://www.weather.gov/media/marine/rfax.pdf, per-station rfax*.txt
 * files). "Latest" entries are the most-current issuance of a product;
 * timed entries carry the synoptic hour / valid time in the title.
 *
 * Frequencies are the assigned (carrier) frequencies in kHz. Tune a USB
 * receiver 1.9 kHz below the carrier to decode (`usbDialKHz`).
 */

const STATIONS = [
  {
    id: 'NMF',
    name: 'Boston',
    label: 'Boston, MA — USCG NMF',
    region: 'North Atlantic',
    frequenciesKHz: [4235, 6340.5, 9110, 12750],
    scheduleUrl: 'https://tgftp.nws.noaa.gov/fax/rfaxatl.txt',
    charts: [
      { id: 'PYAA11', group: 'Surface', title: 'Surface analysis, Part 1 (10E–45W) — latest' },
      { id: 'PYAA12', group: 'Surface', title: 'Surface analysis, Part 2 (40W–95W) — latest' },
      { id: 'PYAD10', group: 'Surface', title: 'Preliminary surface analysis (45W–85W) — latest' },
      { id: 'PPAE10', group: 'Surface', title: '24 h surface forecast (40W–98W) — latest' },
      { id: 'QDTM10', group: 'Surface', title: '48 h surface forecast (10E–95W) — latest' },
      { id: 'PWAM99', group: 'Surface', title: '96 h surface forecast VT12Z (10E–95W)' },
      { id: 'PJAA99', group: 'Wind / seas', title: '12Z sea state analysis (10E–95W)' },
      { id: 'PWAA90', group: 'Wind / seas', title: 'Wind/wave analysis (40W–98W) — latest' },
      { id: 'PWAE10', group: 'Wind / seas', title: '24 h wind/wave forecast (40W–98W) — latest' },
      { id: 'PJAI10', group: 'Wind / seas', title: '48 h wind/wave forecast (10E–95W) — latest' },
      { id: 'PJAI20', group: 'Wind / seas', title: '48 h wave period forecast (10E–95W) — latest' },
      { id: 'PJAM98', group: 'Wind / seas', title: '96 h wind/wave forecast VT12Z (10E–95W)' },
      { id: 'PJAM88', group: 'Wind / seas', title: '96 h wave period forecast VT12Z (10E–95W)' },
      { id: 'PPAA10', group: 'Upper air', title: '500 mb analysis (10E–95W) — latest' },
      { id: 'PPAE11', group: 'Upper air', title: '24 h 500 mb forecast — latest' },
      { id: 'PPAG11', group: 'Upper air', title: '36 h 500 mb forecast — latest' },
      { id: 'PPAI10', group: 'Upper air', title: '48 h 500 mb forecast — latest' },
      { id: 'PPAM50', group: 'Upper air', title: '96 h 500 mb forecast VT12Z' },
      { id: 'PWEK11', group: 'Tropical', title: 'Tropical cyclone danger area / high wind-wave warning — latest' },
      { id: 'PIEA88', group: 'Ice', title: 'International Ice Patrol ice chart (Feb–Sep)' },
      { id: 'PLAZ01', group: 'Schedule', title: 'Radiofax schedule, part 1' },
      { id: 'PLAZ02', group: 'Schedule', title: 'Radiofax schedule, part 2' },
    ],
  },
  {
    id: 'NMG',
    name: 'New Orleans',
    label: 'New Orleans, LA — USCG NMG',
    region: 'Gulf, Caribbean, Tropical Atlantic',
    frequenciesKHz: [4317.9, 8503.9, 12789.9, 17146.4],
    scheduleUrl: 'https://tgftp.nws.noaa.gov/fax/rfaxmex.txt',
    charts: [
      { id: 'PYEA11', group: 'Surface', title: 'Tropical surface analysis, E half (0W–70W) — latest' },
      { id: 'PYEB11', group: 'Surface', title: 'US / tropical surface analysis, W half (55W–125W) — latest' },
      { id: 'PYEE10', group: 'Surface', title: '24 h tropical surface forecast — latest' },
      { id: 'PYEI10', group: 'Surface', title: '48 h tropical surface forecast — latest' },
      { id: 'PYEK10', group: 'Surface', title: '72 h tropical surface forecast — latest' },
      { id: 'PJEA11', group: 'Wind / seas', title: 'Sea state analysis (0N–31N, 35W–100W) — latest' },
      { id: 'PWEE11', group: 'Wind / seas', title: '24 h wind/wave forecast — latest' },
      { id: 'PWED98', group: 'Wind / seas', title: '36 h wind/wave forecast VT12' },
      { id: 'PWEI11', group: 'Wind / seas', title: '48 h wind/wave forecast — latest' },
      { id: 'PJEI11', group: 'Wind / seas', title: '48 h wave period / swell direction — latest' },
      { id: 'PJEK11', group: 'Wind / seas', title: '72 h wind/wave forecast — latest' },
      { id: 'PKEK88', group: 'Wind / seas', title: '72 h wave period / swell direction VT00' },
      { id: 'PWEK11', group: 'Tropical', title: 'Tropical cyclone danger area / high wind-wave warning — latest' },
      { id: 'PLEA10', group: 'Text', title: 'High seas forecast (7N–31N, 35W–98W) — latest' },
      { id: 'PLEZ01', group: 'Schedule', title: 'Radiofax schedule' },
    ],
  },
  {
    id: 'NMC',
    name: 'Pt. Reyes',
    label: 'Point Reyes, CA — USCG NMC',
    region: 'North and Tropical East Pacific',
    frequenciesKHz: [4346, 8682, 12786, 17151.2, 22527],
    scheduleUrl: 'https://tgftp.nws.noaa.gov/fax/rfaxpac.txt',
    charts: [
      { id: 'PYBA90', group: 'Surface', title: 'Surface analysis, Part 1 NE Pacific (115W–175W) — latest' },
      { id: 'PYBA91', group: 'Surface', title: 'Surface analysis, Part 2 NW Pacific (175W–135E) — latest' },
      { id: 'PPBE10', group: 'Surface', title: '24 h surface forecast (18N–62N, E of 157W) — latest' },
      { id: 'PWBI10', group: 'Surface', title: '48 h surface forecast (20N–70N, 115W–135E) — latest' },
      { id: 'PWBM99', group: 'Surface', title: '96 h surface forecast VT12Z' },
      { id: 'PYFA90', group: 'Tropical', title: 'East Pacific surface analysis (20S–30N, E of 145W) — latest' },
      { id: 'PYFE10', group: 'Tropical', title: '24 h tropical surface forecast — latest' },
      { id: 'PYFI10', group: 'Tropical', title: '48 h tropical surface forecast — latest' },
      { id: 'PYFK10', group: 'Tropical', title: '72 h tropical surface forecast — latest' },
      { id: 'PWFK11', group: 'Tropical', title: '72 h tropical cyclone danger area — latest' },
      { id: 'PJBA99', group: 'Wind / seas', title: '00Z sea state analysis (20N–70N, 115W–135E)' },
      { id: 'PWBA90', group: 'Wind / seas', title: 'Wind/wave analysis (18N–62N, E of 157W) — latest' },
      { id: 'PWBE10', group: 'Wind / seas', title: '24 h wind/wave forecast — latest' },
      { id: 'PJBI10', group: 'Wind / seas', title: '48 h wind/wave forecast — latest' },
      { id: 'PJBI20', group: 'Wind / seas', title: '48 h wave period / swell direction — latest' },
      { id: 'PJBM98', group: 'Wind / seas', title: '96 h wind/wave forecast VT12Z' },
      { id: 'PKFA10', group: 'Wind / seas', title: 'Tropical sea state analysis (20S–30N) — latest' },
      { id: 'PWFI10', group: 'Wind / seas', title: '48 h tropical wind/wave forecast — latest' },
      { id: 'PWFK10', group: 'Wind / seas', title: '72 h tropical wind/wave forecast — latest' },
      { id: 'PPBA10', group: 'Upper air', title: '500 mb analysis (20N–70N) — latest' },
      { id: 'PPBE11', group: 'Upper air', title: '24 h 500 mb forecast — latest' },
      { id: 'PPBI10', group: 'Upper air', title: '48 h 500 mb forecast — latest' },
      { id: 'PPBM50', group: 'Upper air', title: '96 h 500 mb forecast VT12Z' },
      { id: 'PTBA88', group: 'SST', title: 'Pacific SST chart (40N–53N, E of 136W)' },
      { id: 'PTBA89', group: 'SST', title: 'Pacific SST chart (23N–42N, E of 150W)' },
      { id: 'PLBZ01', group: 'Schedule', title: 'Radiofax schedule, part 1' },
      { id: 'PLBZ02', group: 'Schedule', title: 'Radiofax schedule, part 2' },
    ],
  },
  {
    id: 'KVM70',
    name: 'Honolulu',
    label: 'Honolulu, HI — Navy KVM70',
    region: 'Central, SE and North Pacific',
    frequenciesKHz: [9982.5, 11090, 16135],
    scheduleUrl: 'https://tgftp.nws.noaa.gov/fax/rfaxhi.txt',
    charts: [
      { id: 'PPBA11', group: 'Surface', title: 'Pacific surface analysis (EQ–50N, 110W–130E) — latest' },
      { id: 'PWFA11', group: 'Surface', title: 'Pacific streamline analysis (30S–30N) — latest' },
      { id: 'PBFA11', group: 'Surface', title: 'Significant cloud features (30S–50N) — latest' },
      { id: 'PYFE11', group: 'Surface', title: '24 h Pacific surface forecast (30S–50N) — latest' },
      { id: 'PYFI11', group: 'Surface', title: '48 h Pacific surface forecast — latest' },
      { id: 'PYFK11', group: 'Surface', title: '72 h Pacific surface forecast — latest' },
      { id: 'PJFB10', group: 'Wind / seas', title: 'Pacific wind/wave analysis (30S–30N) — latest' },
      { id: 'PWFE11', group: 'Wind / seas', title: '24 h Pacific wind/wave forecast — latest' },
      { id: 'PJFI10', group: 'Wind / seas', title: '48 h Pacific wind/wave forecast — latest' },
      { id: 'PJFK10', group: 'Wind / seas', title: '72 h Pacific sea state forecast — latest' },
      { id: 'PYFA90', group: 'Tropical', title: 'East Pacific surface analysis (20S–30N, E of 145W) — latest' },
      { id: 'PWFK12', group: 'Tropical', title: '72 h tropical cyclone danger area, Pacific — latest' },
      { id: 'PTFA88', group: 'SST', title: 'Pacific SST chart (55N–EQ, 110W–160E)' },
      { id: 'PLBZ07', group: 'Schedule', title: 'Radiofax schedule, part 1' },
      { id: 'PLBZ09', group: 'Schedule', title: 'Radiofax schedule, part 2' },
    ],
  },
  {
    id: 'NOJ',
    name: 'Kodiak',
    label: 'Kodiak, AK — USCG NOJ',
    region: 'Gulf of Alaska, Bering Sea, North Pacific',
    frequenciesKHz: [2054, 4298, 8459, 12410.6],
    scheduleUrl: 'https://tgftp.nws.noaa.gov/fax/rfaxak.txt',
    charts: [
      { id: 'PYCA10', group: 'Surface', title: 'Surface analysis (40N–70N, 125W–150E) — latest' },
      { id: 'PYBE10', group: 'Surface', title: '24 h surface forecast (40N–70N) — latest' },
      { id: 'PWBI10', group: 'Surface', title: '48 h surface forecast (20N–70N) — latest' },
      { id: 'PWBM99', group: 'Surface', title: '96 h surface forecast VT12Z' },
      { id: 'PJBA99', group: 'Wind / seas', title: '00Z sea state analysis (20N–70N, 115W–135E)' },
      { id: 'PJBE10', group: 'Wind / seas', title: '24 h wind/wave forecast (40N–70N) — latest' },
      { id: 'PJBI10', group: 'Wind / seas', title: '48 h wind/wave forecast — latest' },
      { id: 'PJBI20', group: 'Wind / seas', title: '48 h wave period / swell direction — latest' },
      { id: 'PJBM98', group: 'Wind / seas', title: '96 h wind/wave forecast VT12Z' },
      { id: 'PPBA10', group: 'Upper air', title: '500 mb analysis — latest' },
      { id: 'PPBE11', group: 'Upper air', title: '24 h 500 mb forecast — latest' },
      { id: 'PPBI10', group: 'Upper air', title: '48 h 500 mb forecast — latest' },
      { id: 'PTCA88', group: 'SST', title: 'Sea surface temperature analysis (40N–60N)' },
      { id: 'PTCA89', group: 'Ice', title: 'Sea ice analysis' },
      { id: 'PTCO89', group: 'Ice', title: '5-day sea ice forecast' },
      { id: 'PTCA87', group: 'Ice', title: 'Cook Inlet sea ice analysis' },
      { id: 'PLBZ05', group: 'Schedule', title: 'Radiofax schedule' },
    ],
  },
];

const CHART_ID_RE = /^[A-Z]{4}\d{2}$/;
const BASE_URL = 'https://tgftp.nws.noaa.gov/fax/';

const knownIds = new Set();
for (const st of STATIONS) for (const c of st.charts) knownIds.add(c.id);

/** True when `id` is a chart in the catalogue (the proxy's allowlist). */
function isKnownChart(id) {
  return typeof id === 'string' && CHART_ID_RE.test(id) && knownIds.has(id);
}

function chartUrl(id) {
  return `${BASE_URL}${id}.gif`;
}

/** USB dial frequency for an assigned radiofax carrier (kHz). */
function usbDialKHz(carrierKHz) {
  return Math.round((carrierKHz - 1.9) * 10) / 10;
}

function getCatalog() {
  return {
    stations: STATIONS.map((s) => ({
      ...s,
      dialKHz: s.frequenciesKHz.map(usbDialKHz),
    })),
    source: 'NWS radiofax schedules (rfax.pdf); charts from tgftp.nws.noaa.gov/fax',
  };
}

module.exports = { STATIONS, isKnownChart, chartUrl, usbDialKHz, getCatalog, CHART_ID_RE };
