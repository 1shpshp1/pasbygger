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
/* Runs SQL as the database owner, as a logged-in user (uid) or without a login ('anon'), under the access rules. Gives back the last result. */
function sql(text, uid) {
  const wrapped = uid === 'anon' ? `begin; set local role anon;\n${text}\ncommit;`          // no login (a player or parent)
    : uid ? `begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}';\n${text}\ncommit;` : text;
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
    fails(`select get_group_data('${A}');`, 'anon', /permission denied/);       // no login at all
  });

  test('an assistant sees the players without levels and may save signups, not groups', () => {
    const d = json(`select get_group_data('${A}');`, U.assistant);
    assert.ok(d.players.length && d.players.every(p => p.lo === null && p.hi === null));
    assert.equal(sql(`select count(*) from players;`, U.assistant), '0');
    json(`select save_signups('${A}', '2026-11-07', '["Bo"]');`, U.assistant);
    fails(`select save_groups('${A}', '2026-11-07', '[["Bo"]]');`, U.assistant, /row-level security/);
  });

  test('a level change (by the admin) is kept with when and by whom', () => {
    sql(`update players set lo = 2, hi = 3 where name = 'Alma';`, U.leader);
    const log = json(`select json_agg(json_build_object('lo', l.lo, 'hi', l.hi, 'by', l.changed_by) order by l.id)
                      from player_levels l join players p on p.id = l.player_id where p.name = 'Alma';`, U.coach);
    assert.deepEqual(log.map(x => [x.lo, x.hi]), [[1, 2], [2, 3]]);
    assert.equal(log[1].by, U.leader);
  });

  test('a player can be forgotten (GDPR): gone from the list and from every saved training; only by the admin', () => {
    json(`select save_signups('${A}', '2026-11-09', '["Bo", "Alma"]');`, U.coach);
    json(`select save_matches('${A}', '2026-11-09', '[[["Bo"], ["Alma"]]]');`, U.coach);
    fails(`select forget_player('${A}', 'Bo');`, U.coach, /admin/);
    assert.ok(+sql(`select forget_player('${A}', 'Bo');`, U.leader) >= 3);
    const d = json(`select get_group_data('${A}');`, U.leader);
    assert.ok(!JSON.stringify(d).includes('"Bo"'), 'no trace of Bo');
    assert.deepEqual(d.matches['2026-11-09'].matches, [[[], ['Alma']]]);
  });
  test('a team\'s training plan: the admin writes it (with 0–8 stations), anyone with the team\'s code reads it (unless it is not public)', () => {
    const t = json(`select save_training('${A}', '{"iso": "2026-12-01", "date": "Tirsdag 1. dec.", "focus": "Afslutninger",
      "notes": [{"text": "Husk kegler", "url": ""}], "station1": {"text": "Skud på mål", "url": "", "drillId": "d1", "coaches": ["Ole", " "]}}');`, U.leader);
    assert.equal(t.ok, true);
    const code = sql(`select plan_code from teams where id = '${A}';`);
    const p = json(`select get_plan('${code}');`, 'anon');
    assert.equal(p.sessions.length, 1);
    const s = p.sessions[0];
    assert.deepEqual([s.iso, s.date, s.focus, s.notes[0].text], ['2026-12-01', 'Tirsdag 1. dec.', 'Afslutninger', 'Husk kegler']);
    assert.deepEqual(s.station1, { text: 'Skud på mål', url: '', drillId: 'd1', coaches: ['Ole'] });
    assert.deepEqual(s.finish, { text: '', url: '', drillId: '', coaches: [] });
    assert.equal(json(`select get_plan('${code}', '${p.version}');`, 'anon').unchanged, true);
    json(`select save_training('${A}', '{"id": "${t.id}", "iso": "2026-12-02", "focus": "Driblinger"}');`, U.leader);
    assert.equal(json(`select get_plan('', '', '${A}');`, U.assistant).sessions[0].focus, 'Driblinger');   // the member's own team
    fails(`select save_training('${A}', '{"focus": "x"}');`, U.other, /admin/);
    fails(`select save_training('${A}', '{"focus": "x"}');`, U.assistant, /admin/);
    fails(`select save_training('${A}', '{"focus": "x"}');`, U.coach, /admin/);          // only the team's admin plans
    const six = json(`select save_training('${A}', '{"iso": "2026-12-03", "stations": 6, "station5": {"text": "Femte"}}');`, U.leader);
    let st = json(`select get_plan('${code}');`, 'anon').sessions.find(x => x.id === six.id);
    assert.deepEqual(Object.keys(st).filter(k => /^station/.test(k)).sort(), ['station1', 'station2', 'station3', 'station4', 'station5', 'station6']);
    assert.equal(st.station5.text, 'Femte');
    json(`select save_training('${A}', '{"id": "${six.id}", "iso": "2026-12-03", "stations": 2, "station5": {"text": "væk"}}');`, U.leader);
    st = json(`select get_plan('${code}');`, 'anon').sessions.find(x => x.id === six.id);
    assert.deepEqual(Object.keys(st).filter(k => /^station/.test(k)).sort(), ['station1', 'station2'], 'fewer stations: the rest are gone');
    json(`select delete_training('${A}', '${six.id}');`, U.leader);
    sql(`update teams set plan_public = false where id = '${A}';`);
    fails(`select get_plan('${code}');`, 'anon', /ikke offentlig/);
    assert.equal(json(`select get_plan('${code}');`, U.coach).sessions.length, 1);
    sql(`update teams set plan_public = true where id = '${A}';`);
    fails(`select get_plan('forkert');`, 'anon', /findes ikke/);
  });

  test('the drill library: only drills from active sources (DBU now), the shared ones and the club\'s own; Danish texts apart', () => {
    const club = sql(`select club_id from teams where id = '${A}';`);
    const other = sql(`insert into clubs (name) values ('Anden klub') returning id;`);
    sql(`insert into library_settings (id, headers) values (1, '["ID", "Navn", "Beskrivelse"]') on conflict (id) do update set headers = excluded.headers;
         insert into drills (id, source_id, name, content, content_da) values
           ('d1', 'dbu', 'Skud på mål', '{"Navn": "Skud på mål", "Beskrivelse": "Fra kanten", "Kilde": "DBU"}', '{}'),
           ('d2', 'dbu', 'Rondo', '{"Navn": "Rondo"}', '{"Navn (DA)": "Rondo på dansk"}'),
           ('FCK-1', 'fck', 'FCK-øvelse', '{"Navn": "FCK-øvelse"}', '{}');
         insert into drills (id, source_id, owner_club, name, content) values
           ('EGNE-1', 'dbu', '${club}', 'Klubbens egen', '{"Navn": "Klubbens egen"}'),
           ('EGNE-2', 'dbu', '${other}', 'Andens egen', '{"Navn": "Andens egen"}');
         insert into drills (id, source_id, name, content, published) values ('d3', 'dbu', 'Skjult', '{"Navn": "Skjult"}', false);`);
    const lib = json(`select get_drills();`, U.coach);
    assert.deepEqual(lib.drills.map(d => d.ID).sort(), ['EGNE-1', 'd1', 'd2']);
    assert.deepEqual(lib.headers, ['ID', 'Navn', 'Beskrivelse']);
    const d1 = lib.drills.find(d => d.ID === 'd1'), d2 = lib.drills.find(d => d.ID === 'd2');
    assert.deepEqual([d1.Kilde, d1.Beskrivelse, '__da' in d1, d2.Kilde, d2.__da], ['DBU', 'Fra kanten', false, 'DBU', 1]);
    assert.equal(json(`select get_drills('${lib.version}');`, U.coach).unchanged, true);
    assert.deepEqual(json(`select get_drills_da();`, U.coach).da, { d2: { 'Navn (DA)': 'Rondo på dansk' } });
    sql(`update drill_sources set active = true where id = 'fck';`);                 // a source switched on later
    assert.ok(json(`select get_drills();`, U.coach).drills.some(d => d.ID === 'FCK-1'));
    sql(`update drill_sources set active = false where id = 'fck';`);
    fails(`select get_drills();`, 'anon', /permission denied/);
    fails(`insert into drills (id, source_id, name, content) values ('x', 'dbu', 'x', '{}');`, U.coach, /row-level security/);
  });

  test('without a login, a drill opens only if the team\'s plan uses it; app opens are counted, nothing about who', () => {
    const code = sql(`select plan_code from teams where id = '${A}';`);
    json(`select save_training('${A}', '{"iso": "2026-12-08", "station2": {"text": "Rondo", "drillId": "d2"}}');`, U.leader);
    const r = json(`select get_session_drills(array['d2', 'd1', 'EGNE-2'], '${code}');`, 'anon');
    assert.deepEqual(r.drills.map(d => d.ID), ['d2']);                             // d1 left the plan when its training was edited;
                                                                                  // the other club's own drill is not in it
    assert.equal(r.drills[0]['Navn (DA)'], 'Rondo på dansk');                       // the translation travels with it
    assert.equal(sql(`select get_session_drills(array['FCK-1', 'd3'], '${code}');`, 'anon'), '');   // not in the plan
    sql(`select track('open', 'true'); select track('open', 'false'); select track('drill', 'd2', 'Rondo');`, 'anon');
    const n = json(`select json_object_agg(what, n) from usage_counts;`);
    assert.deepEqual([n['App åbnet'], n['Unikke telefoner'], n['Øvelser åbnet'], n['Øvelse: Rondo']], [2, 1, 1, 1]);
    fails(`select * from usage_counts;`, 'anon', /permission denied/);
  });
  test('the import moves DBU\'s drills (not other sources) and the team\'s plan; a station keeps only a drill that came along', () => {
    const { libraryToSql, planToSql, isDbu } = require('../supabase/import.js');
    assert.deepEqual([isDbu({ Kilde: 'DBU' }), isDbu({ Link: 'https://web.dbu.dk/fodboldapp?page=Exercise&exerciseId=7' }), isDbu({ Kilde: 'FCK' }), isDbu({ Kilde: 'DBUx' }),
                      isDbu({ ID: '1234' }), isDbu({ ID: '1234', Kilde: 'FCK' }), isDbu({ ID: 'FA-12' })], [true, true, false, false, true, false, false]);
    const lib = { headers: ['ID', 'Navn', 'Beskrivelse'], aliases: [{ col: 'Fokus', from: 'a', to: 'b' }], groups: [],
      drills: [{ ID: '701', Navn: "Kegle-'løb'", Kilde: 'DBU', Beskrivelse: 'Løb', __da: 1 }, { ID: 'FCK-9', Navn: 'FCK', Kilde: 'FCK' }, { Navn: 'Uden id', Kilde: 'DBU' }] };
    const r = libraryToSql(lib, { 701: { 'Beskrivelse (DA)': 'Løb på dansk' } });
    assert.deepEqual([r.ids, r.skipped], [['701'], 2]);
    sql(r.sql); sql(r.sql);
    const code = sql(`select plan_code from teams where id = '${B}';`);
    const plan = [{ iso: '2026-09-01', date: '1. sep.', focus: 'Løb', notes: [], station1: { text: 'Kegleløb', url: '', drillId: '701', coaches: [] },
                    station2: { text: 'FCK-øvelse', url: 'https://fck.better-coaching.dk/x', drillId: 'FCK-9', coaches: [] } }];
    sql(planToSql(plan, B, r.ids)); sql(planToSql(plan, B, r.ids));             // again: replaced, not doubled
    const p = json(`select get_plan('${code}');`, 'anon');
    assert.equal(p.sessions.length, 1);
    assert.deepEqual([p.sessions[0].station1.drillId, p.sessions[0].station2.drillId, p.sessions[0].station2.url], ['701', '', 'https://fck.better-coaching.dk/x']);
    const d = json(`select get_drills();`, U.other).drills.find(x => x.ID === '701');
    assert.deepEqual([d.Navn, d.Beskrivelse, d.Kilde, d.__da], ["Kegle-'løb'", 'Løb', 'DBU', 1]);
    assert.deepEqual(json(`select get_drills();`, U.other).aliases, lib.aliases);
  });
  test('a deleted training can be brought back (90 days); it is gone from the plan meanwhile', () => {
    const code = sql(`select plan_code from teams where id = '${A}';`);
    const t = json(`select save_training('${A}', '{"iso": "2026-12-15", "focus": "Til at slette"}');`, U.leader);
    json(`select delete_training('${A}', '${t.id}');`, U.leader);
    assert.ok(!json(`select get_plan('${code}');`, 'anon').sessions.some(x => x.id === t.id), 'not in the plan');
    const del = json(`select deleted_trainings('${A}');`, U.leader);
    assert.equal(del[0].id, t.id);
    assert.deepEqual([del[0].iso, del[0].focus], ['2026-12-15', 'Til at slette']);
    assert.match(del[0].deleted, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    fails(`select deleted_trainings('${A}');`, U.assistant, /admin/);
    json(`select restore_training('${A}', '${t.id}');`, U.leader);
    assert.ok(json(`select get_plan('${code}');`, 'anon').sessions.some(x => x.id === t.id), 'back in the plan');
    assert.ok(!json(`select deleted_trainings('${A}');`, U.leader).some(x => x.id === t.id));
    fails(`select restore_training('${A}', '${t.id}');`, U.leader, /findes ikke/);
  });

  test('the admin keeps the players: adds, changes levels, renames (the history follows), and only the admin', () => {
    json(`select save_groups('${A}', '2026-12-20', '[["Alma", "Carl"]]');`, U.coach);
    const added = json(`select save_player('${A}', '{"name": "Erik", "lo": "2,5", "hi": "", "positions": "Keeper"}');`, U.leader);
    let list = json(`select team_players('${A}');`, U.leader);
    const erik = list.find(p => p.name === 'Erik');
    assert.deepEqual([erik.id, erik.lo, erik.hi, erik.positions, erik.active], [added.id, 2.5, 2.5, 'Keeper', true]);
    assert.ok(list.some(p => p.name === 'Gammel' && p.active === false), 'inactive players are listed too');
    const carl = list.find(p => p.name === 'Carl');
    json(`select save_player('${A}', '{"id": "${carl.id}", "name": "Carl Emil", "lo": 1, "hi": 3}');`, U.leader);
    assert.deepEqual(json(`select get_group_data('${A}');`, U.coach).history['2026-12-20'].groups, [['Alma', 'Carl Emil']]);
    fails(`select save_player('${A}', '{"name": "alma"}');`, U.leader, /allerede/);
    fails(`select save_player('${A}', '{"name": "X", "lo": 3, "hi": 1}');`, U.leader, /Fra/);
    fails(`select save_player('${A}', '{"name": "Y"}');`, U.coach, /admin/);
    fails(`select team_players('${A}');`, U.coach, /admin/);
    sql(`update players set lo = 0.5 where name = 'Alma';`, U.coach);                 // a coach can't change a level
    assert.notEqual(json(`select team_players('${A}');`, U.leader).find(p => p.name === 'Alma').lo, 0.5);
    json(`select save_player('${A}', '{"id": "${erik.id}", "name": "Erik", "lo": 2, "hi": 3, "active": false}');`, U.leader);
    assert.ok(!json(`select get_group_data('${A}');`, U.coach).players.some(p => p.name === 'Erik'), 'inactive: not in Grupper');
  });

  test('coaches join by an invitation link (once, 14 days); the admin sets roles and removes; a team keeps one admin', () => {
    const NEW = '55555555-5555-5555-5555-555555555555';
    sql(`insert into auth.users values ('${NEW}', 'ny@x');`);
    fails(`select create_invite('${A}', 'coach');`, U.coach, /admin/);
    const inv = json(`select create_invite('${A}', 'assistant');`, U.leader);
    assert.match(inv.code, /^[0-9A-F]{10}$/);
    assert.deepEqual(json(`select invite_info('${inv.code.toLowerCase()}');`, 'anon'), { team: 'U10', club: 'Klub', role: 'assistant' });
    assert.equal(json(`select team_invites_list('${A}');`, U.leader)[0].code, inv.code);
    const r = json(`select accept_invite('${inv.code}');`, NEW);
    assert.deepEqual([r.team_id, r.team, r.role], [A, 'U10', 'assistant']);
    fails(`select accept_invite('${inv.code}');`, U.other, /brugt eller udløbet/);
    assert.equal(sql(`select invite_info('${inv.code}');`, 'anon'), '');
    const members = json(`select team_members_list('${A}');`, NEW);
    assert.ok(members.some(m => m.email === 'ny@x' && m.role === 'assistant' && m.me));
    json(`select set_member_role('${A}', '${NEW}', 'coach');`, U.leader);
    assert.equal(json(`select my_teams();`, NEW).find(t => t.id === A).role, 'coach');
    fails(`select set_member_role('${A}', '${U.leader}', 'coach');`, U.leader, /mindst én admin/);
    fails(`select remove_member('${A}', '${U.leader}');`, U.leader, /mindst én admin/);
    fails(`select set_member_role('${A}', '${NEW}', 'admin');`, U.coach, /admin/);
    const old = json(`select create_invite('${A}', 'coach');`, U.leader);
    json(`select revoke_invite('${A}', '${old.code}');`, U.leader);
    assert.equal(sql(`select invite_info('${old.code}');`, 'anon'), '');
    sql(`update team_invites set expires_at = now() - interval '1 day' where code = '${json(`select create_invite('${A}', 'coach');`, U.leader).code}';`);
    assert.equal(json(`select team_invites_list('${A}');`, U.leader).length, 0, 'expired ones are not listed');
    json(`select remove_member('${A}', '${NEW}');`, U.leader);
    assert.deepEqual(json(`select my_teams();`, NEW), []);
  });

  test('own drills (ready for the own library): app admins keep the shared ones, club admins their club\'s; hidden until the source is on', () => {
    const club = sql(`select club_id from teams where id = '${A}';`);
    fails(`select save_drill('{"name": "Min øvelse"}');`, U.leader, /redaktører/);
    sql(`insert into app_admins values ('${U.leader}');`);
    const d = json(`select save_drill('{"name": "Min øvelse", "content": {"Beskrivelse": "Løb"}, "media": [{"type": "animation", "frames": []}]}');`, U.leader);
    assert.match(d.id, /^EGNE-[0-9A-F]{8}$/);
    sql(`insert into club_admins values ('${club}', '${U.coach}') on conflict do nothing;`);
    const own = json(`select save_drill('{"owner_club": "${club}", "name": "Klubøvelse"}');`, U.coach);
    fails(`select save_drill('{"id": "d1", "name": "x"}');`, U.leader, /Kun egne/);
    assert.ok(!json(`select get_drills();`, U.other).drills.some(x => x.ID === d.id || x.ID === own.id), 'source off: not shown');
    assert.ok(json(`select get_drills();`, U.coach).drills.some(x => x.ID === own.id), 'but the club admin sees it, to work on it');
    sql(`update drill_sources set active = true where id = 'egne';`);
    const lib = json(`select get_drills();`, U.coach).drills;
    assert.deepEqual(lib.filter(x => [d.id, own.id].includes(x.ID)).map(x => [x.Navn, x.Kilde]).sort(), [['Klubøvelse', 'Træningsparat'], ['Min øvelse', 'Træningsparat']]);
    assert.ok(!json(`select get_drills();`, '55555555-5555-5555-5555-555555555555').drills.some(x => x.ID === own.id), 'someone outside the club does not see it');
    sql(`update drill_sources set active = false where id = 'egne';`);
  });
});
