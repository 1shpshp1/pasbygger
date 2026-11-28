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
  assert.equal(await page.locator('#grp-v .grp-who .grp-band').count(), 16, 'the bands in "Hvem er med?" (levels shown)');
  assert.equal(await page.locator('#grp-v .grp-who label', { hasText: 'Alma' }).locator('.grp-band').innerText(), '1–2');
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

test('Niveau (by Fra, a narrower band first): group 1 holds the most experienced; the players show their bands', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  assert.deepEqual(await page.locator('#grp-v [data-rule]').allInnerTexts(), ['25-50-25', 'Bånd', 'Niveau', 'Kaos'], '25-50-25 first, no Lige hold');
  await page.click('#grp-v [data-rule="max"]');
  assert.deepEqual(await page.locator('#grp-v [data-diff]').allInnerTexts(), ['0', '0,5', '1', '1,5', '2']);
  await page.click('#grp-v [data-act="make"]');
  const names = i => cards(page).nth(i).locator('.grp-p').evaluateAll(bs => bs.map(b => b.dataset.p).sort());
  assert.deepEqual(await names(0), ['Alma', 'Bo', 'Carl', 'Noah']);          // niveau 1,5 1,5 2 1,5
  // group 2: of the five with Fra 2, Dina, Emil and Lucas (2–3) come before Frida and Pelle (2–4): the narrower band first
  const second = await names(1);
  assert.deepEqual(second.filter(n => ['Dina', 'Emil', 'Lucas'].includes(n)), ['Dina', 'Emil', 'Lucas']);
  assert.match(await cards(page).nth(0).locator('.grp-head').innerText(), /Fra 1$/);
  assert.match(await cards(page).nth(1).locator('.grp-head').innerText(), /Fra 2$/);
  assert.equal(await page.locator('#grp-v input[type=range]').count(), 0, 'no slider with Niveau');
  await page.click('#grp-v [data-act="matches"]');
  const chip = page.locator('#grp-v .grp-matches .grp-p', { hasText: 'Carl' });
  assert.equal(await chip.locator('.grp-band').innerText(), '1–3', 'the band, not Niveau, next to the player');
  await page.click('#viewer-close').catch(() => {});
  await page.goto(page.url());
  await page.waitForSelector('#sessions .card');
  await page.click('#nav-groups'); await page.click('#nav-overview');
  await page.waitForSelector('#ov .ov-p');
  assert.equal(await page.locator('#ov .ov-p', { hasText: 'Pelle' }).locator('.grp-band').innerText(), '2–4');
  assert.equal(await page.locator('#ov .ov-p', { hasText: 'Alma' }).locator('.grp-band').innerText(), '1–2');
  assert.match(await page.locator('#ov .ov-how').textContent(), /Niveau er spillerens Fra/);
  assert.match(await page.locator('#ov .ov-key').first().innerText(), /↑\s*spiller op\s*=\s*samme niveau\s*↓\s*spiller ned/);
  const card = name => page.locator('#ov .ov-p').filter({ has: page.locator('strong', { hasText: new RegExp('^' + name + '$') }) });
  // compared by overlap: Ida (3–5) covers all of Jonas's band (4–5), so for him she is the same level; Carl (1–3) and Ida
  // each cover half of Frida's band (2–4), so they count half as up and half as down for her
  for (const [name, aim, why] of [['Alma', '0 / 100 / 0', /Alle, hvis bånd overlapper spillerens, er på samme niveau/], ['Jonas', '0 / 100 / 0', /Alle, hvis bånd overlapper/], ['Frida', '13 / 75 / 13', /overlapper spillerens bånd en del/]]) {
    const c = card(name), goals = await c.locator('.ov-val.ov-goal').allInnerTexts();
    const [u, e, d] = aim.split(' / '), want = `↑\u202f${u} · =\u202f${e} · ↓\u202f${d} %`;
    assert.deepEqual(goals.slice(0, 2), [want, want], name + ': the aim for groups and training matches, for everyone, with arrows');
    assert.equal(goals.length, 3, name + ': and one for the Kampe tab (by the ideal match level)');
    assert.deepEqual(await c.locator('.ov-lab').allInnerTexts(), ['Faktisk', 'Mål', 'Faktisk', 'Mål', 'Faktisk', 'Mål'], name + ': each bar says what it is');
    assert.equal(await c.locator('.ov-aim').count(), 3, name + ': an aim bar under all three');
    if (why) assert.match(await c.innerText(), why); else assert.doesNotMatch(await c.innerText(), /Ingen er|Få er/);
  }
  // the aim bar's parts are the aim (Frida: 12,5 / 75 / 12,5)
  assert.deepEqual(await card('Frida').locator('.ov-aim').first().locator('span').evaluateAll(ss => ss.map(x => Math.round(parseFloat(x.style.width)))), [13, 75, 13]);
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
  await page.click('#nav-overview');
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
  assert.equal(await card('Frida').locator('.ov-empty').count(), 3, 'no data: an empty bar, the aim still shown');
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
  await page.click('#nav-groups'); await page.click('#nav-overview');
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
  await page.click('#grp-v [data-mmode="max"]');                  // (the default is 25-50-25)
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
  await page.click('#grp-v [data-mmode="max"]');                  // (the default is 25-50-25)
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
  const names = await page.locator('#grp-v .grp-who label > span:first-of-type').allInnerTexts();
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
    ['Code.gs', 'Grupper.gs'].map(f => 'https://github.com/1shpshp1/traeningsparat/blob/main/apps-script/' + f));
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

