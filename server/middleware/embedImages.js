/**
 * Public images are meant to be used from <img> on other sites (QRZ
 * biographies, READMEs). Helmet's default Cross-Origin-Resource-Policy is
 * same-origin, and browsers refuse to paint those responses into a
 * cross-origin <img> even when the status is 200.
 *
 * This sets CORP to cross-origin only for those routes, and it does it from
 * writeHead so it wins over Helmet (which sets same-origin earlier). Every
 * other response keeps Helmet's header. COEP stays off, and X-Frame-Options
 * stays SAMEORIGIN — neither one blocks a plain <img>.
 */

const EMBEDDABLE = [
  /^\/api\/badge\/[^/]+\.png$/i,
  /^\/api\/badge\/themes\/?$/,
  /^\/api\/solar\/image\/[^/]+$/,
  /^\/api\/moon-image\/?$/,
];

function isEmbeddableImagePath(path) {
  const bare = String(path || '').split('?')[0];
  return EMBEDDABLE.some((re) => re.test(bare));
}

/** Run `listener` once, just before headers are flushed. */
function beforeHeaders(res, listener) {
  if (res.headersSent) return;
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithEmbedCorp(...args) {
    res.writeHead = writeHead;
    listener.call(this);
    return writeHead.apply(this, args);
  };
}

function allowEmbeddableImages(req, res, next) {
  if (!isEmbeddableImagePath(req.path)) return next();
  beforeHeaders(res, function setEmbedCorp() {
    this.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  });
  next();
}

module.exports = { isEmbeddableImagePath, allowEmbeddableImages };
