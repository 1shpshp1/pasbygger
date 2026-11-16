/* The app in a real browser (index.html from this folder), with the server simulated (sheet-sim.js).
   Needs Playwright and its Chromium; skipped with a message if they are not installed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { testServer, CODE } = require('./fixtures.js');

let playwright = null;
try { playwright = require('playwright'); } catch (e) {
  try { playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); } catch (e2) { /* not installed */ }
}
const skip = playwright ? false : 'Playwright is not installed (npm install playwright, then npx playwright install chromium)';

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let site, base, browser;

test.before(async () => {
  if (skip) return;
  site = http.createServer((req, res) => {               // the app's files, as GitHub Pages would serve them
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+$/, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(ok => site.listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + site.address().port + '/';
  const exe = process.env.PW_CHROMIUM;
  browser = await playwright.chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { if (browser) await browser.close(); if (site) site.close(); });

/* A phone with the app open on the trainings list, talking to the simulated server */
async function phone(srv, { width = 390, loggedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 } });
  await ctx.route('https://script.google.com/**', r => {
    const body = r.request().postData();
    const action = JSON.parse(body).action;
    (srv.calls = srv.calls || []).push(action);
    if ((srv.dropped || []).includes(action)) return r.abort('failed');   // the connection drops
    if ((srv.unknown || []).includes(action)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: 'Unknown action: ' + action }) });
    if ((srv.broken || {})[action]) return r.fulfill({ contentType: 'text/html', body: srv.broken[action] });   // Google's error page
    const reply = srv.post(body);
    if (srv.oldServer && reply.result) delete reply.result.server;   // a deployed copy from before the version numbers
    const answer = JSON.stringify(reply);
    if ((srv.slow || []).includes(action)) return setTimeout(() => r.fulfill({ contentType: 'application/json', body: answer }), 1500);
    r.fulfill({ contentType: 'application/json', body: answer });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(base);
  await page.waitForSelector('#sessions .card', { timeout: 15000 });
  if (loggedIn) {
    await page.click('#nav-library');
    await page.fill('#login-pw', CODE);
    await page.click('#login-go');
    await page.waitForFunction(() => isAuthed());
    await page.click('#nav-sessions');
  }
  return page;
}
async function openGroups(page, i = 0) {
  await page.locator('#sessions .card').nth(i).locator('button, [onclick]').first().click();
  await page.locator('#viewer button', { hasText: 'Grupper/kampe til denne træning' }).click();
  await page.waitForSelector('#grp-v .grp-slide');
}
const cards = page => page.locator('#grp-v .grp-list .grp-card');
const sizes = async page => (await cards(page).evaluateAll(cs => cs.map(c => c.querySelectorAll('.grp-p').length)));

test('login box and the "no groups yet" message', { skip }, async () => {
  const page = await phone(testServer(), { loggedIn: false });
  await page.click('#nav-library');
  assert.equal(await page.locator('#login-title').innerText(), 'Indtast kode');
  await page.click('#login-cancel');
  await page.evaluate(() => showView('sessions'));
  await page.locator('#sessions .card').first().locator('button, [onclick]').first().click();
  await page.locator('#viewer button', { hasText: 'Grupper/kampe til denne træning' }).click();
  assert.ok(await page.locator('#login').isVisible(), 'Grupper asks for the code first');
  await page.fill('#login-pw', CODE); await page.click('#login-go');
  await page.waitForSelector('#grp-v .grp-slide');
  assert.match(await page.locator('#grp-v .grp-none').innerText(), /ikke lavet grupper til denne træning/);
  assert.equal(await page.locator('#grp-v .grp-who .grp-band').count(), 0, 'no levels in "Hvem er med?"');
  const xs = await page.locator('#grp-v .grp-who label').evaluateAll(ls => [...new Set(ls.map(l => Math.round(l.getBoundingClientRect().left)))]);
  assert.equal(xs.length, 1, '"Hvem er med?" is one column');
  assert.deepEqual(page.errors, []);
});

test('Bånd: make, save, reopen, and asked before replacing', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-rule="band"]');
  await page.click('#grp-v [data-act="make"]');
  assert.equal(await cards(page).count(), 4);
  assert.equal(await page.locator('#grp-v .grp-card.bad').count(), 0);
  // (sizes can't be even for this squad: Jonas and Karla, 4–5, only fit with Ida, so their group has 3)
  assert.equal((await sizes(page)).reduce((x, y) => x + y, 0), 16, 'every player is in a group');
  await page.click('#grp-v [data-act="save"]');
  await page.waitForFunction(() => /Gemt/.test(document.querySelector('#grp-v .grp-save').innerText));
  assert.equal(srv.book['Grupper'].getLastRow() - 1, 16);
  await page.click('#v-back'); await page.click('#v-back');
  await openGroups(page);
  assert.equal(await cards(page).count(), 4, 'the saved groups come back');
  await page.click('#grp-v [data-act="make"]');
  assert.ok(await page.locator('#grp-v .grp-ask').isVisible(), 'asks before replacing the groups');
  assert.deepEqual(page.errors, []);
});