test('Niveauer: Skjul hides every level next to the players, in the whole app, and is remembered', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');                  // (25-50-25 groups show "gns. niveau")
  await page.click('#grp-v [data-mmode="mix"]');
  await page.click('#grp-v [data-act="matches"]');
  const levelBits = () => page.evaluate(() => {
    const v = document.getElementById('grp-v');
    return { bands: v.querySelectorAll('.grp-band').length, arrows: v.querySelectorAll('.grp-arrow').length, avg: /gns\. niveau/.test(v.innerText) };
  });
  const before = await levelBits();
  assert.ok(before.bands > 16 && before.avg, 'shown to begin with');
  await page.click('#grp-v [data-levels="0"]');
  assert.deepEqual(await levelBits(), { bands: 0, arrows: 0, avg: false });
  assert.doesNotMatch(await page.locator('#grp-v .grp-matches').innerText(), /↑ = en sværere kamp|spillere · $/m);
  assert.equal(await page.locator('#grp-v .grp-list .grp-p').count(), 16, 'the players are still there');
  await page.click('#v-back');
  await page.click('.leave-ask [data-leave="drop"]').catch(() => {});
  await page.click('#v-back');
  await page.click('#nav-groups'); await page.click('#nav-overview');           // the same in Spilleroversigt
  await page.waitForSelector('#ov .ov-p');
  assert.equal(await page.locator('#ov .grp-band').count(), 0);
  assert.equal(await page.locator('#ov [data-levels="0"]').getAttribute('aria-pressed'), 'true');
  await page.reload();                                                          // remembered
  await page.waitForSelector('#sessions .card');
  assert.equal(await page.evaluate(() => showLevels()), false);
  await page.click('#nav-groups'); await page.click('#nav-overview');
  await page.waitForSelector('#ov .ov-p');
  await page.click('#ov [data-levels="1"]');
  assert.ok(await page.locator('#ov .grp-band').count() > 10, 'shown again');
  assert.deepEqual(page.errors, []);
});

