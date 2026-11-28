#!/usr/bin/env node
/* Moves a team's players and history from the Google Sheet into the database (supabase/schema.sql).

     node supabase/import.js --code <coach code> --team <team id> > import.sql
     node supabase/import.js --file data.json --team <team id> > import.sql      (a saved copy of getGroupData)

   It logs in to the sheet server (the address in index.html) with the coach code, fetches what the Grupper tab
   gets (players, groups, signups, matches, sets of matches) and writes SQL that puts it on the team. Paste
   import.sql into Supabase → SQL Editor → Run. Running it again replaces the team's saved trainings with the
   sheet's and updates the players (nothing else is touched). Players marked inactive in the sheet are not sent by
   the server, so they are not moved; their names stay in the saved groups. */
const fs = require('fs'), path = require('path');

const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const j = v => q(JSON.stringify(v)) + '::jsonb';
const num = v => v == null || !isFinite(v) ? 'null' : String(Math.round(v * 10) / 10);
// "dd.MM.yyyy HH:mm" in Danish time (as the sheet writes it), or now
const when = s => /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(String(s || ''))
  ? `(to_timestamp(${q(s)}, 'DD.MM.YYYY HH24:MI')::timestamp at time zone 'Europe/Copenhagen')` : 'now()';

/* The SQL for one team from getGroupData's answer */
function toSql(data, team) {
  if (!/^[0-9a-f-]{36}$/i.test(team)) throw new Error('--team must be the team\'s id (a uuid, from the teams table).');
  const t = q(team) + '::uuid', out = ['begin;'];
  (data.players || []).forEach(p => {
    out.push(`insert into players (team_id, name, lo, hi, positions) values (${t}, ${q(p.name)}, ${num(p.lo)}, ${num(p.hi)}, ${q(p.pos || '')})
  on conflict (team_id, name) do update set lo = excluded.lo, hi = excluded.hi, positions = excluded.positions, active = true;`);
  });
  const each = (obj, f) => Object.keys(obj || {}).sort().forEach(k => f(k, obj[k]));
  each(data.history, (k, h) => out.push(`insert into saved_groups (team_id, key, groups, saved_at) values (${t}, ${q(k)}, ${j(h.groups)}, ${when(h.saved)})
  on conflict (team_id, key) do update set groups = excluded.groups, saved_at = excluded.saved_at;`));
  each(data.signups, (k, h) => out.push(`insert into saved_signups (team_id, key, names, saved_at) values (${t}, ${q(k)}, ${j(h.names)}, ${when(h.saved)})
  on conflict (team_id, key) do update set names = excluded.names, saved_at = excluded.saved_at;`));
  each(data.matches, (k, h) => out.push(`insert into saved_matches (team_id, key, matches, saved_at) values (${t}, ${q(k)}, ${j(h.matches)}, ${when(h.saved)})
  on conflict (team_id, key) do update set matches = excluded.matches, saved_at = excluded.saved_at;`));
  each(data.fixtures, (k, h) => out.push(`insert into fixture_sets (team_id, id, name, games, saved_at) values (${t}, ${q(k)}, ${q(h.name || '')}, ${j(h.games)}, ${when(h.saved)})
  on conflict (team_id, id) do update set name = excluded.name, games = excluded.games, saved_at = excluded.saved_at;`));
  out.push('commit;');
  return out.join('\n') + '\n';
}

async function fromSheet(code) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const url = (html.match(/const API_URL = "([^"]+)"/) || [])[1];
  if (!url) throw new Error('API_URL not found in index.html.');
  const call = async (action, args) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, args }) });
    const res = JSON.parse(await r.text());
    if (res.error) throw new Error(res.error);
    return res.result;
  };
  const login = await call('login', [code]);
  if (!login || !login.ok) throw new Error('The coach code was not accepted.');
  return call('getGroupData', [login.token, '']);
}

if (require.main === module) {
  const arg = name => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };
  (async () => {
    const team = arg('team') || '';
    const data = arg('file') ? JSON.parse(fs.readFileSync(arg('file'), 'utf8')) : await fromSheet(arg('code') || '');
    process.stdout.write(toSql(data, team));
    process.stderr.write(`${(data.players || []).length} players, ${Object.keys(data.history || {}).length} trainings with groups, ` +
      `${Object.keys(data.matches || {}).length} with matches, ${Object.keys(data.fixtures || {}).length} sets of matches.\n`);
  })().catch(e => { process.stderr.write('Stopped: ' + e.message + '\n'); process.exit(1); });
}

module.exports = { toSql };
