#!/usr/bin/env node
/* Moves a team's data from the Google Sheet into the database (supabase/schema.sql): the players and their history,
   the training plan, and the drills from DBU's drill bank (into the shared library; drills from other sources are
   left out for now).

     node supabase/import.js --code <coach code> --team <team id> > import.sql
     node supabase/import.js --file data.json --team <team id> > import.sql      (a saved copy of getGroupData only)

   It logs in to the sheet server (the address in index.html) with the coach code, fetches what the app gets and
   writes SQL. Paste import.sql into Supabase → SQL Editor → Run. Running it again replaces the team's saved
   trainings and plan with the sheet's, and updates the players and drills (nothing else is touched). Players marked
   inactive in the sheet are not sent by the server, so they are not moved; their names stay in the saved groups. */
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

const PARTS = ['startup', 'station1', 'station2', 'station3', 'station4', 'finish'];

/* A drill from DBU's drill bank: its source says DBU, its link goes to dbu.dk, or (as the app reads it) its ID is DBU's
   number – unless its source names another one (FCK, FA, NFF, Egne, …) */
const isDbu = d => {
  const src = String(d['Kilde'] || '').trim();
  if (/(^|[^a-z])dbu([^a-z]|$)/i.test(src) || /(^|\.)dbu\.dk\//i.test(String(d['Link'] || ''))) return true;
  return !src && /^\d+$/.test(String(d['ID'] || '').trim());
};

/* The SQL for the shared library from getDrills' answer (lib) and getDrillsDa's (da): DBU's drills only.
   Gives back { sql, ids, skipped }. */
function libraryToSql(lib, da) {
  const out = ['begin;'], ids = [], from = {};
  let skipped = 0;
  (lib.drills || []).forEach(d => {
    const id = String(d['ID'] || '').trim();
    if (!id || !isDbu(d)) {
      skipped++;
      const src = String(d['Kilde'] || '').split(/[;,]/)[0].trim() || (id ? 'uden kilde, ID ' + id.replace(/[0-9]+$/, '…') : 'uden ID');
      from[src] = (from[src] || 0) + 1;
      return;
    }
    const content = Object.assign({}, d);
    delete content['__da'];
    out.push(`insert into drills (id, source_id, name, content, content_da) values (${q(id)}, 'dbu', ${q(String(d['Navn']).slice(0, 200))}, ${j(content)}, ${j((da || {})[id] || {})})
  on conflict (id) do update set name = excluded.name, content = excluded.content, content_da = excluded.content_da, published = true, updated_at = now();`);
    ids.push(id);
  });
  out.push(`update library_settings set headers = ${j(lib.headers || [])}, aliases = ${j(lib.aliases || [])}, groups = ${j(lib.groups || [])} where id = 1;`);
  out.push('commit;');
  return { sql: out.join('\n') + '\n', ids: ids, skipped: skipped, from: from };
}

/* The SQL for a team's plan from getPlan's sessions, replacing the team's plan. A station keeps its drill only if the
   drill is in the library (drillIds); its text and link stay either way. */
function planToSql(sessions, team, drillIds) {
  if (!/^[0-9a-f-]{36}$/i.test(team)) throw new Error('--team must be the team\'s id (a uuid, from the teams table).');
  const known = new Set(drillIds || []), t = q(team) + '::uuid', out = ['begin;', `delete from trainings where team_id = ${t};`];
  (sessions || []).forEach(s => {
    const parts = {};
    PARTS.forEach(k => {
      const p = s[k] || {};
      parts[k] = { text: String(p.text || ''), url: String(p.url || ''), drillId: known.has(String(p.drillId || '')) ? String(p.drillId) : '',
                   coaches: Array.isArray(p.coaches) ? p.coaches : [] };
    });
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(s.iso || '')) ? q(s.iso) + '::date' : 'null';
    out.push(`insert into trainings (team_id, day, date_text, theme, subtheme, focus, notes, parts) values (${t}, ${day}, ${q(String(s.date || '').slice(0, 60))}, ` +
      `${q(String(s.theme || '').slice(0, 200))}, ${q(String(s.subtheme || '').slice(0, 200))}, ${q(String(s.focus || '').slice(0, 200))}, ${j(s.notes || [])}, ${j(parts)});`);
  });
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
  return {
    group: await call('getGroupData', [login.token, '']),
    plan: (await call('getPlan', [''])).sessions,
    library: await call('getDrills', [login.token, '']),
    da: (await call('getDrillsDa', [login.token, ''])).da
  };
}

if (require.main === module) {
  const arg = name => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };
  (async () => {
    const team = arg('team') || '';
    if (arg('file')) { process.stdout.write(toSql(JSON.parse(fs.readFileSync(arg('file'), 'utf8')), team)); return; }
    const all = await fromSheet(arg('code') || ''), data = all.group;
    const lib = libraryToSql(all.library, all.da);
    process.stdout.write(toSql(data, team) + lib.sql + planToSql(all.plan, team, lib.ids));
    process.stderr.write(`${(data.players || []).length} players, ${Object.keys(data.history || {}).length} trainings with groups, ` +
      `${Object.keys(data.matches || {}).length} with matches, ${Object.keys(data.fixtures || {}).length} sets of matches, ` +
      `${(all.plan || []).length} trainings in the plan, ${lib.ids.length} DBU drills (${lib.skipped} from other sources left out: ` +
      Object.keys(lib.from).sort((a, b) => lib.from[b] - lib.from[a]).map(k => k + ' ' + lib.from[k]).join(', ') + ').\n');
  })().catch(e => { process.stderr.write('Stopped: ' + e.message + '\n'); process.exit(1); });
}

module.exports = { toSql, libraryToSql, planToSql, isDbu };