test('25-50-25 is the default for Grupper and Kampe til træning (also over an older saved choice, once)', { skip }, async () => {
  const page = await phone(testServer());
  await page.evaluate(() => localStorage.setItem('oevGrpSettings', JSON.stringify({ rule: 'band', matchMode: 'max', count: 4 })));
  await openGroups(page);
  assert.equal(await page.locator('#grp-v [data-rule="mix"]').getAttribute('aria-pressed'), 'true', 'an older choice switches once');
  assert.match(await page.locator('#grp-v').innerText(), /25-50-25: over tid er hver spiller ca\. 25 %/);
  assert.equal(await page.locator('#grp-v input[type=range]').count(), 2, 'two sliders: Socialt mix and Niveaublanding');
  assert.match(await page.locator('#grp-v .grp-slide').filter({ has: page.locator('[data-act="social"]') }).innerText(), /Socialt mix: 25 %/);
  await page.click('#grp-v [data-act="make"]');
  const sizes = await page.locator('#grp-v .grp-list .grp-card').evaluateAll(cs => cs.map(c => c.querySelectorAll('.grp-p').length));
  assert.deepEqual(sizes, [4, 4, 4, 4]);
  // (the test squad's bands are only one level wide, so 4–5 has too few to overlap half a level with: then red, and said so)
  assert.match(await page.locator('#grp-v .grp-msg').innerText(), /ingen gemte grupper fra tidligere træninger|overlapper ikke i de røde grupper/);
  assert.match(await page.locator('#grp-v .grp-list .grp-head').first().innerText(), /gns\. niveau/);
  assert.match(await page.locator('#grp-v .grp-matches h3').innerText(), /^Kampe til træning$/);
  assert.equal(await page.locator('#grp-v [data-mmode="mix"]').getAttribute('aria-pressed'), 'true');
  // a choice made after the switch is kept
  await page.click('#grp-v [data-rule="band"]');
  await page.click('#v-back'); await page.click('.leave-ask [data-leave="drop"]'); await page.click('#v-back');
  await openGroups(page);
  assert.equal(await page.locator('#grp-v [data-rule="band"]').getAttribute('aria-pressed'), 'true', 'remembered after the switch');
  // an old "Lige hold" for the groups becomes 25-50-25
  await page.evaluate(() => localStorage.setItem('oevGrpSettings', JSON.stringify({ v: 2, rule: 'even' })));
  await page.click('#v-back'); await page.click('#v-back');
  await openGroups(page);
  assert.equal(await page.locator('#grp-v [data-rule="mix"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(page.errors, []);
});

test('Spilleroversigt is its own tab (and needs the code)', { skip }, async () => {
  const guest = await phone(testServer(), { loggedIn: false });
  assert.deepEqual(await guest.locator('#nav-bar .navbtn').allInnerTexts(), ['Træninger', 'Øvelser', 'Grupper', 'Kampe (beta)', 'Spilleroversigt']);
  await guest.click('#nav-overview');
  await guest.waitForSelector('#login-pw');
  const page = await phone(testServer());
  await page.click('#nav-overview');
  await page.waitForSelector('#ov .ov-p');
  assert.equal(await page.locator('#overview h2').innerText(), 'Spilleroversigt');
  assert.equal(await page.locator('#nav-overview').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('#groups').isHidden(), true);
  assert.equal(await page.locator('#grp-overview').count(), 0, 'no longer a button under Grupper');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'four tabs fit');
  assert.deepEqual(page.errors, []);
});

test('Socialt mix: a slider for 25-50-25 groups (25 % to begin with), remembered; it says how many teammates are together again', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  const t = srv.call('login', CODE).result.token;
  const N = ['Alma','Bo','Carl','Dina','Emil','Frida','Gustav','Hjalte','Ida','Jonas','Karla','Lucas','Malou','Noah','Olivia','Pelle'];
  srv.call('saveGroups', t, '2026-10-01', [N.slice(0, 4), N.slice(4, 8), N.slice(8, 12), N.slice(12)]);   // an earlier training
  await openGroups(page);
  const slider = page.locator('#grp-v [data-act="social"]');
  assert.equal(await slider.inputValue(), '25');
  await slider.fill('60');
  assert.match(await page.locator('#grp-v .grp-slide').filter({ has: page.locator('[data-act="social"]') }).innerText(), /Socialt mix: 60 %/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('oevGrpSettings')).social), 60);
  await page.click('#grp-v [data-act="make"]');
  assert.match(await page.locator('#grp-v .grp-slide').filter({ has: page.locator('[data-act="social"]') }).innerText(),
    /Med disse grupper er \d+ % af makkerne fra sidste træning sammen igen \(ved ren tilfældighed ca\. 25 %\)/);
  const even = page.locator('#grp-v [data-act="even"]');             // Niveaublanding, 25 % to begin with
  assert.equal(await even.inputValue(), '25');
  assert.match(await page.locator('#grp-v .grp-slide').filter({ has: page.locator('[data-act="even"]') }).innerText(), /Gruppernes gennemsnit \(Fra\) ligger nu \d+,\d niveau fra hinanden/);
  await even.fill('70');
  assert.match(await page.locator('#grp-v .grp-slide').filter({ has: page.locator('[data-act="even"]') }).innerText(), /Niveaublanding: 70 %/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('oevGrpSettings')).even), 70);
  await page.click('#grp-v [data-rule="band"]');                    // Bånd keeps its own slider
  assert.equal(await page.locator('#grp-v [data-act="social"]').count(), 0);
  assert.equal(await page.locator('#grp-v [data-act="even"]').count(), 0);
  assert.equal(await page.locator('#grp-v [data-act="change"]').count(), 1);
  assert.deepEqual(page.errors, []);
});

test('25-50-25: a player who turns up late goes into a group whose bands all overlap theirs, sizes kept even', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);                                            // ("Hvem er med?" is open before any groups)
  const pelle = page.locator('#grp-v .grp-who label', { hasText: 'Pelle' }).locator('input');
  await pelle.uncheck();                                             // not signed up
  await page.locator('#grp-v .grp-who label', { hasText: 'Olivia' }).locator('input').uncheck();
  await page.click('#grp-v [data-act="make"]');                      // 14 players: 4 + 4 + 3 + 3
  await page.click('#grp-v details summary');
  await pelle.check();                                               // turns up after all
  const groups = await page.locator('#grp-v .grp-list .grp-card').evaluateAll(cs => cs.map(c => [...c.querySelectorAll('.grp-p')].map(b => b.dataset.p)));
  const sizes = groups.map(g => g.length);
  assert.equal(sizes.reduce((x, y) => x + y), 15);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, 'sizes kept even: ' + sizes);
  const band = { Alma: [1, 2], Bo: [1, 2], Carl: [1, 3], Dina: [2, 3], Emil: [2, 3], Frida: [2, 4], Gustav: [3, 4], Hjalte: [3, 4], Ida: [3, 5], Jonas: [4, 5], Karla: [4, 5], Lucas: [2, 3], Malou: [3, 4], Noah: [1, 2], Olivia: [3, 4], Pelle: [2, 4] };
  const mine = groups.find(g => g.includes('Pelle'));
  assert.ok(mine.length === Math.min(...sizes.map((n, i) => groups[i].includes('Pelle') ? n - 1 : n)) + 1, 'into one of the smallest groups');
  mine.filter(n => n !== 'Pelle').forEach(n => assert.ok(Math.min(band.Pelle[1], band[n][1]) - Math.max(band.Pelle[0], band[n][0]) > 0, 'Pelle (2–4) overlaps ' + n));
  assert.match(await page.locator('#grp-v .grp-save').first().innerText(), /Ikke gemt/);
  assert.deepEqual(page.errors, []);
});

