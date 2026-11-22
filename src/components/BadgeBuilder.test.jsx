/**
 * Badge builder: theme and field choices show up in the embed snippets.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { badgeSnippets, buildBadgeQuery, canonicalFields, snippetOrigin } from '../utils/badgeEmbed';
import BadgeBuilder from './BadgeBuilder.jsx';

const catalog = {
  default: 'dark',
  defaultVariant: 'full',
  defaultFields: ['sfi', 'ssn', 'kp', 'a', 'xray', 'bands', 'updated', 'trend'],
  fields: [
    { id: 'sfi', label: 'SFI', hint: 'flux' },
    { id: 'ssn', label: 'Sunspots', hint: 'ssn' },
    { id: 'kp', label: 'Kp', hint: 'kp' },
    { id: 'bands', label: 'HF bands', hint: 'bands' },
    { id: 'xray', label: 'X-ray', hint: 'xray' },
    { id: 'trend', label: 'Trend', hint: 'trend' },
    { id: 'updated', label: 'Updated', hint: 'time' },
    { id: 'a', label: 'A index', hint: 'a' },
    { id: 'k', label: 'K index', hint: 'k' },
  ],
  variants: [
    { id: 'full', label: 'Standard', hint: '760' },
    { id: 'compact', label: 'Compact', hint: '580' },
    { id: 'wide', label: 'Wide', hint: '980' },
  ],
  themes: [
    { id: 'dark', label: 'Dark', group: 'openhamclock', background: '#0a0e14', accent: '#ffb432' },
    { id: 'red', label: 'Red', group: 'color', background: '#0c0d10', accent: '#ff1f1f' },
  ],
};

describe('badge embed helpers', () => {
  it('omits default options and keeps a stable field order', () => {
    expect(canonicalFields('kp,sfi,nope')).toEqual(['sfi', 'kp']);
    expect(canonicalFields('')).toContain('bands');
    expect(buildBadgeQuery({ theme: 'dark', fields: catalog.defaultFields, variant: 'full', defaults: catalog })).toBe(
      '',
    );
    expect(buildBadgeQuery({ theme: 'red', fields: ['sfi', 'kp'], variant: 'compact', defaults: catalog })).toBe(
      'theme=red&variant=compact&fields=sfi%2Ckp',
    );
  });

  it('points local previews at openhamclock.com and keeps a public self-host', () => {
    expect(snippetOrigin('localhost', 'http://localhost:3000')).toBe('https://openhamclock.com');
    expect(snippetOrigin('club.example.com', 'https://club.example.com')).toBe('https://club.example.com');
    const snippets = badgeSnippets('https://openhamclock.com/api/badge/solar.png?theme=red');
    expect(snippets.qrz).toContain('<a href="https://openhamclock.com">');
    expect(snippets.qrz).toContain('theme=red');
    expect(snippets.markdown).toContain('[![');
    expect(snippets.bbcode).toContain('[img]');
  });
});

describe('BadgeBuilder', () => {
  let root;
  let container;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => catalog })),
    );
    window.history.replaceState(null, '', '/badges');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(<BadgeBuilder />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('shows QRZ steps and updates the snippet when the theme changes', async () => {
    await render();
    expect(container.textContent).toContain('Biography tab');
    expect(container.textContent).toContain('HTML / source view');
    const red = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Red');
    expect(red).toBeTruthy();
    await act(async () => {
      red.click();
    });
    const qrz = [...container.querySelectorAll('pre')].map((node) => node.textContent).join('\n');
    expect(qrz).toContain('theme=red');
    expect(qrz).toContain('https://openhamclock.com/api/badge/solar.png');

    const sfi = [...container.querySelectorAll('label')].find((label) => label.textContent.includes('SFI'));
    await act(async () => {
      sfi.querySelector('input').click();
    });
    const after = [...container.querySelectorAll('pre')].map((node) => node.textContent).join('\n');
    expect(after).toContain('fields=');
    expect(after).not.toMatch(/fields=[^"&\s]*sfi/);

    const sun = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Sun');
    await act(async () => {
      sun.click();
    });
    expect(container.querySelector('pre').textContent).toContain('/api/badge/sun.png');
  });
});
