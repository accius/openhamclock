/**
 * End-to-end: two operators share one EmComm incident, in a real browser.
 *
 *   npm run build && node server.js            # production build, any port
 *   OHC_URL=http://127.0.0.1:3000 node scripts/e2e/incident-two-operators.mjs [screenshot-dir]
 *
 * Two Chromium contexts (separate storage = two stations) walk the whole
 * flow: create, invite link, join, check-in propagation, message traffic
 * from two sites in the shared ICS 309 (own numbers plain, the other site's
 * as SITE:n) and a shared ICS 214 draft, OUT, board edit (admin) and its
 * absence for an operator, a shared Net Control net, an admin deletion, the
 * offline buffer flushing on reconnect, reload without duplicates, join-key
 * rotation, and leave. APRS sends are answered inside the browser, so the
 * script never reaches a radio. Screenshots of the EmComm rail at desktop width and
 * at 390×844 go to the screenshot directory (default: ./e2e-shots).
 *
 * Exits non-zero on the first failed check. Uses the server's incident
 * store, so point it at a throwaway instance (set INCIDENT_FILE).
 */
/* global document, window, location -- used inside page.evaluate / waitForFunction callbacks, which run in the browser */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.OHC_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SHOTS = process.argv[2] || 'e2e-shots';
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const T = 20_000;

mkdirSync(SHOTS, { recursive: true });

let step = 0;
const log = (msg) => console.log(`${String(++step).padStart(2, '0')}  ${msg}`);
function check(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`    ✓ ${msg}`);
}

/** A fresh station: its own storage, callsign and layout. */
async function station(
  browser,
  { call, layout = 'emcomm', viewport = { width: 1440, height: 900 }, clockSkew = false },
) {
  const context = await browser.newContext({ viewport });
  if (clockSkew) {
    // Lets a step make this station's computer clock wrong: Date reads
    // globalThis.__clockSkewMs (0 until a step sets it); timers run normally.
    await context.addInitScript(() => {
      const RealDate = Date;
      const skew = () => globalThis.__clockSkewMs || 0;
      class SkewedDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(RealDate.now() + skew());
          else super(...args);
        }
        static now() {
          return RealDate.now() + skew();
        }
      }
      globalThis.Date = SkewedDate;
    });
  }
  await context.addInitScript(
    ({ call, layout, version }) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem(
        'openhamclock_config',
        JSON.stringify({
          callsign: call,
          locator: 'EN34IX',
          location: { lat: 44.9, lon: -93.2 },
          layout,
          theme: 'dark',
        }),
      );
      localStorage.setItem('openhamclock_lastSeenVersion', version);
      localStorage.setItem('ohc_startrekday_2026_dismissed', '1');
      localStorage.setItem('openhamclock_mobileLayoutSuggested', '1');
    },
    { call, layout, version: VERSION },
  );
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log(`    [${call} page error] ${e.message}`));
  return { context, page, call };
}

const status = (page) => page.getByTestId('incident-status');
const waitLive = (page) => status(page).filter({ hasText: 'LIVE' }).waitFor({ timeout: T });
const rosterRow = (page, call) => page.locator(`[data-testid="roster-row"][data-call="${call}"]`);
const eventRows = (page, text) => page.getByTestId('event-row').filter({ hasText: text });
const participants = (page) => page.getByTestId('incident-participants');
const dialog = (page) => page.getByRole('dialog');

/** Open an ICS form from the EmComm rail; returns the overlay. */
async function openIcs(page, label) {
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await dialog(page).waitFor({ timeout: T });
  return dialog(page);
}
const closeIcs = async (page) => {
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached', timeout: T });
};
/** Values of the 309 rows' message-number cells (both columns). */
const msgNumbers = (overlay) =>
  overlay.getByLabel('Msg #', { exact: true }).evaluateAll((els) => els.map((e) => e.value));
const inputValues = (overlay) => overlay.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value));

async function railShot(page, file) {
  // The rail is the scrolling sidebar holding the Incident panel.
  const rail = page.getByTestId('incident-panel').or(page.getByTestId('incident-panel-local')).first();
  await rail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, file), type: 'jpeg', quality: 80 });
}

