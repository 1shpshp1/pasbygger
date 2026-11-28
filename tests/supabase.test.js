/* The database (supabase/schema.sql) on a real PostgreSQL started for the test, with a small stand-in for Supabase's
   auth (tests/supabase-shim.sql). Skipped when PostgreSQL is not installed. Checks that the functions give back what
   the Google Sheet server gives, and that the access rules hold: a coach only sees their own team, an assistant sees
   no levels and may only save signups, someone outside the team gets nothing. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const bin = (() => {
  try { return fs.readdirSync('/usr/lib/postgresql').map(v => '/usr/lib/postgresql/' + v + '/bin').find(d => fs.existsSync(d + '/initdb')); }
  catch (e) { return null; }
})();
const skip = bin ? false : 'PostgreSQL is not installed';
const root = path.join(__dirname, '..');
let dir, port, asPg;

function run(file, args, opts) {                     // as the postgres user when the test runs as root (initdb refuses root)
  const cmd = asPg ? ['runuser', ['-u', 'postgres', '--', file].concat(args)] : [file, args];
  return execFileSync(cmd[0], cmd[1], Object.assign({ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }, opts));
}
/* Runs SQL as the database owner, or as a logged-in user (uid) under the access rules. Gives back the last result. */
function sql(text, uid) {
  const wrapped = uid ? `begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}';\n${text}\ncommit;` : text;
  const r = spawnSync(asPg ? 'runuser' : 'psql', (asPg ? ['-u', 'postgres', '--', 'psql'] : []).concat(
    ['-h', dir, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-X']),
    { input: wrapped, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return r.stdout.trim().split('\n').filter(l => l && !/^(BEGIN|COMMIT|SET)$/.test(l)).pop() || '';
}
const json = (text, uid) => JSON.parse(sql(text, uid));
const fails = (text, uid, re) => assert.throws(() => sql(text, uid), re);

const U = { coach: '11111111-1111-1111-1111-111111111111', assistant: '22222222-2222-2222-2222-222222222222',
            other: '33333333-3333-3333-3333-333333333333', leader: '44444444-4444-4444-4444-444444444444' };
let A, B;

test.describe('database (Supabase)', { skip }, () => {
  test.before(() => {
    asPg = process.getuid && process.getuid() === 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasbygger-pg-'));
    if (asPg) execFileSync('chown', ['postgres', dir]);
    port = 20000 + Math.floor(Math.random() * 20000);
    run(bin + '/initdb', ['-D', dir + '/data', '-A', 'trust', '-U', 'postgres', '--no-sync']);
    run(bin + '/pg_ctl', ['-D', dir + '/data', '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, '-w', 'start', '-l', dir + '/log']);
    sql(fs.readFileSync(path.join(__dirname, 'supabase-shim.sql'), 'utf8'));
    const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
    sql(schema);
    sql(schema);                                                // it can be run again
    sql(`insert into auth.users values ('${U.coach}', 'c@x'), ('${U.assistant}', 'a@x'), ('${U.other}', 'o@x'), ('${U.leader}', 'l@x');`);
    const club = sql(`insert into clubs (name) values ('Klub') returning id;`);
    A = sql(`insert into teams (club_id, name) values ('${club}', 'U10') returning id;`);
    B = sql(`insert into teams (club_id, name) values ('${club}', 'U12') returning id;`);
    sql(`insert into team_members values ('${A}', '${U.coach}', 'coach'), ('${A}', '${U.assistant}', 'assistant'),
                                        ('${A}', '${U.leader}', 'admin'), ('${B}', '${U.other}', 'coach');
         insert into players (team_id, name, lo, hi, positions) values ('${A}', 'Alma', 1, 2, 'Keeper'), ('${A}', 'Bo', 2, 3, ''),
                                                                       ('${A}', 'Carl', null, null, ''), ('${B}', 'Dina', 3, 4, '');
         insert into players (team_id, name, lo, hi, active) values ('${A}', 'Gammel', 2, 2, false);`);
  });
  test.after(() => {
    try { run(bin + '/pg_ctl', ['-D', dir + '/data', '-m', 'immediate', 'stop']); } catch (e) { /* already stopped */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the import from the sheet (supabase/import.js) puts a team\'s data in, and the app then gets the same back', () => {
    const { toSql } = require('../supabase/import.js');
    const data = { players: [{ name: "O'Neil", lo: 1, hi: 2, pos: 'Keeper' }, { name: 'Ida', lo: null, hi: null }],
      history: { '2026-10-01': { saved: '01.10.2026 18:30', groups: [["O'Neil"], ['Ida']] } },
      signups: { '2026-10-02': { saved: '02.10.2026 09:00', names: ['Ida'] } },
      matches: { '2026-10-01': { saved: '01.10.2026 18:45', matches: [[["O'Neil"], ['Ida']]] } },
      fixtures: { s1: { saved: '03.10.2026 10:00', name: 'Stævne', games: [{ name: 'K1', date: '2026-10-04', level: 2, size: 5, avail: ['Ida'], players: ['Ida'], locked: [] }] } } };
    sql(toSql(data, B));
    sql(toSql(data, B));                                        // again: nothing doubled
    const d = json(`select get_group_data('${B}');`, U.other);
    assert.deepEqual(d.players.filter(p => p.name !== 'Dina').map(p => [p.name, p.lo, p.hi, p.pos]).sort(), [['Ida', null, null, undefined], ["O'Neil", 1, 2, 'Keeper']]);
    ['history', 'signups', 'matches', 'fixtures'].forEach(k => assert.deepEqual(d[k], data[k], k));
    assert.throws(() => toSql(data, 'not-a-team'), /uuid/);
  });

  test('a coach gets what the sheet server gives: players (active only) with levels, and saved groups', () => {
    const res = json(`select save_groups('${A}', '2026-11-03', '[[" Alma ", "Bo"], ["Carl", ""]]');`, U.coach);
    assert.equal(res.ok, true);
    assert.match(res.saved, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    const d = json(`select get_group_data('${A}');`, U.coach);
    assert.deepEqual(d.players.map(p => p.name).sort(), ['Alma', 'Bo', 'Carl']);
    const alma = d.players.find(p => p.name === 'Alma'), carl = d.players.find(p => p.name === 'Carl');
    assert.deepEqual([alma.lo, alma.hi, alma.pos], [1, 2, 'Keeper']);
    assert.deepEqual([carl.lo, carl.hi, 'pos' in carl], [null, null, false]);
    assert.deepEqual(d.history['2026-11-03'], { saved: res.saved, groups: [['Alma', 'Bo'], ['Carl']] });
    assert.deepEqual([d.signups, d.matches, d.fixtures], [{}, {}, {}]);
    assert.equal(json(`select get_group_data('${A}', '${d.version}');`, U.coach).unchanged, true);
  });

  test('signups, matches and a set of matches are saved and read back; an empty one removes it', () => {
    json(`select save_signups('${A}', '2026-11-05', '["Alma", "Bo"]');`, U.coach);
    json(`select save_matches('${A}', '2026-11-05', '[[["Alma"], ["Bo"], ["Carl"]]]');`, U.coach);
    json(`select save_fixture_set('${A}', 'w1', '{"name": "Weekend", "games": [{"name": "Kamp 1", "date": "2026-11-29", "level": 2,
          "size": 7, "avail": ["Alma", "Bo"], "players": ["Alma", "Ukendt"], "locked": ["Alma"]}]}');`, U.coach);
    let d = json(`select get_group_data('${A}');`, U.coach);
    assert.deepEqual(d.signups['2026-11-05'].names, ['Alma', 'Bo']);
    assert.deepEqual(d.matches['2026-11-05'].matches, [[['Alma'], ['Bo'], ['Carl']]]);
    assert.deepEqual(d.fixtures.w1.games, [{ name: 'Kamp 1', date: '2026-11-29', level: 2, size: 7, avail: ['Alma', 'Bo'], players: ['Alma'], locked: ['Alma'] }]);
    fails(`select save_matches('${A}', 'x', '[[["Alma"]]]');`, U.coach, /could not be read/);
    json(`select save_signups('${A}', '2026-11-05', '[]');`, U.coach);
    json(`select save_fixture_set('${A}', 'w1', '{"games": []}');`, U.coach);
    d = json(`select get_group_data('${A}');`, U.coach);
    assert.deepEqual([d.signups, d.fixtures], [{}, {}]);
  });

  test('someone on another team gets nothing and can save nothing', () => {
    fails(`select get_group_data('${A}');`, U.other, /LOGIN/);
    assert.equal(sql(`select count(*) from players where team_id = '${A}';`, U.other), '0');
    assert.equal(sql(`select count(*) from saved_groups where team_id = '${A}';`, U.other), '0');
    fails(`select save_groups('${A}', '2026-12-01', '[["Alma"]]');`, U.other, /row-level security/);
    assert.ok(json(`select get_group_data('${B}');`, U.other).players.some(p => p.name === 'Dina'));
    fails(`select get_group_data('${A}');`, null, /LOGIN|permission/);          // no login at all
  });

  test('an assistant sees the players without levels and may save signups, not groups', () => {
    const d = json(`select get_group_data('${A}');`, U.assistant);
    assert.ok(d.players.length && d.players.every(p => p.lo === null && p.hi === null));
    assert.equal(sql(`select count(*) from players;`, U.assistant), '0');
    json(`select save_signups('${A}', '2026-11-07', '["Bo"]');`, U.assistant);
    fails(`select save_groups('${A}', '2026-11-07', '[["Bo"]]');`, U.assistant, /row-level security/);
  });

  test('a level change is kept with when and by whom', () => {
    sql(`update players set lo = 2, hi = 3 where name = 'Alma';`, U.coach);
    const log = json(`select json_agg(json_build_object('lo', l.lo, 'hi', l.hi, 'by', l.changed_by) order by l.id)
                      from player_levels l join players p on p.id = l.player_id where p.name = 'Alma';`, U.coach);
    assert.deepEqual(log.map(x => [x.lo, x.hi]), [[1, 2], [2, 3]]);
    assert.equal(log[1].by, U.coach);
  });

  test('a player can be forgotten (GDPR): gone from the list and from every saved training; only by the holdleder', () => {
    json(`select save_signups('${A}', '2026-11-09', '["Bo", "Alma"]');`, U.coach);
    json(`select save_matches('${A}', '2026-11-09', '[[["Bo"], ["Alma"]]]');`, U.coach);
    fails(`select forget_player('${A}', 'Bo');`, U.coach, /holdleder/);
    assert.ok(+sql(`select forget_player('${A}', 'Bo');`, U.leader) >= 3);
    const d = json(`select get_group_data('${A}');`, U.leader);
    assert.ok(!JSON.stringify(d).includes('"Bo"'), 'no trace of Bo');
    assert.deepEqual(d.matches['2026-11-09'].matches, [[[], ['Alma']]]);
  });
});