test('the login running out never stops the work; saving asks for the code', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await openGroups(page);
  await page.evaluate(() => { AUTH.until = Date.now() - 1000; expire(); });
  await page.locator('#grp-v [data-who="2"]').uncheck();
  assert.match(await page.locator('#grp-v summary').innerText(), /15 af 16/);
  await page.click('#grp-v [data-act="make"]');
  assert.equal(await cards(page).count(), 4);
  await page.click('#grp-v [data-act="save"]');
  assert.ok(await page.locator('#login').isVisible());
  await page.fill('#login-pw', CODE); await page.click('#login-go');
  await page.waitForFunction(() => /Gemt/.test(document.querySelector('#grp-v .grp-save').innerText));
  assert.equal(srv.book['Grupper'].getLastRow() - 1, 15);
  assert.deepEqual(page.errors, []);
});

test('Gem tilmeldte: another phone starts from the saved signups', { skip }, async () => {
  const srv = testServer();
  const home = await phone(srv);
  await openGroups(home);
  for (const i of [1, 4, 9]) await home.locator(`#grp-v [data-who="${i}"]`).uncheck();
  await home.click('#grp-v [data-act="signups"]');
  await home.waitForFunction(() => /Tilmeldte gemt/.test(document.querySelector('#grp-v').innerText));
  const pitch = await phone(srv);
  await openGroups(pitch);
  assert.match(await pitch.locator('#grp-v summary').innerText(), /13 af 16/);
  assert.match(await pitch.locator('#grp-v .grp-none').innerText(), /13 tilmeldte/);
  assert.deepEqual(home.errors.concat(pitch.errors), []);
});

test('Niveau (the middle of the band): group 1 holds the most experienced; cards, matches and Spilleroversigt show Niveau', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  assert.deepEqual(await page.locator('#grp-v [data-rule]').allInnerTexts(), ['Bånd', 'Niveau', 'Kaos', 'Lige hold']);
  await page.click('#grp-v [data-rule="max"]');
  assert.deepEqual(await page.locator('#grp-v [data-diff]').allInnerTexts(), ['0', '0,5', '1', '1,5', '2']);
  await page.click('#grp-v [data-act="make"]');
  const names = i => cards(page).nth(i).locator('.grp-p').evaluateAll(bs => bs.map(b => b.dataset.p).sort());
  assert.deepEqual(await names(0), ['Alma', 'Bo', 'Carl', 'Noah']);          // niveau 1,5 1,5 2 1,5
  // group 2: Dina, Emil and Lucas (2–3 → 2,5) and one of Frida (2–4 → 3) and Pelle (2–4 → 3); by Fra it would be the 2s
  const second = await names(1);
  assert.deepEqual(second.filter(n => ['Dina', 'Emil', 'Lucas'].includes(n)), ['Dina', 'Emil', 'Lucas']);
  assert.match(await cards(page).nth(0).locator('.grp-head').innerText(), /niveau 1,5–2/);
  assert.match(await cards(page).nth(1).locator('.grp-head').innerText(), /niveau 2,5–3/);
  assert.equal(await page.locator('#grp-v input[type=range]').count(), 0, 'no slider with Niveau');
  await page.click('#grp-v [data-act="matches"]');
  const chip = page.locator('#grp-v .grp-matches .grp-p', { hasText: 'Carl' });
  assert.equal(await chip.locator('.grp-band').innerText(), '2', 'Carl (1–3) plays at niveau 2');
  await page.click('#viewer-close').catch(() => {});
  await page.goto(page.url());
  await page.waitForSelector('#sessions .card');
  await page.click('#nav-groups'); await page.click('#grp-overview');
  await page.waitForSelector('#ov .ov-p');
  assert.match(await page.locator('#ov .ov-p', { hasText: 'Pelle' }).locator('.grp-band').innerText(), /^2–4 · niveau 3$/);
  assert.match(await page.locator('#ov .ov-p', { hasText: 'Alma' }).locator('.grp-band').innerText(), /^1–2 · niveau 1,5$/);
  assert.match(await page.locator('#ov .ov-how').textContent(), /midten af båndet/);
  assert.match(await page.locator('#ov .ov-key').first().innerText(), /↑\s*spiller op\s*=\s*samme niveau\s*↓\s*spiller ned/);
  const card = name => page.locator('#ov .ov-p').filter({ has: page.locator('strong', { hasText: new RegExp('^' + name + '$') }) });
  for (const [name, aim, why] of [['Alma', '0 / 75 / 25', /Ingen er mere øvede/], ['Jonas', '25 / 75 / 0', /Ingen er mindre øvede/], ['Frida', '25 / 50 / 25', null]]) {
    const c = card(name), goals = await c.locator('.ov-val.ov-goal').allInnerTexts();
    const [u, e, d] = aim.split(' / '), want = `↑\u202f${u} · =\u202f${e} · ↓\u202f${d} %`;
    assert.deepEqual(goals, [want, want], name + ': the aim for groups and matches, for everyone, with arrows');
    assert.deepEqual(await c.locator('.ov-lab').allInnerTexts(), ['Faktisk', 'Mål', 'Faktisk', 'Mål'], name + ': each bar says what it is');
    assert.equal(await c.locator('.ov-aim').count(), 2, name + ': an aim bar under both');
    if (why) assert.match(await c.innerText(), why); else assert.doesNotMatch(await c.innerText(), /Ingen er|Få er/);
  }
  // the aim bar's parts are the aim (Alma: 0 / 75 / 25)
  assert.deepEqual(await card('Alma').locator('.ov-aim').first().locator('span').evaluateAll(ss => ss.map(x => Math.round(parseFloat(x.style.width)))), [0, 75, 25]);
  assert.deepEqual(page.errors, []);
});