async function main() {
  const browser = await chromium.launch();
  // A's clock can be made wrong for one step (the net conflict, decided by the server's order).
  const a = await station(browser, { call: 'K0CJH', clockSkew: true });
  // B starts in another layout: the invite link must switch it to EmComm.
  const b = await station(browser, { call: 'W1AW', layout: 'modern' });
  try {
    log('A opens EmComm and creates an incident');
    await a.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const local = a.page.getByTestId('incident-panel-local');
    await local.waitFor({ timeout: T });
    await local.getByRole('button', { name: 'Create', exact: true }).click();
    await a.page.locator('input[name="incident-name"]').fill('E2E River Flood');
    await a.page.locator('input[name="incident-ic"]').fill('K0CJH');
    await a.page.locator('input[name="incident-netfreq"]').fill('146.520');
    await a.page.locator('input[name="incident-site"]').fill('EOC North');
    await local.locator('button[type="submit"]').click();
    await waitLive(a.page);
    check((await a.page.getByTestId('incident-role').textContent()).includes('ADMIN'), 'creator is ADMIN');

    log('A opens Invite: id, join key and a QR code');
    await a.page.getByRole('button', { name: 'Invite', exact: true }).click();
    const id = (await a.page.getByTestId('incident-id').textContent()).replace(/-/g, '');
    const joinKey = (await a.page.getByTestId('incident-join-key').textContent()).replace(/-/g, '');
    check(/^[A-Z2-9]{8}$/.test(id) && /^[A-Z2-9]{16}$/.test(joinKey), `id ${id} and a 16-char join key shown`);
    check((await a.page.locator('[data-testid="incident-panel"] svg').count()) > 0, 'QR code rendered');

    log('B opens the invite link (in another layout) and joins');
    await b.page.goto(`${BASE}/#incident=${id}&key=${joinKey}`, { waitUntil: 'domcontentloaded' });
    const bLocal = b.page.getByTestId('incident-panel-local');
    await bLocal.waitFor({ timeout: T });
    check(!(await b.page.evaluate(() => location.hash)), 'key taken out of the address bar');
    check((await b.page.locator('input[name="incident-id"]').inputValue()) === id, 'join form pre-filled');
    await b.page.locator('input[name="incident-site"]').fill('EOC South');
    await bLocal.locator('button[type="submit"]').click();
    await waitLive(b.page);
    check((await b.page.getByTestId('incident-role').textContent()).includes('OPERATOR'), 'joiner is OPERATOR');
    await participants(a.page).filter({ hasText: '2 connected' }).waitFor({ timeout: T });
    check(true, 'A sees 2 connected');
    const streamUrls = [];
    b.page.on('request', (r) => /\/api\/incident\/[^/]+\/stream/.test(r.url()) && streamUrls.push(r.url()));

    log('B checks in a voice station; A sees it live');
    await b.page.locator('input[name="checkin-call"]').fill('KD0ABC');
    await b.page.locator('input[name="checkin-status"]').fill('At shelter [Beds 30/100]');
    await b.page.getByRole('button', { name: 'Check in', exact: true }).click();
    await rosterRow(a.page, 'KD0ABC').waitFor({ timeout: T });
    check((await rosterRow(a.page, 'KD0ABC').textContent()).includes('@EOC South'), 'roster row tagged with B’s site');
    await eventRows(a.page, 'KD0ABC').first().waitFor({ timeout: T });
    check(true, 'check-in event in A’s shared log');

    log('Message traffic from two sites; the shared ICS 309 numbers it per site');
    // A messages KD0ABC from the roster. The APRS send is answered here — never a radio.
    await a.page.route('**/api/aprs/message', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
    );
    await rosterRow(a.page, 'KD0ABC').getByRole('button', { name: 'MSG', exact: true }).click();
    await a.page.getByPlaceholder('Type message (67 char max)').fill('Go to shelter 2');
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    // A message station at "South" logs a received message numbered 7 there (a script, through the API).
    const south = await fetch(`${BASE}/api/incident/${id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Incident-Key': joinKey },
      body: JSON.stringify({
        site: 'South',
        events: [
          {
            id: 'south-rx-1',
            ts: Date.now(),
            type: 'aprs_msg_rx',
            callsign: 'KD0ABC',
            summary: 'Message to W1AW',
            details: 'Need water at shelter 2',
            msgNo: 7,
          },
        ],
      }),
    });
    check(south.ok, 'South’s message accepted by the incident');
    await eventRows(a.page, 'Message to KD0ABC').first().waitFor({ timeout: T });
    await eventRows(b.page, 'Message to KD0ABC').first().waitFor({ timeout: T });
    await eventRows(a.page, 'Message to W1AW').first().waitFor({ timeout: T });

    const ics309A = await openIcs(a.page, '309 Comm Log');
    const numsA = await msgNumbers(ics309A);
    const textA = await inputValues(ics309A);
    check(
      textA.includes('Go to shelter 2') && textA.includes('Need water at shelter 2'),
      'A’s 309 lists both sites’ traffic',
    );
    check(numsA.includes('South:7'), `A’s 309 shows South’s message as South:7 (${numsA.filter(Boolean).join(', ')})`);
    check(
      numsA.some((n) => /^\d+$/.test(n)),
      'A’s own message keeps A’s own plain number',
    );
    await closeIcs(a.page);
    const ics309B = await openIcs(b.page, '309 Comm Log');
    const numsB = await msgNumbers(ics309B);
    check(numsB.includes('South:7'), 'B’s 309 shows South:7 too');
    check(
      numsB.some((n) => /^EOC North:\d+$/.test(n)),
      `B shows A’s message under A’s site (${numsB.filter(Boolean).join(', ')})`,
    );
    await closeIcs(b.page);

    log('A fills in the ICS 214; B opens the same shared draft');
    const ics214A = await openIcs(a.page, '214 Activity Log');
    await ics214A.getByLabel('Name', { exact: true }).first().fill('K0CJH Logistics');
    await a.page.waitForTimeout(800); // the panel saves after a short pause
    await closeIcs(a.page);
    const ics214B = await openIcs(b.page, '214 Activity Log');
    await b.page.waitForFunction(
      () => [...document.querySelectorAll('[role="dialog"] input')].some((e) => e.value === 'K0CJH Logistics'),
      null,
      { timeout: T },
    );
    check(true, 'B’s 214 shows A’s entry');
    void ics214B;
    await closeIcs(b.page);

    log('A checks the station OUT; it leaves B’s roster');
    await rosterRow(a.page, 'KD0ABC').getByRole('button', { name: 'OUT', exact: true }).click();
    await rosterRow(b.page, 'KD0ABC').waitFor({ state: 'detached', timeout: T });
    check(true, 'gone from B’s roster');

    log('A (admin) edits the board; B (operator) has no Edit');
    check(
      (await b.page.getByTestId('incident-panel').getByRole('button', { name: 'Edit', exact: true }).count()) === 0,
      'no Edit button for the operator',
    );
    await a.page.getByTestId('incident-panel').getByRole('button', { name: 'Edit', exact: true }).click();
    await a.page.locator('textarea[name="board-notes"]').fill('Shelter open at the high school');
    await a.page.getByRole('button', { name: 'Save', exact: true }).click();
    await b.page
      .getByTestId('incident-board')
      .filter({ hasText: 'Shelter open at the high school' })
      .waitFor({ timeout: T });
    check(true, 'board change reached B');
    await railShot(a.page, 'incident-rail-desktop.jpg');
    // Close-up of the Incident panel (header included) for the manual.
    await a.page
      .getByTestId('incident-panel')
      .locator('xpath=../..')
      .screenshot({ path: join(SHOTS, 'emcomm-incident.jpg'), type: 'jpeg', quality: 85 });

    log('A starts a voice net in Net Control; B sees the same running net');
    await a.page.getByLabel('Net name (e.g. County ARES Weekly Net)').fill('E2E ARES Net');
    await a.page.getByRole('button', { name: /Start net/ }).click();
    await a.page.getByLabel('Check in a station').fill('W9NET');
    await a.page.getByLabel('Check in a station').press('Enter');
    await b.page.getByText('E2E ARES Net').first().waitFor({ timeout: T });
    await b.page.getByText('W9NET').first().waitFor({ timeout: T });
    check(true, 'B’s Net Control shows A’s running net and its check-in');
    check(
      (await a.page.getByText(/Also open in another tab or panel/).count()) === 0,
      'the incident bridge is not counted as another Net Control panel',
    );

    log('Both change W9NET while offline; A (clock +10 min) reaches the server first: the server’s order decides');
    const ncRow = (page) => page.locator('[data-testid="nc-station"][data-call="W9NET"]');
    await ncRow(b.page).waitFor({ timeout: T });
    const debugLog = [];
    if (process.env.E2E_DEBUG) {
      for (const [who, page] of [
        ['A', a.page],
        ['B', b.page],
      ]) {
        page.on('requestfinished', async (r) => {
          if (!/\/api\/incident\//.test(r.url())) return;
          const body = r.postData() || '';
          const docs = body.includes('net-running') ? 'net-running' : '';
          debugLog.push(
            `${who} ${r.method()} ${r.url().replace(BASE, '').split('?')[0]} ${docs} ${(await r.response())?.status()}`,
          );
        });
        page.on(
          'requestfailed',
          (r) =>
            /\/api\/incident\//.test(r.url()) &&
            debugLog.push(`${who} FAILED ${r.url().replace(BASE, '').split('?')[0]}`),
        );
      }
    }
    // From here A's clock runs 10 minutes fast.
    await a.page.evaluate(() => (globalThis.__clockSkewMs = 10 * 60 * 1000));
    // Offline, so neither sees the other's change before making its own.
    await a.context.setOffline(true);
    await b.context.setOffline(true);
    await ncRow(a.page).getByTitle('Traffic', { exact: true }).click();
    await b.page.waitForTimeout(50); // B's change is the later one
    await ncRow(b.page).getByTitle('Mobile', { exact: true }).click();
    // A's change reaches the server first, B's second. A's clock says A's is
    // ten minutes later — the server's order must win anyway.
    await a.context.setOffline(false);
    for (let waited = 0; ; waited += 250) {
      const r = await fetch(`${BASE}/api/incident/${id}`, { headers: { 'X-Incident-Key': joinKey } });
      const net = (await r.json()).docs?.find((d) => d.id === 'net-running');
      const w9 = net?.data?.net?.stations?.find((x) => x.call === 'W9NET');
      if (w9?.flags?.includes('traffic')) break;
      if (waited > 30_000) throw new Error('FAILED: A’s change never reached the server');
      await a.page.waitForTimeout(250);
    }
    await b.context.setOffline(false);
    const pressed = async (page, title) =>
      (await ncRow(page).getByTitle(title, { exact: true }).getAttribute('aria-pressed')) === 'true';
    const flags = async (page) => [await pressed(page, 'Traffic'), await pressed(page, 'Mobile')].join(',');
    const chipA = a.page.getByTestId('net-conflict-W9NET');
    const chipB = b.page.getByTestId('net-conflict-W9NET');
    for (let waited = 0; (await chipA.count()) + (await chipB.count()) === 0; waited += 500) {
      if (waited > 60_000) {
        const r = await fetch(`${BASE}/api/incident/${id}`, { headers: { 'X-Incident-Key': joinKey } });
        const net = (await r.json()).docs?.find((d) => d.id === 'net-running');
        const w9 = net?.data?.net?.stations?.find((x) => x.call === 'W9NET');
        if (debugLog.length) console.log(debugLog.join('\n'));
        throw new Error(
          `FAILED: no "your change" chip at either site (A: ${await flags(a.page)}, B: ${await flags(b.page)}; ` +
            `server: ${JSON.stringify(w9?.flags)} tag ${net?.data?.tag} from ${net?.data?.origin?.site} rev ${net?.docRev})`,
        );
      }
      await a.page.waitForTimeout(500);
    }
    await a.page.waitForTimeout(3000); // let both sides settle
    const [onA, onB] = [await chipA.count(), await chipB.count()];
    check(onA + onB === 1, `exactly one site shows the chip (A: ${onA}, B: ${onB})`);
    check(
      (await flags(a.page)) === (await flags(b.page)),
      `both sites show the same W9NET flags (${await flags(a.page)})`,
    );
    check(
      onA === 1 && (await flags(a.page)) === 'false,true',
      'B’s change, received second by the server, stands although A’s clock is 10 min ahead; A is offered its own',
    );
    check((await chipA.textContent()).includes('EOC South'), 'the chip names the other site');

    log('A applies its change from the chip');
    await chipA.getByRole('button', { name: 'Apply mine', exact: true }).click();
    for (let waited = 0; (await flags(b.page)) !== 'true,false'; waited += 500) {
      if (waited > 30_000) {
        throw new Error(
          `FAILED: Apply mine did not reach B (A: ${await flags(a.page)}, chip ${await chipA.count()}; B: ${await flags(b.page)})`,
        );
      }
      await b.page.waitForTimeout(500);
    }
    check((await flags(a.page)) === 'true,false', 'A’s change is back at A');
    check((await flags(b.page)) === 'true,false', 'and reached B');
    check((await chipA.count()) === 0, 'the chip is gone');
    await a.page.evaluate(() => (globalThis.__clockSkewMs = 0)); // A's clock right again

    log('B goes offline, checks in; the update waits and flushes on reconnect');
    await b.context.setOffline(true);
    await b.page.locator('input[name="checkin-call"]').fill('N0OFF');
    await b.page.getByRole('button', { name: 'Check in', exact: true }).click();
    await b.page.getByTestId('incident-pending').waitFor({ timeout: T });
    check(true, `B shows "${(await b.page.getByTestId('incident-pending').textContent()).trim()}"`);
    await a.page.waitForTimeout(3000);
    check((await rosterRow(a.page, 'N0OFF').count()) === 0, 'A does not have it while B is offline');
    await b.context.setOffline(false);
    await rosterRow(a.page, 'N0OFF').waitFor({ timeout: 40_000 });
    await b.page.getByTestId('incident-pending').waitFor({ state: 'detached', timeout: T });
    check(true, 'flushed on reconnect; B’s buffer empty');

    log('A (admin) deletes B’s N0OFF check-in event for everyone');
    const before = await eventRows(b.page, 'N0OFF').count();
    check(before >= 1, `B sees the N0OFF event (${before})`);
    await eventRows(a.page, 'N0OFF')
      .first()
      .getByRole('button', { name: /Delete this entry/ })
      .click();
    await b.page.waitForFunction(
      (n) =>
        [...document.querySelectorAll('[data-testid="event-row"]')].filter((r) => r.textContent.includes('N0OFF'))
          .length < n,
      before,
      { timeout: T },
    );
    check(true, 'deleted on B too');

    log('B reloads: no duplicates');
    const countKd = await eventRows(b.page, 'KD0ABC').count();
    const countAll = await b.page.getByTestId('event-row').count();
    await b.page.reload({ waitUntil: 'domcontentloaded' });
    await waitLive(b.page);
    await b.page.waitForTimeout(3000);
    check((await eventRows(b.page, 'KD0ABC').count()) === countKd, `KD0ABC events unchanged (${countKd})`);
    check((await b.page.getByTestId('event-row').count()) === countAll, `log length unchanged (${countAll})`);
    console.log(`    (incident stream requests: ${streamUrls.map((u) => u.replace(BASE, '')).join(', ')})`);
    check(
      streamUrls.length > 0 && streamUrls.every((u) => !u.includes(joinKey) && u.includes('ticket=')),
      'incident stream URLs carry a ticket, never the key',
    );

    log('Phone-width screenshot (390×844)');
    const phone = await station(browser, { call: 'KD0PHN', viewport: { width: 390, height: 844 } });
    await phone.page.goto(`${BASE}/#incident=${id}&key=${joinKey}`, { waitUntil: 'domcontentloaded' });
    await phone.page.getByTestId('incident-panel-local').locator('button[type="submit"]').click();
    await waitLive(phone.page);
    await railShot(phone.page, 'incident-rail-390.jpg');
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log(`    (phone: horizontal overflow ${overflow}px)`);
    await phone.page.getByRole('button', { name: 'Leave', exact: true }).click();
    await phone.page.getByTestId('incident-panel-local').waitFor({ timeout: T });
    await phone.context.close();

    log('A rotates the join key: B is disconnected and asked to rejoin');
    await a.page.getByRole('button', { name: 'New key', exact: true }).click();
    await b.page.getByTestId('incident-panel-local').waitFor({ timeout: T });
    check((await b.page.locator('input[name="incident-id"]').inputValue()) === id, 'B’s join form keeps the id');
    await a.page.waitForFunction(
      (old) =>
        (document.querySelector('[data-testid="incident-join-key"]')?.textContent || '').replace(/-/g, '') !== old,
      joinKey,
      { timeout: T },
    );
    const newKey = (await a.page.getByTestId('incident-join-key').textContent()).replace(/-/g, '');
    check(newKey !== joinKey, 'A shows the new key');
    await b.page.locator('input[name="incident-key"]').fill(newKey);
    await b.page.getByTestId('incident-panel-local').locator('button[type="submit"]').click();
    await waitLive(b.page);
    check(true, 'B rejoined with the new key');

    log('B leaves; A’s count drops');
    await b.page.getByRole('button', { name: 'Leave', exact: true }).click();
    await b.page.getByTestId('incident-panel-local').waitFor({ timeout: T });
    await status(b.page).filter({ hasText: 'LOCAL' }).waitFor({ timeout: T });
    await participants(a.page).filter({ hasText: '1 connected' }).waitFor({ timeout: T });
    check(true, 'B is LOCAL and A shows 1 connected');

    log('A deputy joins with the admin key on another device and can invite straight away');
    await a.page.getByRole('button', { name: 'Show admin key', exact: true }).click();
    const adminKey = (await a.page.getByTestId('incident-admin-key').textContent()).replace(/-/g, '');
    const currentJoin = (await a.page.getByTestId('incident-join-key').textContent()).replace(/-/g, '');
    const deputy = await station(browser, { call: 'N0DEP' });
    await deputy.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const dLocal = deputy.page.getByTestId('incident-panel-local');
    await dLocal.getByRole('button', { name: 'Join', exact: true }).click();
    await deputy.page.locator('input[name="incident-id"]').fill(id);
    await deputy.page.locator('input[name="incident-key"]').fill(adminKey);
    await dLocal.locator('button[type="submit"]').click();
    await waitLive(deputy.page);
    check((await deputy.page.getByTestId('incident-role').textContent()).includes('ADMIN'), 'deputy is ADMIN');
    await deputy.page.getByRole('button', { name: 'Invite', exact: true }).click();
    const deputyJoin = (await deputy.page.getByTestId('incident-join-key').textContent()).replace(/-/g, '');
    check(deputyJoin === currentJoin, 'deputy’s Invite shows the current join key without rotating');
    await deputy.page.getByRole('button', { name: 'Leave', exact: true }).click();
    await deputy.page.getByTestId('incident-panel-local').waitFor({ timeout: T });
    await deputy.context.close();

    log('A has a second tab open; leaving in the first takes the second out too');
    const a2 = await a.context.newPage();
    a2.on('dialog', (d) => d.accept());
    await a2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitLive(a2);
    check(true, 'second tab joined from the stored session');
    await a.page.getByRole('button', { name: 'Leave', exact: true }).click();
    await status(a.page).filter({ hasText: 'LOCAL' }).waitFor({ timeout: T });
    await status(a2).filter({ hasText: 'LOCAL' }).waitFor({ timeout: T });
    check(true, 'both tabs are LOCAL');

    console.log('\nAll checks passed.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