test('Saving groups for a training when the Grupper tab has groups for the same date: ask, and remove them if wanted', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  const t = srv.call('login', CODE).result.token;
  const key = await page.evaluate(() => SESSIONS[0].iso);
  srv.call('saveGroups', t, key + ' fri', [['Alma', 'Bo'], ['Carl', 'Dina']]);   // made at home in the Grupper tab
  srv.call('saveMatches', t, key + ' fri', [[['Alma'], ['Bo']]]);
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  await page.click('#grp-v [data-act="save"]');
  const ask = page.locator('.leave-ask');
  assert.match(await ask.innerText(), /Grupper fra samme dag[\s\S]*tæller dagen to gange/);
  await ask.locator('[data-twin="drop"]').click();
  await page.waitForFunction(() => !localStorage.getItem('oevGrpQueue'), null, { timeout: 15000 });
  const d = srv.call('getGroupData', t).result;
  assert.deepEqual(Object.keys(d.history), [key], 'only the training\'s groups count');
  assert.deepEqual(Object.keys(d.matches), [], 'the matches from the tab went too');
  // "Behold begge" keeps both
  srv.call('saveGroups', t, key + ' fri', [['Alma', 'Bo']]);
  await page.click('#v-back'); await page.click('#v-back');
  await page.reload(); await page.waitForSelector('#sessions .card');
  await openGroups(page);
  await page.locator('#grp-v .grp-list .grp-card .grp-p').first().click();
  await page.locator('#grp-v .grp-list .grp-card').nth(1).locator('.grp-p').first().click();
  await page.click('#grp-v [data-act="save"]');
  await ask.locator('[data-twin="keep"]').click();
  await page.waitForFunction(() => !localStorage.getItem('oevGrpQueue'), null, { timeout: 15000 });
  assert.deepEqual(Object.keys(srv.call('getGroupData', t).result.history).sort(), [key, key + ' fri']);
  assert.deepEqual(page.errors, []);
});

test('Kampe til træning "Grupperne": each group plays its own match, split into two (or three) teams; saved', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  await openGroups(page);
  await page.click('#grp-v [data-act="minus"]');                   // 3 groups, as at training today
  await page.click('#grp-v [data-act="make"]');
  const groups = await page.locator('#grp-v .grp-list .grp-card').evaluateAll(cs => cs.map(c => [...c.querySelectorAll('.grp-p')].map(b => b.dataset.p).sort()));
  assert.equal(groups.length, 3);
  const sec = page.locator('#grp-v .grp-matches');
  await sec.locator('[data-mmode="groups"]').click();
  assert.equal(await sec.locator('[data-mpools]').count(), 0, 'no puljer, number of matches or sizes: the groups decide');
  assert.equal(await sec.locator('[data-mcount]').count(), 0);
  assert.equal(await sec.locator('[data-msize]').count(), 0);
  assert.equal(await sec.locator('[data-pmode="groups"]').count(), 0);
  await sec.locator('[data-act="matches"]').click();
  const cards = sec.locator('.grp-card');
  assert.equal(await cards.count(), 3, 'one match per group');
  const matches = await cards.evaluateAll(cs => cs.map(c => [...c.querySelectorAll('.grp-p .grp-pname')].map(x => x.textContent.replace(/[↑↓]/g, '').trim()).sort()));
  assert.deepEqual(matches.map(m => m.join()).sort(), groups.map(g => g.join()).sort(), 'each match is exactly one group');
  assert.match(await cards.first().locator('.grp-head').innerText(), /gruppe \d/);
  assert.deepEqual(await cards.first().locator('.grp-teamhead').evaluateAll(hs => hs.length), 2);
  await sec.locator('[data-mteams="0:3"]').click();                  // three teams per group
  await sec.locator('[data-act="matches"]').click();
  assert.equal(await cards.first().locator('.grp-teamhead').count(), 3);
  await sec.locator('[data-act="savematches"]').click();
  await page.waitForFunction(() => /Kampe gemt/.test(document.querySelector('#grp-v .grp-matches').innerText));
  const t = srv.call('login', CODE).result.token;
  assert.deepEqual(Object.values(srv.call('getGroupData', t).result.matches)[0].matches.map(m => m.length), [3, 3, 3]);
  assert.deepEqual(page.errors, []);
});