test('Kampe til sidst: 3 groups give 2 matches with opposite numbers side by side', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-rule="max"]');
  await page.click('#grp-v [data-act="minus"]');
  await page.click('#grp-v [data-act="make"]');
  await page.click('#grp-v [data-act="matches"]');
  const ms = page.locator('#grp-v .grp-matches .grp-card');
  assert.equal(await ms.count(), 2);
  const rows = await ms.first().locator('.grp-pairs .grp-p').count();
  assert.equal(rows, 8, 'Kamp 1 has 4 against 4');
  assert.deepEqual(page.errors, []);
});

test('the Grupper tab saves groups for a date without a training', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await page.click('#nav-groups');
  await page.waitForSelector('#grp-tab .grp-slide');
  await page.click('#grp-tab [data-act="make"]');
  await page.click('#grp-tab [data-act="save"]');
  await page.waitForFunction(() => /Gemt/.test(document.querySelector('#grp-tab .grp-save').innerText));
  const key = srv.book['Grupper'].getRange(2, 1).getDisplayValue();
  assert.match(key, /^\d{4}-\d{2}-\d{2} fri$/);
});

test('a Rinus drill opens on Rinus with the translation tip', { skip }, async () => {
  const page = await phone(testServer());
  await page.click('#nav-library');
  await page.waitForSelector('#drill-grid .card');
  await page.locator('#drill-grid .card h3').first().click();
  const text = await page.locator('#v-pages').innerText();
  assert.match(text, /Åbn øvelsen hos KNVB Rinus/);
  assert.match(text, /På hollandsk/);
});

test('no sideways scrolling on small phones', { skip }, async () => {
  for (const width of [320, 390]) {
    const page = await phone(testServer(), { width });
    await openGroups(page);
    await page.click('#grp-v [data-act="make"]');
    await page.click('#grp-v [data-act="matches"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `width ${width}`);
  }
});

test('no connection: groups are kept on the phone and sent when it comes back', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  await page.context().setOffline(true);
  await page.click('#grp-v [data-act="save"]');
  assert.match(await page.locator('#grp-v .grp-save').innerText(), /Gemt på telefonen/);
  assert.equal(srv.book['Grupper'].getLastRow(), 1, 'nothing reached the sheet yet');
  await page.click('#v-back'); await page.click('#v-back');
  await openGroups(page);
  assert.equal(await cards(page).count(), 4, 'reopened offline, the kept groups are shown');
  await page.context().setOffline(false);                 // the phone comes back online
  await page.waitForFunction(() => /Gemt \d/.test(document.querySelector('#grp-v .grp-save').innerText), null, { timeout: 10000 });
  assert.equal(srv.book['Grupper'].getLastRow() - 1, 16, 'sent to the sheet');
  assert.equal(await page.evaluate(() => readQueue().length), 0);
  assert.deepEqual(page.errors, []);
});

test('the connection drops while saving: kept, then sent later (also after reopening the app)', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  srv.dropped = ['saveSignups'];
  await openGroups(page);
  await page.locator('#grp-v [data-who="1"]').uncheck();
  await page.click('#grp-v [data-act="signups"]');
  await page.waitForFunction(() => /på telefonen/.test(document.querySelector('#grp-v').innerText));
  srv.dropped = [];
  await page.reload();                                     // the app is closed and opened again
  await page.waitForSelector('#sessions .card');
  await page.waitForFunction(() => readQueue().length === 0, null, { timeout: 10000 });
  assert.equal(srv.book['Tilmeldte'].getLastRow() - 1, 15);
});

