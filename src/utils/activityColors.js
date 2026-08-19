/**
 * Activity-programme marker colours.
 *
 * POTA, WWFF, SOTA and WWBOTA each have a colour that identifies the programme
 * wherever it appears — the dedicated panels, the layer picker, and every map
 * projection. They are not themed: a SOTA spot has to look like a SOTA spot in
 * Dark, Light and Retro alike, and band colours are centralised in
 * bandColors.js for the same reason.
 *
 * These values are the ones POTAPanel, WWFFPanel, SOTAPanel, WWBOTAPanel,
 * PotaSotaPanel and the layer picker already agree on. They live here so a map
 * cannot quietly pick a different shade — which is exactly what had happened:
 * the 3D globe had invented its own WWFF, SOTA and WWBOTA colours, and the
 * azimuthal map drew WWBOTA in the same blue as the DE station marker.
 */
export const ACTIVITY_COLORS = {
  pota: '#44cc44',
  wwff: '#a3f3a3',
  sota: '#ff9632',
  wwbota: '#8b7fff',
};

export default ACTIVITY_COLORS;