test('Kampe tab: a set of named matches, who can play each, a 25-50-25 draft only on those, saved, moved, in Spilleroversigt', { skip }, async () => {
  const guest = await phone(testServer(), { loggedIn: false });
  await guest.click('#nav-fixtures');
  await guest.waitForSelector('#login-pw');                          // needs the code
  const srv = testServer(), page = await phone(srv);
  await page.click('#nav-fixtures');
  await page.waitForSelector('#fix .fix-sname');
  await page.fill('#fix .fix-sname', 'Weekend 22.–23. nov.');
  await page.fill('#fix [data-gname="0"]', 'U13 mod Brøndby');
  await page.click('#fix [data-flevel="0:1"]');
  for (let i = 0; i < 6; i++) await page.click('#fix [data-fsize="0:-1"]');   // 4 players
  await page.click('#fix [data-fact="add"]');
  await page.fill('#fix [data-gname="1"]', 'U13 mod KB');
  await page.locator('#fix [data-gname="1"]').dispatchEvent('change');
  await page.click('#fix [data-flevel="1:3"]');
  // who can play: the first match only five, the second everyone
  for (const n of ['Alma', 'Bo', 'Carl', 'Noah', 'Dina']) await page.click(`#fix [data-fav="0|${n}"]`);
  assert.equal(await page.locator('#fix [data-favall="0"]').count(), 0, '"Sæt alle" only for a match nobody is ticked for: never undoes work');
  await page.click('#fix [data-favall="1"]');
  assert.equal(await page.locator('#fix [data-favall]').count(), 0);
  assert.deepEqual(await page.locator('#fix .fix-av thead th').allInnerTexts(), ['Spiller', '1', '2'], 'numbered columns');
  assert.match(await page.locator('#fix .fix-legend').innerText(), /1\s*U13 mod Brøndby[\s\S]*niveau 1[\s\S]*2\s*U13 mod KB[\s\S]*niveau 3/, 'the full names in the list');
  assert.match(await page.locator('#fix .fix-av tfoot').innerText(), /Til rådighed\s*5\/4\s*16\/4/);
  await page.click('#fix [data-fact="draft"]');
  const cards = page.locator('#fix .grp-list .grp-card');
  assert.equal(await cards.count(), 3, 'two matches and the reserves');
  assert.match(await cards.nth(0).locator('.grp-head').innerText(), /U13 mod Brøndby\s*\d+ \w+ · niveau 1 · 4\/4 spillere/);
  const names = i => cards.nth(i).locator('.grp-p').evaluateAll(bs => bs.map(b => b.dataset.fp.split('|')[1]));
  const first = await names(0);
  assert.ok(first.every(n => ['Alma', 'Bo', 'Carl', 'Noah', 'Dina'].includes(n)), 'only those who can play it: ' + first);
  assert.match(await cards.nth(2).locator('.grp-head').innerText(), /Reserver\s*8 spillere til rådighed uden en kamp/);
  assert.equal(await page.locator('#fix .fix-multi').count(), 0, 'enough players: nobody on two matches, no warning');
  // a swap that isn't allowed: someone only free for the second match into the first
  const second = await names(1), outsider = second.find(n => !['Alma', 'Bo', 'Carl', 'Noah', 'Dina'].includes(n));
  await cards.nth(1).locator(`[data-fp="1|${outsider}"]`).click();
  await cards.nth(0).locator('.grp-p').first().click();
  assert.match(await page.locator('#fix .grp-msg').innerText(), new RegExp(outsider + ' er ikke til rådighed for U13 mod Brøndby'));
  // a player put on a second match by hand: a warning
  const twice = first[0];
  await cards.nth(0).locator(`[data-fp="0|${twice}"]`).click();
  await cards.nth(1).locator('[data-falso="1"]').click();
  assert.match(await page.locator('#fix .fix-multi').innerText(), new RegExp('En spiller skal spille mere end én kamp i kampsættet: ' + twice + ' \\(U13 mod Brøndby og U13 mod KB\\)'));
  assert.match(await cards.nth(1).locator(`[data-fp="1|${twice}"]`).innerText(), /⚠ 2 kampe/);
  await cards.nth(1).locator(`[data-fp="1|${twice}"]`).click();
  await cards.nth(1).locator('[data-fout="1"]').click();                    // back to one match: the warning goes
  assert.equal(await page.locator('#fix .fix-multi').count(), 0);
  await page.click('#fix [data-fact="save"]');
  await page.waitForFunction(() => !localStorage.getItem('oevGrpQueue'), null, { timeout: 15000 });
  const t = srv.call('login', CODE).result.token;
  const sets = srv.call('getGroupData', t).result.fixtures, id = Object.keys(sets)[0];
  assert.equal(sets[id].name, 'Weekend 22.–23. nov.');
  assert.deepEqual(sets[id].games.map(g => [g.name, g.level, g.avail.length, g.players.length]), [['U13 mod Brøndby', 1, 5, 4], ['U13 mod KB', 3, 16, 4]]);
  // reopened: the set and its draft come back
  await page.reload(); await page.waitForSelector('#sessions .card');
  await page.click('#nav-fixtures');
  await page.waitForSelector('#fix .grp-list');
  assert.match(await page.locator('#fix #fix-set option:checked').innerText(), /Weekend 22\.–23\. nov\./);
  assert.match(await page.locator('#fix .grp-save').innerText(), /Gemt \d/);
  // the second match moved to a new set: both saved
  await page.selectOption('#fix [data-gmove="1"]', '__new');
  await page.waitForFunction(() => !localStorage.getItem('oevGrpQueue'), null, { timeout: 15000 });
  const after = srv.call('getGroupData', t).result.fixtures;
  assert.equal(Object.keys(after).length, 2);
  assert.deepEqual(after[id].games.map(g => g.name), ['U13 mod Brøndby']);
  // Spilleroversigt: a Kampe section
  await page.click('#nav-overview'); await page.waitForSelector('#ov .ov-p');
  const card = page.locator('#ov .ov-p').filter({ has: page.locator('strong', { hasText: new RegExp('^' + first[0] + '$') }) });
  assert.match(await card.innerText(), /Kampe\s*\d kamp/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(page.errors, []);
});
test('Kampe: keepers (Favoritpladser) spread, a picked player (📌) kept, "Flyt hertil" to any match, warnings, saved', { skip }, async () => {
  const srv = testServer();
  srv.book['Spillere'].getRange(1, 5).setValue('Favoritpladser');
  srv.book['Spillere'].getRange(2, 5).setValue('Keeper');                  // Alma
  srv.book['Spillere'].getRange(10, 5).setValue('Målmand, forsvar');        // Ida
  const page = await phone(srv);
  await page.click('#nav-fixtures');
  await page.waitForSelector('#fix .fix-sname');
  for (let i = 0; i < 6; i++) await page.click('#fix [data-fsize="0:-1"]');   // Kamp 1: niveau 2, 4 spillere
  await page.click('#fix [data-fact="add"]');
  await page.click('#fix [data-flevel="1:3"]');                              // Kamp 2: niveau 3, 4 spillere
  await page.click('#fix [data-favall="0"]');
  await page.click('#fix [data-favall="1"]');
  assert.match(await page.locator('#fix .fix-av tbody tr', { hasText: 'Alma' }).innerText(), /🧤/, 'keeper-interested marked in the table');
  await page.click('#fix [data-fav="0|Malou"]');                             // ✓ → 📌: Malou picked for Kamp 1
  assert.equal(await page.locator('#fix [data-fav="0|Malou"]').innerText(), '📌');
  await page.click('#fix [data-fav="0|Jonas"]'); await page.click('#fix [data-fav="0|Jonas"]');   // ✓ → 📌 → off
  assert.equal(await page.locator('#fix [data-fav="0|Jonas"]').getAttribute('aria-pressed'), 'false');
  assert.match(await page.locator('#fix .fix-av tfoot').innerText(), /📌 Udtaget\s*1\s*0/);
  await page.click('#fix [data-fact="draft"]');
  const cards = page.locator('#fix .grp-list .grp-card');
  const names = i => cards.nth(i).locator('.grp-p').evaluateAll(bs => bs.map(b => b.dataset.fp.split('|')[1]));
  assert.ok((await names(0)).includes('Malou'), 'the picked player is on Kamp 1');
  assert.match(await cards.nth(0).locator('.grp-head').innerText(), /🧤 (Alma|Ida)/);
  assert.match(await cards.nth(1).locator('.grp-head').innerText(), /🧤 (Alma|Ida)/, 'one keeper-interested on each match');
  await page.click('#fix [data-fact="draft"]');                              // a new draft: Malou still there
  assert.ok((await names(0)).includes('Malou'));
  // "Flyt hertil" to a match the player isn't ticked for: asks (accepted here) and ticks
  const where = (await names(1)).includes('Jonas') ? 1 : 2;
  await cards.nth(where).locator('[data-fp$="|Jonas"]').click();
  assert.match(await cards.nth(0).locator('[data-fto="0"]').innerText(), /Flyt Jonas hertil \(ikke til rådighed\)/);
  await cards.nth(0).locator('[data-fto="0"]').click();
  assert.ok((await names(0)).includes('Jonas'));
  assert.equal(await page.locator('#fix [data-fav="0|Jonas"]').getAttribute('aria-pressed'), 'true', 'now ticked for Kamp 1');
  // the keeper-interested out of Kamp 1: a warning
  for (const k of ['Alma', 'Ida']) {
    if (!(await names(0)).includes(k)) continue;
    await cards.nth(0).locator(`[data-fp="0|${k}"]`).click();
    await cards.nth(0).locator('[data-fout="0"]').click();
  }
  assert.match(await page.locator('#fix .fix-nokeeper-msg').innerText(), /Ingen keeper-interesseret i Kamp 1/);
  await page.click('#fix [data-fact="save"]');
  await page.waitForFunction(() => !localStorage.getItem('oevGrpQueue'), null, { timeout: 15000 });
  const t = srv.call('login', CODE).result.token, set = Object.values(srv.call('getGroupData', t).result.fixtures)[0];
  assert.deepEqual(set.games[0].locked, ['Malou'], 'the pick is saved');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(page.errors, []);
});

test('Spilleroversigt: a player\'s history – training groups, training matches and matches, newest first, with filters', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  const t = srv.call('login', CODE).result.token;
  srv.call('saveGroups', t, '2026-10-01', [['Alma', 'Bo', 'Ida'], ['Carl', 'Dina']]);
  srv.call('saveGroups', t, '2026-10-08', [['Alma', 'Carl'], ['Bo', 'Dina']]);
  srv.call('saveMatches', t, '2026-10-08', [[['Alma', 'Bo'], ['Carl', 'Dina']]]);
  srv.call('saveFixtureSet', t, 'k1', { name: 'Weekend', games: [
    { name: 'U13 mod Brøndby', date: '2026-10-11', level: 2, size: 8, avail: ['Alma', 'Bo'], players: ['Alma'], locked: ['Alma'] }] });
  srv.call('saveFixtureSet', t, 'k2', { name: 'Næste weekend', games: [
    { name: 'U13 mod KB', date: '2026-10-18', level: 3, size: 8, avail: ['Alma', 'Bo'], players: ['Bo'] }] });
  await page.click('#nav-overview'); await page.waitForSelector('#ov .ov-p');
  await page.locator('#ov .ov-p').filter({ has: page.locator('strong', { hasText: /^Alma$/ }) }).locator('.ov-histbtn').click();
  await page.waitForSelector('#hist .hist-e');
  assert.match(await page.locator('#hist').innerText(), /2 træninger · 1 kamp til træning · 1 kamp \(1× reserve\)/);
  const heads = await page.locator('#hist .hist-e .hist-k').allInnerTexts();
  assert.deepEqual(heads, ['Kamp', 'Kamp', 'Kamp til træning', 'Træningsgruppe', 'Træningsgruppe'], 'newest first');
  const text = await page.locator('#hist .hist-list').innerText();
  assert.match(text, /Reserve \(til rådighed, men ikke på en kamp\)[\s\S]*Næste weekend/);
  assert.match(text, /U13 mod Brøndby · niveau 2 [↑=↓] · 📌 udtaget af træneren/);
  assert.match(text, /Kamp 1, hold A [↑=↓][\s\S]*Med Bo [↑=↓][\s\S]*Mod Carl [↑=↓], Dina [↑=↓]/);
  assert.match(text, /Gruppe 1 med Bo =, Ida ↓/, 'teammates with ↑ = ↓ (Alma 1–2: Bo 1–2 the same, Ida 3–5 less experienced)');
  await page.click('#hist [data-hk="groups"]');
  assert.deepEqual(await page.locator('#hist .hist-e .hist-k').allInnerTexts(), ['Træningsgruppe', 'Træningsgruppe']);
  await page.click('#hist [data-hk="fixtures"]');
  assert.equal(await page.locator('#hist .hist-e').count(), 2);
  await page.click('#v-back');                                       // back to Spilleroversigt
  assert.equal(await page.locator('#ov .ov-p').first().isVisible(), true);
  assert.deepEqual(page.errors, []);
});

