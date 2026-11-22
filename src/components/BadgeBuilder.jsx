/**
 * Public badge builder — /badges and /badge-builder.
 * Picks theme, fields, and size, previews the PNG, and copies embed snippets.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  BADGE_SITE,
  DEFAULT_BADGE_FIELDS,
  badgeImageUrl,
  badgeSnippets,
  buildBadgeQuery,
  canonicalFields,
  snippetOrigin,
} from '../utils/badgeEmbed';
import './BadgeBuilder.css';

const FALLBACK = {
  default: 'dark',
  defaultVariant: 'full',
  defaultFields: DEFAULT_BADGE_FIELDS,
  fields: [
    { id: 'sfi', label: 'SFI', hint: 'Solar flux' },
    { id: 'ssn', label: 'Sunspots', hint: 'Sunspot number' },
    { id: 'kp', label: 'Kp', hint: 'Planetary K' },
    { id: 'a', label: 'A index', hint: 'Planetary A' },
    { id: 'k', label: 'K index', hint: 'K index' },
    { id: 'xray', label: 'X-ray', hint: 'X-ray class' },
    { id: 'bands', label: 'HF bands', hint: 'Day and night' },
    { id: 'trend', label: 'Trend', hint: 'SFI and Kp sparklines' },
    { id: 'updated', label: 'Updated', hint: 'UTC time' },
  ],
  variants: [
    { id: 'full', label: 'Standard', hint: '760 px' },
    { id: 'compact', label: 'Compact', hint: '580 px' },
    { id: 'wide', label: 'Wide', hint: '980 px' },
  ],
  wavelengths: [
    { id: '0193', label: 'AIA 193 Å' },
    { id: '0304', label: 'AIA 304 Å' },
    { id: '0171', label: 'AIA 171 Å' },
    { id: '0094', label: 'AIA 94 Å' },
    { id: 'HMIIC', label: 'HMI visible' },
  ],
  defaultWavelength: '0193',
  themes: [
    { id: 'dark', label: 'Dark', group: 'openhamclock', background: '#0a0e14', accent: '#ffb432' },
    { id: 'light', label: 'Light', group: 'openhamclock', background: '#f5f7fa', accent: '#a87508' },
    { id: 'red', label: 'Red', group: 'color', background: '#0c0d10', accent: '#ff1f1f' },
    { id: 'blue', label: 'Blue', group: 'color', background: '#070d18', accent: '#6aa6ff' },
    { id: 'green', label: 'Green', group: 'color', background: '#07110c', accent: '#3dd68c' },
    { id: 'yellow', label: 'Yellow', group: 'color', background: '#121006', accent: '#ffd15a' },
    { id: 'orange', label: 'Orange', group: 'color', background: '#140e08', accent: '#ff9a3c' },
    { id: 'purple', label: 'Purple', group: 'color', background: '#100818', accent: '#c084fc' },
    { id: 'neutral', label: 'Neutral', group: 'color', background: '#141416', accent: '#d5d8de' },
    { id: 'neutral-light', label: 'Neutral Light', group: 'color', background: '#f3f4f6', accent: '#1f2933' },
  ],
};

function readInitial(catalog) {
  const params = new URLSearchParams(window.location.search);
  const known = new Set((catalog.themes || []).map((theme) => theme.id));
  const requested = (params.get('theme') || '').trim().toLowerCase();
  const theme = known.has(requested) ? requested : catalog.default || 'dark';
  const variantIds = new Set((catalog.variants || []).map((variant) => variant.id));
  const requestedVariant = (params.get('variant') || '').trim().toLowerCase();
  const variant = variantIds.has(requestedVariant) ? requestedVariant : catalog.defaultVariant || 'full';
  const fields = params.has('fields')
    ? canonicalFields(params.get('fields'), catalog.defaultFields || DEFAULT_BADGE_FIELDS)
    : (catalog.defaultFields || DEFAULT_BADGE_FIELDS).slice();
  const kindParam = (params.get('badge') || 'conditions').toLowerCase();
  const kind = kindParam === 'sun' || kindParam === 'moon' ? kindParam : 'conditions';
  const place = (value) => (value === 'left' || value === 'right' ? value : 'none');
  const wavelengths = new Set((catalog.wavelengths || []).map((item) => item.id));
  const requestedWl = params.get('wl') || '';
  const wl = wavelengths.has(requestedWl) ? requestedWl : catalog.defaultWavelength || '0193';
  return { theme, variant, fields, kind, sun: place(params.get('sun')), moon: place(params.get('moon')), wl };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export default function BadgeBuilder() {
  const [catalog, setCatalog] = useState(FALLBACK);
  const [theme, setTheme] = useState('dark');
  const [variant, setVariant] = useState('full');
  const [fields, setFields] = useState(DEFAULT_BADGE_FIELDS);
  const [kind, setKind] = useState('conditions');
  const [sunSide, setSunSide] = useState('none');
  const [moonSide, setMoonSide] = useState('none');
  const [wl, setWl] = useState('0193');
  const [copied, setCopied] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.title = 'Badge Builder — OpenHamClock';
    let cancelled = false;
    fetch('/api/badge/themes')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('themes'))))
      .then((data) => {
        if (cancelled || !data?.themes?.length) return;
        setCatalog(data);
        const initial = readInitial(data);
        setTheme(initial.theme);
        setVariant(initial.variant);
        setFields(initial.fields);
        setKind(initial.kind);
        setSunSide(initial.sun);
        setMoonSide(initial.moon);
        setWl(initial.wl);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        const initial = readInitial(FALLBACK);
        setTheme(initial.theme);
        setVariant(initial.variant);
        setFields(initial.fields);
        setKind(initial.kind);
        setSunSide(initial.sun);
        setMoonSide(initial.moon);
        setWl(initial.wl);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selected = catalog.themes.find((item) => item.id === theme);
    const pageTheme = selected?.group === 'openhamclock' ? selected.id : 'dark';
    document.documentElement.setAttribute('data-theme', pageTheme);
  }, [catalog, theme]);

  const query = useMemo(
    () =>
      buildBadgeQuery({
        kind,
        theme,
        fields,
        variant,
        sun: sunSide === 'none' ? null : sunSide,
        moon: moonSide === 'none' ? null : moonSide,
        wl,
        defaults: catalog,
      }),
    [kind, theme, fields, variant, sunSide, moonSide, wl, catalog],
  );
  const previewPath =
    kind === 'sun' ? '/api/badge/sun.png' : kind === 'moon' ? '/api/badge/moon.png' : '/api/badge/solar.png';
  const previewSrc = query ? `${previewPath}?${query}` : previewPath;
  const origin = snippetOrigin(window.location.hostname, window.location.origin);
  const imageUrl = badgeImageUrl(origin, query, kind);
  const snippets = badgeSnippets(imageUrl, kind);

  useEffect(() => {
    if (!ready) return;
    const path = window.location.pathname.replace(/\/+$/, '') || '/badges';
    const pageParams = new URLSearchParams(query);
    if (kind !== 'conditions') pageParams.set('badge', kind);
    const pageQuery = pageParams.toString();
    const next = pageQuery ? `${path}?${pageQuery}` : path;
    const current = `${window.location.pathname.replace(/\/+$/, '')}${window.location.search}`;
    if (current !== next) window.history.replaceState(null, '', next);
  }, [query, kind, ready]);

  function toggleField(id) {
    setFields((current) => {
      const has = current.includes(id);
      if (has && current.length === 1) return current;
      const next = has ? current.filter((item) => item !== id) : [...current, id];
      return canonicalFields(next.join(','), catalog.defaultFields || DEFAULT_BADGE_FIELDS);
    });
    setPreviewError(false);
  }

  async function onCopy(id, text) {
    const ok = await copyText(text);
    setCopied(ok ? id : '');
  }

  const groups = [
    ['openhamclock', 'OpenHamClock themes'],
    ['color', 'Color themes'],
  ];

  return (
    <main id="main-content" className="badge-builder">
      <div className="badge-builder-wrap">
        <section>
          <p className="badge-kicker">OpenHamClock</p>
          <h1>Badge builder</h1>
          <p className="badge-lead">
            A live solar and HF conditions image for QRZ, a club site, or a README. Status colors stay green, yellow,
            and red. The theme changes the background and the OpenHamClock accent.
          </p>
          <p>
            <a className="badge-back" href="/">
              Back to the dashboard
            </a>
          </p>

          <div className="badge-card">
            <h2>Badge</h2>
            <div className="badge-variants" role="group" aria-label="Badge type">
              {[
                ['conditions', 'Conditions'],
                ['sun', 'Sun'],
                ['moon', 'Moon'],
              ].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {kind === 'conditions' ? (
            <div className="badge-card">
              <h2>Show</h2>
              <div className="badge-fields">
                {catalog.fields.map((field) => (
                  <label key={field.id} title={field.hint}>
                    <input type="checkbox" checked={fields.includes(field.id)} onChange={() => toggleField(field.id)} />
                    {field.label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {kind === 'conditions' ? (
            <div className="badge-card">
              <h2>Sun and moon</h2>
              <p className="badge-lead">
                Place a live photo on either side of the conditions. The other side stays open.
              </p>
              <Placement
                label="Sun"
                value={sunSide}
                onChange={(next) => {
                  setSunSide(next);
                  if (next !== 'none' && next === moonSide) setMoonSide(next === 'left' ? 'right' : 'left');
                }}
              />
              <Placement
                label="Moon"
                value={moonSide}
                onChange={(next) => {
                  setMoonSide(next);
                  if (next !== 'none' && next === sunSide) setSunSide(next === 'left' ? 'right' : 'left');
                }}
              />
            </div>
          ) : null}

          {kind === 'sun' || (kind === 'conditions' && sunSide !== 'none') ? (
            <div className="badge-card">
              <h2>Wavelength</h2>
              <div className="badge-variants" role="group" aria-label="Solar wavelength">
                {(catalog.wavelengths || FALLBACK.wavelengths).map((item) => (
                  <button key={item.id} type="button" aria-pressed={wl === item.id} onClick={() => setWl(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="badge-card">
            <h2>Size</h2>
            <div className="badge-variants" role="group" aria-label="Badge size">
              {catalog.variants.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={variant === item.id}
                  title={item.hint}
                  onClick={() => {
                    setVariant(item.id);
                    setPreviewError(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="badge-card">
            <h2>Theme</h2>
            {groups.map(([group, title]) => (
              <div className="theme-group" key={group}>
                <p>{title}</p>
                <div className="theme-grid">
                  {catalog.themes
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="theme-swatch"
                        aria-pressed={theme === item.id}
                        onClick={() => {
                          setTheme(item.id);
                          setPreviewError(false);
                        }}
                      >
                        <div
                          className="swatch-chip"
                          style={{ '--swatch-bg': item.background, '--swatch-accent': item.accent }}
                        />
                        <span>{item.label}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="badge-preview">
          <h2 className="badge-kicker">Live preview</h2>
          {previewError ? (
            <p className="badge-error">The preview image did not load. The copied links still point at the badge.</p>
          ) : null}
          <img
            src={previewSrc}
            alt="Preview of the OpenHamClock solar conditions badge"
            onLoad={() => setPreviewError(false)}
            onError={() => setPreviewError(true)}
          />
          <p className="badge-url">{imageUrl}</p>

          <Snippet title="QRZ.com biography" id="qrz" text={snippets.qrz} copied={copied} onCopy={onCopy} />
          <Snippet title="Website HTML" id="html" text={snippets.html} copied={copied} onCopy={onCopy} />
          <Snippet title="Markdown" id="markdown" text={snippets.markdown} copied={copied} onCopy={onCopy} />
          <Snippet title="BBCode" id="bbcode" text={snippets.bbcode} copied={copied} onCopy={onCopy} />

          <div className="badge-card">
            <h2>Add it to QRZ</h2>
            <ol className="badge-steps">
              <li>Sign in at QRZ and open your callsign page.</li>
              <li>Choose Edit page.</li>
              <li>Open the Biography tab.</li>
              <li>Switch the editor to HTML / source view.</li>
              <li>Paste the QRZ snippet.</li>
              <li>Save.</li>
            </ol>
          </div>
          <div className="badge-card">
            <h2>Add it to a website</h2>
            <ol className="badge-steps">
              <li>Copy the HTML snippet.</li>
              <li>Paste it where the badge should appear.</li>
              <li>The image refreshes from OpenHamClock about every five minutes. No script is required.</li>
            </ol>
            <p className="badge-lead">
              Self-hosted copies of this page embed your own server when it has a public name. This preview always uses
              the server you are viewing. On QRZ, use {BADGE_SITE} unless your instance is reachable on the internet.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Placement({ label, value, onChange }) {
  return (
    <div className="badge-place">
      <span>{label}</span>
      <div className="badge-variants" role="group" aria-label={`${label} placement`}>
        {[
          ['none', 'Off'],
          ['left', 'Left'],
          ['right', 'Right'],
        ].map(([id, text]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Snippet({ title, id, text, copied, onCopy }) {
  return (
    <div className="snippet">
      <header>
        <h3>{title}</h3>
        <button type="button" className="copy-btn" onClick={() => onCopy(id, text)}>
          {copied === id ? 'Copied' : 'Copy'}
        </button>
      </header>
      <pre>{text}</pre>
    </div>
  );
}
