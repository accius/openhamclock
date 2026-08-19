/**
 * Satellite pass prediction modal.
 *
 * Extracted from the Leaflet satellite layer so both projections can open it.
 * That layer registered it on `window` and does not mount at all in 3D, so the
 * globe's telemetry window had a Predict button that silently did nothing.
 * Taking its dependencies as arguments removes the hidden global coupling —
 * callers pass what it needs rather than relying on a plugin having run.
 */
import Orbit from './orbit.js';

/**
 * @param {object}   opts
 * @param {string}   opts.satName    - satellite name, as shown to the operator
 * @param {object}   opts.omm        - orbit mean elements for the propagator
 * @param {Array}    opts.satellites - current satellite list (for the lookup)
 * @param {object}   opts.config     - app config: station location, min elevation
 * @param {Function} opts.t          - i18n translator
 */
export function openSatellitePredict({ satName, omm, satellites, config, t }) {
  if (!satName || !satellites) return;

  // Find the satellite data
  const sat = satellites.find((s) => s.name === satName);
  if (!sat) {
    alert(`Satellite ${satName} not found`);
    return;
  }

  const orbit = new Orbit(sat.name, omm);
  orbit.error && console.warn('Satellite orbit error:', orbit.error);

  const groundStation = {
    latitude: config?.location?.lat || 0.0,
    longitude: config?.location?.lon || 0.0,
    height: config?.location?.stationAlt || 100, // above sea level [m]
  };

  const startDate = new Date(); // from now
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // until 7 days from now
  const minElevation = config?.satellite?.minElev || 5;
  const maxPasses = 25;
  const passes = orbit.computePassesElevation(groundStation, startDate, endDate, minElevation, maxPasses);

  const modalId = 'satellite-predict-modal';

  // Function to generate modal content
  const generateModalContent = (currentPasses) => {
    return `
          <div style="text-align: center; margin-bottom: 16px; border-bottom: 2px solid var(--accent-red); padding-bottom: 12px;">
            <h2 style="margin: 0; color: var(--accent-cyan); font-size: 24px;">🛰 ${satName}</h2>
            <p style="margin: 8px 0 0 0; color: var(--text-muted); font-size: 12px;">${t('station.settings.satellites.predictionDetails')}</p>
          </div>

          <div style="margin-top: 16px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid var(--text-muted);">
              <thead>
                <tr style="background: var(--bg-secondary); padding: 2px; border-bottom: 2px solid var(--text-muted);">
                  <th colspan="3" style="border-right: 3px double var(--text-muted); padding: 4px;">${t('station.settings.satellites.start')}</th>
                  <th colspan="3" style="border-right: 3px double var(--text-muted); padding: 4px;">${t('station.settings.satellites.apex')}</th>
                  <th colspan="2" style="border-right: 3px double var(--text-muted); padding: 4px;">${t('station.settings.satellites.end')}</th>
                  <th style="padding: 4px;">${t('station.settings.satellites.duration')}</th>
                </tr>
                <tr style="background: var(--bg-secondary); padding: 2px; border-bottom: 2px solid var(--text-muted);">
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">${t('station.settings.satellites.localTime')}</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">${t('station.settings.satellites.fromNow')}</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">${t('station.settings.satellites.azimuthAbbreviation')} [°]</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">${t('station.settings.satellites.localTime')}</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">${t('station.settings.satellites.azimuthAbbreviation')} [°]</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">${t('station.settings.satellites.elevationAbbreviation')} [°]</th>
                  <th style="border-right: 1px solid var(--text-muted); padding: 4px;">${t('station.settings.satellites.localTime')}</th>
                  <th style="border-right: 3px double var(--text-muted); padding: 4px;">${t('station.settings.satellites.azimuthAbbreviation')} [°]</th>
                  <th style="padding: 4px;">[${t('station.settings.satellites.minutesAbbreviation')}]</th>
                </tr>
              </thead>
              <tbody>
                ${currentPasses
                  .map((pass) => {
                    const azimuthStart = pass.azimuthStart.toFixed(0);
                    const azimuthApex = pass.azimuthApex.toFixed(0);
                    const azimuthEnd = pass.azimuthEnd.toFixed(0);
                    const maxElevation = pass.maxElevation.toFixed(0);
                    const durationMins = (pass.duration / 60000).toFixed(1);
                    const formatLocalTime = (ts) => {
                      const d = new Date(ts);
                      const pad = (n) => String(n).padStart(2, '0');
                      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    };
                    const startTime = formatLocalTime(pass.start);
                    const apexTime = formatLocalTime(pass.apex);
                    const endTime = formatLocalTime(pass.end);
                    const secsFromNow = Math.floor((pass.start - new Date()) / 1000);

                    const isVisibleNow = secsFromNow <= 0 && new Date() < new Date(pass.end);
                    const isPast = secsFromNow <= 0 && new Date() > new Date(pass.end);

                    if (isPast) {
                      return ``; // skip past passes
                    }

                    const timeFromNow = isVisibleNow
                      ? `${t('station.settings.satellites.visible')}`
                      : secsFromNow > 3600
                        ? `${String(Math.floor(secsFromNow / 3600)).padStart(2, '0')}:${String(Math.floor((secsFromNow % 3600) / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
                        : secsFromNow > 60
                          ? `00:${String(Math.floor(secsFromNow / 60)).padStart(2, '0')}:${String(secsFromNow % 60).padStart(2, '0')}`
                          : `00:00:${String(secsFromNow).padStart(2, '0')}`;

                    return `<tr style="background: var(--bg-tertiary); text-align: center; border-bottom: 1px solid var(--text-muted);">
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${startTime}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${timeFromNow}</td>
                    <td style="border-right: 3px double var(--text-muted); padding: 4px;">${azimuthStart}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${apexTime}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${azimuthApex}</td>
                    <td style="border-right: 3px double var(--text-muted); padding: 4px;">${maxElevation}</td>
                    <td style="border-right: 1px solid var(--text-muted); padding: 4px;">${endTime}</td>
                    <td style="border-right: 3px double var(--text-muted); padding: 4px;">${azimuthEnd}</td>
                    <td style="padding: 4px;">${durationMins}</td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>

          <div style="text-align: center; margin-top: 16px;">
            <button
              class="sat-predict-close"
              data-action="close-predict-modal"
              style="
                background: var(--accent-cyan);
                border: 1px solid var(--accent-cyan);
                color: var(--bg-primary);
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-size: 12px;
              ">
              ${t('station.settings.satellites.close')}
            </button>
          </div>
        `;
  };

  // Create a modal overlay
  let modal = document.getElementById(modalId);

  if (modal) {
    modal.remove();
  }

  // Create modal elements
  modal = document.createElement('div');
  modal.id = modalId;
  modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--bg-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;

  const content = document.createElement('div');
  content.style.cssText = `
        background: var(--bg-primary);
        border: 2px solid var(--accent-red);
        border-radius: 8px;
        padding: 20px;
        min-width: 50vw;
        max-width: 95vw;
        min-height: 25vh;
        max-height: 90vh;
        overflow-y: auto;
        overflow-x: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        font-family: var(--font-mono);
        color: var(--text-primary);
      `;

  content.innerHTML = generateModalContent(passes);

  modal.appendChild(content);
  document.body.appendChild(modal);

  // Named function so it can be removed later
  const handleModalClick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  const currentStartDate = new Date();
  const currentEndDate = new Date(currentStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const currentPasses = orbit.computePassesElevation(
    groundStation,
    currentStartDate,
    currentEndDate,
    minElevation,
    maxPasses,
  );

  // update modal every second, satellite data currentPasses is not updated unless modal is reopened,
  // or if satellite layer is updated for instance if satellite data changes
  const updatePasses = () => {
    content.innerHTML = generateModalContent(currentPasses);
  };

  const closeModal = () => {
    // Clean up all event listeners before removing modal
    content.removeEventListener('click', handleContentClick);
    modal.removeEventListener('click', handleModalClick);
    document.removeEventListener('keydown', handleKeyDown);

    modal.remove();
    if (window.satellitePredictInterval) {
      clearInterval(window.satellitePredictInterval);
    }
  };

  // Use event delegation for close button so it works after HTML regeneration
  const handleContentClick = (e) => {
    if (e.target.matches('[data-action="close-predict-modal"]')) {
      closeModal();
    }
  };

  if (window.satellitePredictInterval) {
    clearInterval(window.satellitePredictInterval);
  }

  window.satellitePredictInterval = setInterval(updatePasses, 1000); // one second

  // Close on backdrop click
  modal.addEventListener('click', handleModalClick);

  // Close on Escape key
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', handleKeyDown);

  // Wire close button using event delegation (one listener for all updates)
  content.addEventListener('click', handleContentClick);
}

export default openSatellitePredict;