test('Kampe til sidst in puljer: pools by one rule, matches per pool by another, sizes chosen', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-act="make"]');
  const sec = page.locator('#grp-v .grp-matches');
  assert.deepEqual(await sec.locator('[data-mmode]').allInnerTexts(), ['25-50-25', 'Bånd', 'Niveau', 'Kaos', 'Lige hold', 'Grupperne']);
  assert.equal(await sec.locator('[data-pmode]').count(), 0, 'with 1 pulje: as before');
  assert.equal(await sec.locator('[data-mcount]').count(), 4);
  await sec.locator('[data-mpools="3"]').click();
  assert.deepEqual(await sec.locator('[data-pmode]').allInnerTexts(), ['25-50-25', 'Bånd', 'Niveau', 'Kaos', 'Lige hold']);
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

test('links to a training or a drill use the page\'s own address, and the public one inside the App Store / Google Play app', { skip }, async () => {
  const srv = testServer(), page = await phone(srv);
  assert.equal(await page.evaluate(() => appAddress()), base);
  assert.equal(await page.evaluate(() => { window.Capacitor = {}; return appAddress(); }), 'https://1shpshp1.github.io/traeningsparat/');
  assert.deepEqual(page.errors, []);
});

test('With the database (Supabase): the plan by the team\'s link, log in with e-mail and a code, choose the team, groups and drills from it, nothing from the sheet', { skip }, async () => {
  const srv = testServer(), page = await phone(srv, { loggedIn: false });
  const sb = { calls: [] }, jwt = 'eyJhbGciOiJIUzI1NiJ9.' + 'p'.repeat(120) + '.sig';
  const plan = srv.call('getPlan', '').result, lib = srv.call('getDrills', srv.call('login', CODE).result.token, '').result;
  const data = { players: [{ name: 'Alma', lo: 1, hi: 2 }, { name: 'Bo', lo: 2, hi: 3 }, { name: 'Carl', lo: 1, hi: 3 }, { name: 'Dina', lo: 2, hi: 2 }],
                 history: {}, signups: {}, matches: {}, fixtures: {}, version: 'v1', server: 5 };
  await page.context().route('https://sb.test/**', r => {
    const url = new URL(r.request().url()), body = JSON.parse(r.request().postData() || '{}');
    sb.calls.push([url.pathname, body, r.request().headers().authorization]);
    const send = (x, status) => r.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (url.pathname === '/auth/v1/otp') return body.email === 'ukendt@x.dk' ? send({ msg: 'Signups not allowed for otp' }, 422) : send({});
    if (url.pathname === '/auth/v1/verify') return body.token === '123456' ? send({ access_token: jwt, refresh_token: 'r1', expires_in: 3600 }) : send({ msg: 'Token has expired or is invalid' }, 403);
    if (url.pathname === '/rest/v1/rpc/my_teams') return send([{ id: 't1', name: 'U10', club: 'Klub', role: 'coach' }, { id: 't2', name: 'U12', club: 'Klub', role: 'coach' }]);
    if (url.pathname === '/rest/v1/rpc/get_group_data') return send(body.team === 't2' ? data : { message: 'LOGIN' }, body.team === 't2' ? 200 : 400);
    if (url.pathname === '/rest/v1/rpc/save_groups') return send({ ok: true, saved: '28.11.2026 12:00' });
    if (url.pathname === '/rest/v1/rpc/get_plan') return send(Object.assign({}, plan, { code: body.code || 'own', server: 6 }));
    if (url.pathname === '/rest/v1/rpc/get_drills') return send(Object.assign({}, lib, { daVersion: '' }));
    if (url.pathname === '/rest/v1/rpc/get_drills_da') return send({ version: 'x', da: {} });
    if (url.pathname === '/rest/v1/rpc/track') return send(true);
    send({ message: 'unknown' }, 404);
  });
  await page.evaluate(() => localStorage.setItem('oevSupabase', JSON.stringify({ url: 'https://sb.test', key: 'anon' })));
  const sheetCalls = (srv.calls || []).length;
  await page.goto(base + '?hold=abc123');                               // a team's link, as players and parents get it
  await page.waitForSelector('#sessions .card', { timeout: 15000 });
  const planCall = sb.calls.find(c => c[0] === '/rest/v1/rpc/get_plan');
  assert.deepEqual([planCall[1].code, planCall[2]], ['abc123', 'Bearer anon']);   // no login needed
  assert.match(await page.evaluate(() => sessionLink(SESSIONS[0])), /\?hold=abc123&s=\d{4}-\d{2}-\d{2}$/);
  await page.click('#nav-groups');
  assert.equal(await page.locator('#login-title').innerText(), 'Log ind med din e-mail');
  await page.fill('#login-pw', 'ukendt@x.dk'); await page.click('#login-go');
  await page.waitForFunction(() => /ikke adgang/.test(document.getElementById('login-err').textContent));
  await page.fill('#login-pw', 'træner@x.dk'); await page.click('#login-go');
  await page.waitForFunction(() => document.getElementById('login-title').textContent === 'Indtast koden fra e-mailen');
  await page.fill('#login-pw', '000000'); await page.click('#login-go');
  await page.waitForFunction(() => /Forkert eller udløbet/.test(document.getElementById('login-err').textContent));
  await page.fill('#login-pw', '123456'); await page.click('#login-go');
  await page.waitForSelector('#login-team');                          // two teams: choose
  await page.selectOption('#login-team', 't2');
  await page.click('#login-go');
  await page.waitForSelector('#grp-tab .grp-slide');
  assert.match(await page.locator('#grp-tab').innerText(), /Alma/);
  assert.equal((srv.calls || []).length, sheetCalls, 'nothing asked of the sheet');
  await page.click('#grp-tab [data-act="make"]');
  await page.click('#grp-tab [data-act="save"]');
  await page.waitForFunction(() => /Gemt/.test(document.querySelector('#grp-tab .grp-save').innerText));
  const save = sb.calls.find(c => c[0] === '/rest/v1/rpc/save_groups');
  assert.equal(save[1].team, 't2');
  assert.match(save[1].key, /^\d{4}-\d{2}-\d{2} fri$/);
  assert.deepEqual(save[1].groups.flat().sort(), ['Alma', 'Bo', 'Carl', 'Dina']);
  assert.equal(save[2], 'Bearer ' + jwt);
  // the drills, with the same login
  await page.click('#nav-library');
  await page.waitForSelector('#drill-grid .card');
  assert.equal(await page.locator('#login').isHidden(), true);
  assert.equal(sb.calls.find(c => c[0] === '/rest/v1/rpc/get_drills')[2], 'Bearer ' + jwt);
  assert.ok(sb.calls.some(c => c[0] === '/rest/v1/rpc/track'), 'app opens counted in the database');
  assert.equal((srv.calls || []).length, sheetCalls, 'still nothing asked of the sheet');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('oevSupaSession'))).team, 't2');
  assert.deepEqual(page.errors, []);
});
