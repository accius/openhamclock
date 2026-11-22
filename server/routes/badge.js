/**
 * Public solar-conditions badge.
 *
 *   GET /api/badge/solar.png   image/png
 *   GET /api/badge/themes      theme, field, and variant catalog
 *
 * Query (unknown values fall back to the defaults):
 *   theme    dark (default) | light | … | red | blue | …
 *   fields   sfi,ssn,kp,a,xray,bands,updated,trend
 *   variant  full (default) | compact | wide
 *
 * The PNG is cached about five minutes per theme + fields + variant.
 * Embed it with an <img>; QRZ biographies and other script-free pages can.
 */

const { DEFAULT_THEME, listBadgeThemes, publicTheme } = require('../badge/themes');
const {
  DEFAULT_FIELDS,
  FIELD_META,
  VARIANT_META,
  renderSolarBadgePng,
  renderDiskBadge,
} = require('../badge/solarBadge');
const { WAVELENGTHS } = require('../badge/diskBadge');

module.exports = function (app, ctx) {
  const { logErrorOnce } = ctx;

  app.get('/api/badge/themes', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.json({
      default: DEFAULT_THEME,
      defaultVariant: 'full',
      defaultFields: DEFAULT_FIELDS,
      fields: FIELD_META,
      variants: VARIANT_META,
      wavelengths: Object.values(WAVELENGTHS),
      defaultWavelength: '0193',
      placements: ['left', 'right'],
      themes: listBadgeThemes().map(publicTheme),
    });
  });

  app.get('/api/badge/sun.png', async (req, res) => {
    try {
      const png = await renderDiskBadge('sun', {
        theme: req.query.theme,
        variant: req.query.variant,
        wl: req.query.wl,
        ctx,
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=900');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(png);
    } catch (error) {
      logErrorOnce?.('Sun badge', error.message);
      res.status(500).json({ error: 'Failed to render sun badge' });
    }
  });

  app.get('/api/badge/moon.png', async (req, res) => {
    try {
      const png = await renderDiskBadge('moon', {
        theme: req.query.theme,
        variant: req.query.variant,
        ctx,
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(png);
    } catch (error) {
      logErrorOnce?.('Moon badge', error.message);
      res.status(500).json({ error: 'Failed to render moon badge' });
    }
  });

  app.get('/api/badge/solar.png', async (req, res) => {
    try {
      const png = await renderSolarBadgePng({
        theme: req.query.theme,
        fields: req.query.fields,
        variant: req.query.variant,
        sun: req.query.sun,
        moon: req.query.moon,
        wl: req.query.wl,
        ctx,
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      // QRZ and other sites load this from <img>. Helmet's default
      // same-origin CORP would block that.
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(png);
    } catch (error) {
      logErrorOnce?.('Solar badge', error.message);
      res.status(500).json({ error: 'Failed to render solar badge' });
    }
  });
};