test('Spilleroversigt: attendance, level mix and most frequent teammates', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  const t = srv.call('login', CODE).result.token;
  srv.call('saveGroups', t, '2026-10-01', [['Alma', 'Bo', 'Carl'], ['Dina', 'Emil']]);
  srv.call('saveGroups', t, '2026-10-08', [['Alma', 'Bo', 'Dina'], ['Carl', 'Emil']]);
  await page.click('#nav-groups');
  await page.click('#grp-overview');
  await page.waitForSelector('#ov .ov-p');
  const card = name => page.locator('#ov .ov-p').filter({ has: page.locator('strong', { hasText: new RegExp('^' + name + '$') }) });
  const alma = card('Alma');
  const text = await alma.innerText();
  assert.match(text, /2 af 2/);
  assert.match(text, /Oftest med: Bo \(2\)/);
  assert.match(text, /Grupper\s*2 træninger\s*Faktisk\s*↑\s*\d+ · =\s*\d+ · ↓\s*\d+ %\s*Mål\s*↑\s*\d+ · =\s*\d+ · ↓\s*\d+ %/);
  assert.match(text, /Kampe til træning\s*ingen gemte kampe endnu/, 'the matches section is there even without saved matches');
  assert.match(await alma.locator('.ov-bars').first().getAttribute('aria-label'), /^Grupper: \d+ % spiller op, \d+ % samme niveau, \d+ % spiller ned\. Mål: \d+ % spiller op, /);
  assert.match(await card('Frida').innerText(), /Ikke med i gemte grupper endnu/);
  assert.equal(await card('Frida').locator('.ov-empty').count(), 2, 'no data: an empty bar, the aim still shown');
  await page.click('#ov [data-sort="times"]');
  const first = await page.locator('#ov .ov-p strong').first().innerText();
  assert.ok(['Alma', 'Bo', 'Carl', 'Dina', 'Emil'].includes(first), 'sorted by attendance: ' + first);
  assert.deepEqual(page.errors, []);
});

test('Kampe: Niveau and 25-50-25, saved, back on reopening, and in the overview', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-rule="max"]');
  await page.click('#grp-v [data-act="make"]');
  await page.click('#grp-v [data-mmode="mix"]');
  assert.match(await page.locator('#grp-v .grp-matches').innerText(), /25 % af kampene i en sværere kamp/);
  await page.click('#grp-v [data-act="matches"]');
  assert.equal(await page.locator('#grp-v .grp-matches .grp-card').count(), 2);
  assert.match(await page.locator('#grp-v .grp-matches .grp-card .grp-head').first().innerText(), /gns\. niveau/);
  await page.click('#grp-v [data-act="save"]');
  await page.waitForFunction(() => /Gemt/.test(document.querySelector('#grp-v .grp-save').innerText));   // (the groups' save line comes first)
  await page.click('#grp-v [data-act="savematches"]');
  await page.waitForFunction(() => /Kampe gemt/.test(document.querySelector('#grp-v .grp-matches').innerText));
  assert.equal(srv.book['Kampe'].getLastRow() - 1, 16);
  await page.click('#v-back'); await page.click('#v-back');
  await openGroups(page);
  assert.equal(await page.locator('#grp-v .grp-matches .grp-card').count(), 2, 'the saved matches come back');
  await page.click('#grp-v [data-mmode="max"]');
  await page.click('#grp-v [data-act="matches"]');
  assert.match(await page.locator('#grp-v .grp-matches .grp-card .grp-head').first().innerText(), /mere øvede/);
  assert.match(await page.locator('#grp-v .grp-matches .grp-save').innerText(), /Ikke gemt/);
  await page.click('#v-back');
  await page.click('.leave-ask [data-leave="drop"]');              // the new matches aren't wanted
  await page.click('#v-back');
  await page.click('#nav-groups'); await page.click('#grp-overview');
  await page.waitForSelector('#ov .ov-p');
  assert.match(await page.locator('#ov').innerText(), /Kampe til træning\s*1 kamp\s*Faktisk\s*↑\s*\d+ · =\s*\d+ · ↓\s*\d+ %/);
  assert.match(await page.locator('#ov .ov-bars').nth(1).getAttribute('aria-label'), /^Kampe til træning: \d+ % spiller op, \d+ % samme niveau, \d+ % spiller ned\./);
  assert.deepEqual(page.errors, []);
});

test('the login running out while the players are being checked doesn\'t break Grupper', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await openGroups(page);                                  // the phone now has a copy of the players
  await page.click('#v-back'); await page.click('#v-back');
  await page.evaluate(() => { GRP_CACHE.at = 0; });       // so the next opening asks the server "anything new?"
  srv.slow = ['getGroupData'];
  await openGroups(page);
  await page.evaluate(() => { AUTH.until = Date.now() - 1000; expire(); });   // runs out while the question is on its way
  await page.waitForTimeout(2000);                         // the answer "unchanged" arrives
  await page.locator('#grp-v [data-who="2"]').uncheck();
  assert.match(await page.locator('#grp-v summary').innerText(), /15 af 16/);
  await page.click('#grp-v [data-act="make"]');
  assert.equal(await cards(page).count(), 4);
  assert.deepEqual(page.errors, []);
});

