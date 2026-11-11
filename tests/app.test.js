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
  await ctx.route('https://script.google.com/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(srv.post(r.request().postData())) }));
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
  await page.locator('#viewer button', { hasText: 'Grupper' }).click();
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
  await page.locator('#viewer button', { hasText: 'Grupper' }).click();
  assert.ok(await page.locator('#login').isVisible(), 'Grupper asks for the code first');
  await page.fill('#login-pw', CODE); await page.click('#login-go');
  await page.waitForSelector('#grp-v .grp-slide');
  assert.match(await page.locator('#grp-v .grp-none').innerText(), /ikke lavet grupper til denne træning/);
  assert.equal(await page.locator('#grp-v .grp-who .grp-band').count(), 0, 'no levels in "Hvem er med?"');
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

test('Max-niveau: group 1 holds the most experienced', { skip }, async () => {
  const page = await phone(testServer());
  await openGroups(page);
  await page.click('#grp-v [data-rule="max"]');
  await page.click('#grp-v [data-act="make"]');
  const first = await cards(page).first().locator('.grp-p').evaluateAll(bs => bs.map(b => b.dataset.p).sort());
  assert.deepEqual(first, ['Alma', 'Bo', 'Carl', 'Noah']);
  assert.equal(await page.locator('#grp-v input[type=range]').count(), 0, 'no slider in Max-niveau');
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
