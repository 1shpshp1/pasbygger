/* The server (apps-script/*.gs) run in a simulated Google Sheet: login, players, groups, signups, forwarding. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { testServer, CODE, SESSION_DATES } = require('./fixtures.js');

const login = srv => srv.call('login', CODE).result.token;
const rows = (srv, tab) => srv.book[tab].getDataRange().getDisplayValues().slice(1);

test('login: the coach code gives a token, a wrong code does not', () => {
  const srv = testServer();
  assert.equal(srv.call('login', CODE).result.ok, true);
  assert.equal(srv.call('login', 'forkert').result.ok, false);
});

test('players, groups and signups need a login', () => {
  const srv = testServer();
  assert.equal(srv.call('getGroupData', '').error, 'LOGIN');
  assert.equal(srv.call('saveGroups', 'nope', SESSION_DATES[0], [['Alma']]).error, 'LOGIN');
  assert.equal(srv.call('saveSignups', 'nope', SESSION_DATES[0], ['Alma']).error, 'LOGIN');
});

test('the extra code in GROUPS_PASSWORD logs in too, when it is set', () => {
  const srv = testServer();
  assert.equal(srv.call('login', 'ekstra').result.ok, false);
  srv.props.GROUPS_PASSWORD = 'ekstra';
  const t = srv.call('login', 'ekstra').result.token;
  assert.ok(srv.call('getGroupData', t).result.players.length > 0);
});

test('getGroupData sends the players, and only "unchanged" when nothing has changed', () => {
  const srv = testServer(), t = login(srv);
  const d = srv.call('getGroupData', t).result;
  assert.equal(d.players.length, 16);
  assert.deepEqual(d.players[0], { name: 'Alma', lo: 1, hi: 2 });
  assert.deepEqual(srv.call('getGroupData', t, d.version).result, { unchanged: true, version: d.version });
});

test('saveGroups replaces one training\'s groups, and [] removes them', () => {
  const srv = testServer(), t = login(srv);
  const [a, b] = SESSION_DATES;
  srv.call('saveGroups', t, a, [['Alma', 'Bo'], ['Carl']]);
  srv.call('saveGroups', t, b, [['Dina']]);
  srv.call('saveGroups', t, a, [['Alma'], ['Bo', 'Carl']]);
  const h = srv.call('getGroupData', t).result.history;
  assert.deepEqual(h[a].groups, [['Alma'], ['Bo', 'Carl']]);
  assert.deepEqual(h[b].groups, [['Dina']]);
  assert.deepEqual(rows(srv, 'Grupper').map(r => r[0]), [a, a, a, b], 'rows are kept in date order');
  srv.call('saveGroups', t, b, []);
  assert.deepEqual(Object.keys(srv.call('getGroupData', t).result.history), [a]);
});

test('saveSignups saves who signed up, separately from the groups history', () => {
  const srv = testServer(), t = login(srv);
  const [a] = SESSION_DATES;
  assert.equal(srv.call('saveSignups', t, a, ['Alma', 'Carl']).result.ok, true);
  srv.call('saveSignups', t, a, ['Alma', 'Bo', 'Carl']);
  const d = srv.call('getGroupData', t).result;
  assert.deepEqual(d.signups[a].names, ['Alma', 'Bo', 'Carl']);
  assert.deepEqual(d.history, {});
  srv.call('saveSignups', t, a, []);
  assert.deepEqual(srv.call('getGroupData', t).result.signups, {});
});

test('saveMatches keeps teams and the order of opposite numbers; saving again replaces', () => {
  const srv = testServer(), t = login(srv);
  const [a, b] = SESSION_DATES;
  assert.equal(srv.call('saveMatches', 'nope', a, []).error, 'LOGIN');
  srv.call('saveMatches', t, a, [[['Alma', 'Carl'], ['Bo', 'Noah']], [['Ida', 'Jonas'], ['Karla', 'Malou']]]);
  srv.call('saveMatches', t, b, [[['Dina'], ['Emil']]]);
  srv.call('saveMatches', t, a, [[['Carl', 'Alma'], ['Noah', 'Bo']], [['Ida', 'Jonas'], ['Karla', 'Malou']]]);
  const m = srv.call('getGroupData', t).result.matches;
  assert.deepEqual(m[a].matches, [[['Carl', 'Alma'], ['Noah', 'Bo']], [['Ida', 'Jonas'], ['Karla', 'Malou']]]);
  assert.deepEqual(m[b].matches, [[['Dina'], ['Emil']]]);
  assert.deepEqual(rows(srv, 'Kampe').slice(0, 2).map(r => r.slice(0, 4)), [[a, '1', 'A', 'Carl'], [a, '1', 'A', 'Alma']]);
  assert.equal(srv.call('saveMatches', t, a, [['x']]).error, 'The matches could not be read.');
  srv.call('saveMatches', t, b, []);
  assert.deepEqual(Object.keys(srv.call('getGroupData', t).result.matches), [a]);
});

test('an edit in the Spillere tab reaches the app (the cache is cleared)', () => {
  const srv = testServer(), t = login(srv);
  assert.equal(srv.call('getGroupData', t).result.players.length, 16);
  srv.book['Spillere'].getRange(18, 1, 1, 3).setValues([['Ny', '2', '3']]);
  srv.ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'Spillere' }) } });
  assert.equal(srv.call('getGroupData', t).result.players.length, 17);
});

test('a player marked Aktiv = nej is left out', () => {
  const srv = testServer(), t = login(srv);
  srv.book['Spillere'].getRange(1, 4).setValue('Aktiv');
  srv.book['Spillere'].getRange(2, 4).setValue('nej');
  srv.ctx.clearGroupCache();
  assert.ok(!srv.call('getGroupData', t).result.players.some(p => p.name === 'Alma'));
});

test('the script\'s own address forwards to the app, keeping training and drill links', () => {
  const srv = testServer();
  const plain = srv.ctx.doGet({ parameter: {} }).html;
  assert.match(plain, /<a href="https:\/\/1shpshp1\.github\.io\/pasbygger\/"[^>]*>Åbn Pasbygger<\/a>/, 'a button to the app');
  assert.match(plain, /1shpshp1\.github\.io\/pasbygger</, 'the new address is shown, so it can be saved');
  const page = srv.ctx.doGet({ parameter: { s: SESSION_DATES[0], d: 'FA-x"<y' } }).html;
  assert.ok(page.includes('?s=' + SESSION_DATES[0] + '&amp;d=FA-x%22%3Cy'), 'the link keeps both parts, safely encoded');
  assert.ok(!page.includes('"<y'), 'nothing from the address is put into the page unencoded');
});