test('Antal kampe: choosing 3 gives 3 matches from 4 groups', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  assert.equal(await page.locator('#grp-v [data-mcount="0"]').count(), 0, 'no Auto button');
  assert.equal(await page.locator('#grp-v [data-mcount="2"]').getAttribute('aria-pressed'), 'true', '4 groups: 2 matches until a number is chosen');
  await page.click('#grp-v [data-mcount="3"]');
  await page.click('#grp-v [data-act="matches"]');
  assert.equal(await page.locator('#grp-v .grp-matches .grp-card').count(), 3);
  const heads = await page.locator('#grp-v .grp-matches .grp-card .grp-head small').allInnerTexts();
  assert.match(heads[1], /mellem/);
  await page.click('#grp-v [data-mmode="mix"]');
  await page.click('#grp-v [data-act="matches"]');
  assert.equal(await page.locator('#grp-v .grp-matches .grp-card').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(page.errors, []);
});

test('Kampe by hand: swap between matches, move a player, rebalance, and choose sizes', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  await page.click('#grp-v [data-mcount="2"]');
  await page.click('#grp-v [data-act="matches"]');
  const name = sel => page.locator('#grp-v ' + sel + ' .grp-pname').innerText();
  // swap a player in match 1 with one in match 2
  const a = await name('[data-mp="0:0:0"]'), b = await name('[data-mp="1:1:0"]');
  await page.click('#grp-v [data-mp="0:0:0"]'); await page.click('#grp-v [data-mp="1:1:0"]');
  assert.equal(await name('[data-mp="0:0:0"]'), b);
  assert.equal(await name('[data-mp="1:1:0"]'), a);
  // move one player from match 2 to match 1 (match 1 gets bigger)
  await page.click('#grp-v [data-mp="1:0:0"]');
  await page.click('#grp-v [data-mto="0:0"]');
  const count = mi => page.locator(`#grp-v [data-mp^="${mi}:"]`).count();
  assert.equal(await count(0), 9); assert.equal(await count(1), 7);
  // rebalance match 1: still 9 players, teams of 5 and 4
  await page.click('#grp-v [data-mrebal="0"]');
  assert.equal(await count(0), 9);
  assert.equal(Math.abs(await page.locator('#grp-v [data-mp^="0:0:"]').count() - await page.locator('#grp-v [data-mp^="0:1:"]').count()), 1);
  // choose sizes: 3 matches of 6, 4 and 6 players
  await page.click('#grp-v [data-mcount="3"]');
  await page.click('#grp-v [data-msize="custom"]');
  assert.match(await page.locator('#grp-v .grp-sizes').innerText(), /Alle 16 spillere er fordelt/);
  await page.click('#grp-v [data-msz="1:-1"]'); await page.click('#grp-v [data-msz="1:-1"]');
  assert.match(await page.locator('#grp-v .grp-sizes').innerText(), /Fordel 2 spillere mere/);
  assert.equal(await page.locator('#grp-v [data-act="matches"]').isDisabled(), true);
  await page.click('#grp-v [data-msz="2:1"]'); await page.click('#grp-v [data-msz="2:1"]');
  await page.click('#grp-v [data-act="matches"]');
  assert.deepEqual([await count(0), await count(1), await count(2)], [6, 4, 6]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(page.errors, []);
});

test('the plan: "Opdateret kl.", the Opdater button, and a check when returning to the app', { skip }, async () => {
  const srv = testServer(), page = await phone(srv, { loggedIn: false });
  await page.waitForFunction(() => /Opdateret kl\. \d\d:\d\d/.test(document.getElementById('plan-time').textContent));
  const plan = srv.book["Træningspas Efterår '26"], edited = () => srv.ctx.onEdit({ range: { getSheet: () => ({ getName: () => "Træningspas Efterår '26" }) } });
  plan.getRange(2, 5).setValue('Ny fokus');
  edited();
  await page.click('#plan-refresh');
  await page.waitForFunction(() => /Ny fokus/.test(document.getElementById('sessions').innerText));
  srv.calls = [];
  await page.click('#plan-refresh');                         // nothing changed: only "unchanged" comes back
  await page.waitForFunction(() => !PLAN_FETCH);
  assert.deepEqual(srv.calls, ['getPlan']);
  plan.getRange(2, 5).setValue('Endnu en fokus');
  edited();
  await page.evaluate(() => { PLAN_AT = Date.now() - 61000; document.dispatchEvent(new Event('visibilitychange')); });   // back after more than a minute
  await page.waitForFunction(() => /Endnu en fokus/.test(document.getElementById('sessions').innerText));
  assert.deepEqual(page.errors, []);
});

test('the plan still loads from a server without getPlan (before Code.gs is updated)', { skip }, async () => {
  const srv = testServer();
  srv.unknown = ['getPlan'];
  const page = await phone(srv, { loggedIn: false });
  assert.equal(await page.locator('#sessions .card').count(), 3);
  assert.ok(srv.calls.includes('getSessions'));
  assert.deepEqual(page.errors, []);
});

test('"Hvem er med?" is alphabetical, whatever the order in the Spillere tab', { skip }, async () => {
  const srv = testServer();
  srv.book['Spillere'].getRange(18, 1, 1, 3).setValues([['Bertram', '2', '3']]);   // added last in the sheet
  srv.book['Spillere'].getRange(19, 1, 1, 3).setValues([['Ærø', '3', '4']]);
  srv.ctx.clearGroupCache();
  const page = await phone(srv);
  await openGroups(page);
  const names = await page.locator('#grp-v .grp-who label').allInnerTexts();
  assert.deepEqual(names.slice(0, 3), ['Alma', 'Bertram', 'Bo']);
  assert.equal(names[names.length - 1], 'Ærø', 'Danish order: Æ after Z');
  await page.locator('#grp-v .grp-who label', { hasText: 'Bertram' }).locator('input').uncheck();
  assert.match(await page.locator('#grp-v summary').innerText(), /17 af 18/);
  await page.click('#grp-v [data-act="make"]');
  assert.equal(await page.locator('#grp-v .grp-p[data-p="Bertram"]').count(), 0, 'the right player was left out');
  assert.deepEqual(page.errors, []);
});

test('Three teams in a match (winner stays on): chosen per pulje, letters run on, saved', { skip }, async () => {
  const srv = testServer();
  const page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  const sec = page.locator('#grp-v .grp-matches');
  await sec.locator('[data-mpools="2"]').click();
  await sec.locator('[data-msub="1:-1"]').click();               // pulje 2: one match ...
  await sec.locator('[data-mteams="1:3"]').click();              // ... with three teams
  assert.match(await sec.locator('.grp-sizes').innerText(), /Pulje 2\s*−?\s*1 kamp · 8 spillere/);
  await sec.locator('[data-act="matches"]').click();
  const cards = sec.locator('.grp-card');
  assert.equal(await cards.count(), 3);
  assert.deepEqual(await cards.nth(2).locator('.grp-teamhead').evaluateAll(hs => hs.map(h => h.firstChild.textContent.trim())), ['Hold E', 'Hold F', 'Hold G']);
  assert.match(await cards.nth(2).locator('.grp-head').innerText(), /3 hold · vinderen bliver på/);
  assert.equal(await cards.nth(2).locator('.grp-p').count(), 8);
  assert.match(await sec.innerText(), /vinderen bliver på banen mod det tredje/);
  await cards.nth(2).locator('.grp-p').first().click();
  assert.equal(await cards.nth(2).locator('[data-mto]').count(), 2, 'move to either other team');
  await cards.nth(2).locator('.grp-p').first().click();
  await sec.locator('[data-msize="custom"]').click();
  assert.match(await sec.locator('.grp-sizes').last().innerText(), /Kamp 3 · pulje 2\s*−?\s*8 spillere \(3v3v2\)/);
  await sec.locator('[data-mmode="mix"]').click();
  assert.match(await sec.innerText(), /ingen gemte kampe fra tidligere træninger/);
  await sec.locator('[data-act="matches"]').click();
  assert.equal(await cards.nth(2).locator('.grp-teamhead').count(), 3);
  await sec.locator('[data-act="savematches"]').click();
  await page.waitForFunction(() => /Kampe gemt/.test(document.querySelector('#grp-v .grp-matches').innerText));
  const saved = Object.values(srv.call('getGroupData', srv.call('login', CODE).result.token).result.matches)[0].matches;
  assert.deepEqual(saved.map(m => m.length), [2, 2, 3]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await cards.nth(2).screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  assert.deepEqual(page.errors, []);
});

test('A script error on the server is shown as it is, not as "Ingen forbindelse"', { skip }, async () => {
  const srv = testServer();
  const page = await phone(srv);
  srv.broken = { getPlan: '<!DOCTYPE html><html><head><script>var x = 1;</script><style>b{}</style></head><body><div>Error</div>' +
    '<div>SyntaxError: Identifier &#39;PLAYERS_SHEET&#39; has already been declared (line 1, file &quot;Grupper&quot;)</div></body></html>' };
  await page.click('#plan-refresh');
  await page.waitForFunction(() => /Fejl på serveren/.test(document.getElementById('plan-time').textContent));
  const bar = await page.locator('#plan-time').innerText();
  assert.match(bar, /^Fejl på serveren: SyntaxError: Identifier 'PLAYERS_SHEET' has already been declared \(line 1, file "Grupper"\) – viser planen fra kl\. \d\d:\d\d$/);
  srv.broken = {};
  srv.dropped = ['getPlan'];                                       // a real lack of connection still says so
  await page.click('#plan-refresh');
  await page.waitForFunction(() => /^Ingen forbindelse/.test(document.getElementById('plan-time').textContent));
  assert.deepEqual(page.errors, []);
});

test('Gem grupper / Gem tilmeldte / Gem kampe register at once and reach the sheet in the background', { skip }, async () => {
  const srv = testServer();
  const page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  srv.slow = ['saveGroups', 'saveSignups', 'saveMatches'];
  await page.click('#grp-v [data-act="save"]');
  const t0 = Date.now();
  await page.waitForFunction(() => /sendes til arket/.test(document.querySelector('#grp-v .grp-save').innerText));
  assert.ok(Date.now() - t0 < 1000, 'registered before the server answers');
  assert.equal(await page.locator('#grp-v [data-act="save"]').isDisabled(), true);
  await page.click('#grp-v details summary');
  await page.click('#grp-v [data-act="signups"]');                 // and the screen can be used meanwhile
  await page.click('#grp-v [data-act="matches"]');
  await page.click('#grp-v [data-act="savematches"]');
  await page.waitForFunction(() => /Kampe gemt/.test(document.querySelector('#grp-v .grp-matches').innerText), null, { timeout: 15000 });
  assert.match(await page.locator('#grp-v .grp-save').first().innerText(), /Gemt \d/);
  assert.match(await page.locator('#grp-v details').evaluate(d => d.textContent), /Tilmeldte gemt \d/);
  const t = srv.call('login', CODE).result.token, d = srv.call('getGroupData', t).result;
  assert.equal(Object.keys(d.history).length, 1);
  assert.equal(Object.keys(d.signups).length, 1);
  assert.equal(Object.keys(d.matches).length, 1);
  // the server refuses: the screen says why and the groups can be saved again
  srv.slow = [];
  srv.unknown = ['saveGroups'];
  await page.locator('#grp-v .grp-card .grp-p').first().click();
  await page.locator('#grp-v .grp-card').nth(1).locator('.grp-p').first().click();   // a swap: not saved
  await page.click('#grp-v [data-act="save"]');
  await page.waitForFunction(() => /Kunne ikke gemme grupperne: Unknown action/.test(document.getElementById('grp-v').innerText));
  assert.equal(await page.locator('#grp-v [data-act="save"]').isDisabled(), false);
  assert.deepEqual(page.errors, []);
});

test('An old server copy: coaches are told what to copy; players see nothing', { skip }, async () => {
  const srv = testServer();
  srv.oldServer = true;
  const guest = await phone(srv, { loggedIn: false });
  await guest.click('#plan-refresh');
  await guest.waitForFunction(() => /Opdateret/.test(document.getElementById('plan-time').textContent));
  assert.equal(await guest.locator('#server-note').isHidden(), true, 'not for players');
  const page = await phone(srv);
  await page.click('#plan-refresh');
  await page.waitForFunction(() => !document.getElementById('server-note').hidden);
  assert.match(await page.locator('#server-note').innerText(), /Serveren er ikke opdateret[\s\S]*Code\.gs/);
  assert.deepEqual(await page.locator('#server-note a').evaluateAll(as => as.map(a => a.getAttribute('href'))),
    ['Code.gs', 'Grupper.gs'].map(f => 'https://github.com/1shpshp1/pasbygger/blob/main/apps-script/' + f));
  await openGroups(page);
  await page.waitForFunction(() => /Grupper\.gs/.test(document.getElementById('grp-v').innerText));
  srv.oldServer = false;                                           // updated: the note goes once both files have answered
  await page.click('#v-back'); await page.click('#v-back');
  await openGroups(page);
  await page.waitForFunction(() => !/Grupper\.gs/.test(document.getElementById('grp-v').innerText));   // (Code.gs until the plan is fetched)
  await page.click('#v-back'); await page.click('#v-back');
  await page.click('#plan-refresh');
  await page.waitForFunction(() => document.getElementById('server-note').hidden);
  assert.deepEqual(page.errors, []);
});

test('Leaving unsaved groups or matches asks first: Bliv, Luk uden at gemme, Gem og luk', { skip }, async () => {
  const srv = testServer();
  const page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  await page.click('#v-back');
  const ask = page.locator('.leave-ask');
  assert.match(await ask.innerText(), /Grupperne er ikke gemt/);
  await ask.locator('[data-leave="stay"]').click();
  assert.equal(await page.locator('#grp-v').count(), 1, 'still on the groups');
  await page.click('#grp-v [data-act="matches"]');
  await page.keyboard.press('Escape');                             // Escape is "Tilbage" too
  assert.match(await ask.innerText(), /Grupperne og kampene er ikke gemt/);
  await ask.locator('[data-leave="save"]').click();
  await page.waitForFunction(() => !document.getElementById('grp-v'));
  await page.click('#v-back');                                     // from the training back to the list
  const t = srv.call('login', CODE).result.token;
  await page.waitForFunction(() => !localStorage.getItem('oevGrpQueue'), null, { timeout: 15000 });
  const d = srv.call('getGroupData', t).result;
  assert.equal(Object.keys(d.history).length, 1, 'the groups were saved');
  assert.equal(Object.keys(d.matches).length, 1, 'and the matches');
  // saved: no question; changed again and dropped: closes without saving
  await openGroups(page);
  await page.click('#v-back');
  assert.equal(await ask.count(), 0, 'nothing unsaved: no question');
  await page.click('#v-back');
  await openGroups(page);
  await page.locator('#grp-v .grp-card .grp-p').first().click();
  await page.locator('#grp-v .grp-card').nth(1).locator('.grp-p').first().click();
  await page.click('#v-back');
  await ask.locator('[data-leave="drop"]').click();
  await page.waitForFunction(() => !document.getElementById('grp-v'));
  assert.deepEqual(srv.call('getGroupData', t).result.history, d.history, 'not saved');
  assert.deepEqual(page.errors, []);
});

test('Kampe til sidst in puljer: pools by one rule, matches per pool by another, sizes chosen', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  const sec = page.locator('#grp-v .grp-matches');
  assert.deepEqual(await sec.locator('[data-mmode]').allInnerTexts(), ['Bånd', 'Niveau', 'Kaos', 'Lige hold', '25-50-25']);
  assert.equal(await sec.locator('[data-pmode]').count(), 0, 'with 1 pulje: as before');
  assert.equal(await sec.locator('[data-mcount]').count(), 4);
  await sec.locator('[data-mpools="3"]').click();
  assert.deepEqual(await sec.locator('[data-pmode]').allInnerTexts(), ['Bånd', 'Niveau', 'Kaos', 'Lige hold', '25-50-25']);
  assert.equal(await sec.locator('[data-mcount]').count(), 0, 'the counts per pool replace "Antal kampe"');
  // 16 players: even pools 6 + 6 + 4, 2 matches each (pulje 3 also 2: 4 players allow it)
  assert.match(await sec.locator('.grp-sizes').innerText(), /Pulje 1\s*−?\s*2 kampe · 6 spillere[\s\S]*Pulje 3\s*−?\s*2 kampe · 4 spillere/);
  await sec.locator('[data-msub="0:1"]').click();               // pulje 1: 3 matches
  await sec.locator('[data-msub="2:-1"]').click();              // pulje 3: 1 match
  await sec.locator('[data-pmode="max"]').click();
  await sec.locator('[data-mmode="even"]').click();
  await sec.locator('[data-act="matches"]').click();
  const heads = await sec.locator('.grp-card .grp-head small').allInnerTexts();
  assert.deepEqual(heads.map(h => h.split(' · ')[0]), ['pulje 1', 'pulje 1', 'pulje 1', 'pulje 2', 'pulje 2', 'pulje 3']);
  assert.equal(await sec.locator('.grp-p').count(), 16, 'everyone plays');
  // chosen pool sizes: 8 + 4 + 4
  await sec.locator('[data-psize="custom"]').click();
  await sec.locator('[data-psz="0:1"]').click();
  assert.match(await sec.locator('.grp-sizes').first().innerText(), /Fordel|for meget/);
  assert.equal(await sec.locator('[data-act="matches"]').isDisabled(), true, 'not until the sizes add up');
  await sec.locator('[data-psz="0:1"]').click();
  await sec.locator('[data-psz="1:-1"]').click();
  await sec.locator('[data-psz="1:-1"]').click();
  assert.match(await sec.locator('.grp-sizes').first().innerText(), /Alle 16 spillere er fordelt/);
  assert.match(await sec.locator('.grp-sizes').nth(1).innerText(), /8 spillere[\s\S]*4 spillere[\s\S]*4 spillere/);
  // chosen match sizes, labelled by pool, then Kaos in the pools
  await sec.locator('[data-msize="custom"]').click();
  assert.match(await sec.locator('.grp-sizes').last().innerText(), /Kamp 1 · pulje 1[\s\S]*Kamp 6 · pulje 3/);
  await sec.locator('[data-pmode="chaos"]').click();
  await sec.locator('[data-mmode="chaos"]').click();
  await sec.locator('[data-act="matches"]').click();
  const sizes = await sec.locator('.grp-card').evaluateAll(cs => cs.map(c => c.querySelectorAll('.grp-p').length));
  assert.equal(sizes.length, 6);
  assert.deepEqual([sizes[0] + sizes[1] + sizes[2], sizes[3] + sizes[4], sizes[5]], [8, 4, 4], 'the pools keep their chosen sizes');
  assert.match(await sec.innerText(), /Holdene er trukket helt tilfældigt/);
  await sec.locator('[data-mpools="1"]').click();
  assert.equal(await sec.locator('[data-pmode]').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(page.errors, []);
});
