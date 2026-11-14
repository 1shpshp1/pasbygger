/* ---------- Training groups ----------
   Everyone who is logged in (with the coach code) can make and save groups, under a training or in the
   app's Grupper tab. The players and the saved groups are only sent to a logged-in phone.
   (GROUPS_PASSWORD in Script Properties, if set, is an extra code that logs in the same way. Delete it there
   if you only want one code.)

   Tab "Spillere": one row per player.
     Navn  – the name shown in the app (must be unique)
     Fra   – the lowest level the player can train at (a number, e.g. 1)
     Til   – the highest level (empty = the same as Fra)
     Aktiv – nej / false / 0 hides the player (for example when they have stopped)
   A player without Fra and Til fits in any group.

   Tab "Grupper": written by the app, one row per player per training (Træning, Gruppe, Spiller, Gemt).
   Træning is the training's date (2026-11-03), or the date + " fri" (2026-11-03 fri) for groups made in the
   app's Grupper tab without a training. Earlier groups are what the app uses to vary the groups over time.

   Tab "Tilmeldte": written by the app's "Gem tilmeldte" button, one row per signed-up player per training
   (Træning, Spiller, Gemt). Grupper starts from these ticks when the training has no saved groups yet.
   They are only a starting point: they don't count as groups and don't change how groups are made.

   Tab "Kampe": written by the app's "Gem kampe" button, one row per player per training (Træning, Kamp, Hold,
   Spiller, Gemt). Hold is A or B; within a match, the rows keep the order of the opposite numbers. The saved
   matches are what "Del kampene efter 25-50-25" uses to vary who plays harder and easier matches.

   Speed: the players and groups are kept ready in the cache (cleared when either tab is edited, built again
   after a save and by the 5-minute warm-up), and a phone that already has the newest copy only gets "unchanged". */
const PLAYERS_SHEET = 'Spillere';
const GROUPS_SHEET = 'Grupper';
const GROUPS_PASSWORD_PROPERTY = 'GROUPS_PASSWORD';
const GROUPS_HEADERS = ['Træning', 'Gruppe', 'Spiller', 'Gemt'];
const SIGNUPS_SHEET = 'Tilmeldte';
const SIGNUPS_HEADERS = ['Træning', 'Spiller', 'Gemt'];
const MATCHES_SHEET = 'Kampe';
const MATCHES_HEADERS = ['Træning', 'Kamp', 'Hold', 'Spiller', 'Gemt'];
const GROUP_CACHE = 'grp';                 // cache keys grp_meta ("version|pieces") and grp_0, grp_1, …

/* Run once: makes the two tabs (if missing) */
function setupGroups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const made = [];
  if (!ss.getSheetByName(PLAYERS_SHEET)) {
    const p = ss.insertSheet(PLAYERS_SHEET);
    p.getRange(1, 1, 1, 4).setValues([['Navn', 'Fra', 'Til', 'Aktiv']]).setFontWeight('bold');
    p.setFrozenRows(1);
    made.push(PLAYERS_SHEET);
  }
  if (!ss.getSheetByName(GROUPS_SHEET)) {
    const g = ss.insertSheet(GROUPS_SHEET);
    g.getRange(1, 1, 1, GROUPS_HEADERS.length).setValues([GROUPS_HEADERS]).setFontWeight('bold');
    g.getRange('A:A').setNumberFormat('@');                 // "2026-11-03" stays text, not a date
    g.setFrozenRows(1);
    made.push(GROUPS_SHEET);
  }
  if (!ss.getSheetByName(SIGNUPS_SHEET)) { signupsSheet_(); made.push(SIGNUPS_SHEET); }
  const msg = made.length ? 'Made the tab(s) ' + made.join(' and ') + '.' : 'The tabs were already there.';
  Logger.log(msg);
  return msg;
}

/* A tab written by the app, made if missing */
function appSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let t = ss.getSheetByName(name);
  if (!t) {
    t = ss.insertSheet(name);
    t.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    t.getRange('A:A').setNumberFormat('@');                 // "2026-11-03" stays text, not a date
    t.setFrozenRows(1);
  }
  return t;
}
const signupsSheet_ = () => appSheet_(SIGNUPS_SHEET, SIGNUPS_HEADERS);

/* Replaces one training's rows in a tab written by the app (rows: the new rows, each starting with the key),
   keeping the tab in training order. Returns the time stamp written in the rows. */
function replaceTrainingRows_(sheet, width, key, rows) {
  const old = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getDisplayValues() : [];
  const all = old.filter(r => String(r[0]).trim() !== key).concat(rows);
  all.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);   // (a stable sort: a training's rows keep their order)
  if (old.length) sheet.getRange(2, 1, old.length, width).clearContent();
  if (all.length) {
    const range = sheet.getRange(2, 1, all.length, width);
    range.setNumberFormat('@');                             // keep every cell as plain text
    range.setValues(all);
  }
}

/* A level as a number ("2,5" works too); null if the cell has no number */
function level_(v) {
  const x = parseFloat(String(v).replace(',', '.'));
  return isFinite(x) ? x : null;
}

/* Reads both tabs and puts the result in the cache: { json, version } */
function buildGroupData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ps = ss.getSheetByName(PLAYERS_SHEET);
  if (!ps) throw new Error('Tab "' + PLAYERS_SHEET + '" not found. Run setupGroups first.');
  const rows = ps.getDataRange().getDisplayValues();
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const c = name => head.indexOf(name);
  if (c('navn') === -1) throw new Error('Column "Navn" not found in tab "' + PLAYERS_SHEET + '".');

  const players = [], seen = {};
  rows.slice(1).forEach(r => {
    const name = String(r[c('navn')]).trim();
    if (!name || seen[name] || (c('aktiv') !== -1 && isUnpublished_(r[c('aktiv')]))) return;
    seen[name] = true;
    let lo = c('fra') === -1 ? null : level_(r[c('fra')]);
    let hi = c('til') === -1 ? null : level_(r[c('til')]);
    if (lo === null) lo = hi;
    if (hi === null) hi = lo;
    if (lo !== null && lo > hi) { const t = lo; lo = hi; hi = t; }
    players.push({ name: name, lo: lo, hi: hi });
  });

  const history = {};
  const gs = ss.getSheetByName(GROUPS_SHEET);
  if (gs && gs.getLastRow() > 1) {
    gs.getRange(2, 1, gs.getLastRow() - 1, GROUPS_HEADERS.length).getDisplayValues().forEach(r => {
      const key = String(r[0]).trim(), g = parseInt(r[1], 10), name = String(r[2]).trim();
      if (!key || !(g >= 1) || !name) return;
      const h = history[key] = history[key] || { saved: r[3], groups: [] };
      while (h.groups.length < g) h.groups.push([]);
      h.groups[g - 1].push(name);
    });
  }

  const signups = {};                                     // { "2026-11-03": { saved, names: [...] } }
  const ts = ss.getSheetByName(SIGNUPS_SHEET);
  if (ts && ts.getLastRow() > 1) {
    ts.getRange(2, 1, ts.getLastRow() - 1, SIGNUPS_HEADERS.length).getDisplayValues().forEach(r => {
      const key = String(r[0]).trim(), name = String(r[1]).trim();
      if (!key || !name) return;
      (signups[key] = signups[key] || { saved: r[2], names: [] }).names.push(name);
    });
  }

  const matches = {};                                     // { "2026-11-03": { saved, matches: [[[team A], [team B]], …] } }
  const ms = ss.getSheetByName(MATCHES_SHEET);
  if (ms && ms.getLastRow() > 1) {
    ms.getRange(2, 1, ms.getLastRow() - 1, MATCHES_HEADERS.length).getDisplayValues().forEach(r => {
      const key = String(r[0]).trim(), m = parseInt(r[1], 10), team = String(r[2]).trim().toUpperCase() === 'B' ? 1 : 0;
      const name = String(r[3]).trim();
      if (!key || !(m >= 1) || !name) return;
      const h = matches[key] = matches[key] || { saved: r[4], matches: [] };
      while (h.matches.length < m) h.matches.push([[], []]);
      h.matches[m - 1][team].push(name);
    });
  }

  const json = JSON.stringify({ players: players, history: history, signups: signups, matches: matches });
  const version = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json, Utilities.Charset.UTF_8)).slice(0, 12);
  const put = {};
  let n = 0;
  for (let i = 0; i < json.length; i += 30000) put[GROUP_CACHE + '_' + n++] = json.slice(i, i + 30000);
  try {
    const cache = CacheService.getScriptCache();
    cache.putAll(put, DRILL_CACHE_SECONDS);
    cache.put(GROUP_CACHE + '_meta', version + '|' + n, DRILL_CACHE_SECONDS);   // last, so a half-written copy is never used
  } catch (e) { /* cache full: the next request reads the sheet again */ }
  return { json: json, version: version };
}

/* The cached copy, or null */
function cachedGroupData_() {
  const cache = CacheService.getScriptCache();
  const meta = String(cache.get(GROUP_CACHE + '_meta') || '').split('|');
  if (meta.length !== 2) return null;
  const keys = Array.from({ length: +meta[1] }, (_, i) => GROUP_CACHE + '_' + i);
  const got = cache.getAll(keys);
  return keys.every(k => got[k] != null) ? { json: keys.map(k => got[k]).join(''), version: meta[0] } : null;
}

function clearGroupCache() {
  CacheService.getScriptCache().remove(GROUP_CACHE + '_meta');
}

/* Called by the 5-minute warm-up (warmDrillCache): builds the copy again after an edit */
function warmGroupCache() {
  if (cachedGroupData_()) return 'The groups are already in the cache.';
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PLAYERS_SHEET)) return 'No tab "' + PLAYERS_SHEET + '" yet.';
  buildGroupData_();
  return 'The groups were built and put in the cache.';
}

/* The players, every saved training's groups and the saved signups:
   { version, players: [{ name, lo, hi }], history: { "2026-11-03": { saved, groups: [[names]] } },
     signups: { "2026-11-03": { saved, names: [names] } }, matches: { "2026-11-03": { saved, matches: [[[A], [B]]] } } },
   or { unchanged: true, version } when the phone already has this version.
   (a missing level is sent as null; the app treats it as "fits everywhere") */
function getGroupData(token, version) {
  requireToken_(token);
  const part = cachedGroupData_() || buildGroupData_();
  if (version && version === part.version) return { unchanged: true, version: part.version };
  const out = JSON.parse(part.json);
  out.version = part.version;
  return out;
}

/* Saves one training's groups ([[names]]), replacing what was saved for it before. [] removes them. */
function saveGroups(token, key, groups) {
  requireToken_(token);
  key = String(key || '').trim();
  if (!key || key.length > 40) throw new Error('No training given.');
  if (!Array.isArray(groups) || groups.some(g => !Array.isArray(g))) throw new Error('The groups could not be read.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);                                   // two phones saving at once take turns
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let gs = ss.getSheetByName(GROUPS_SHEET);
    if (!gs) { setupGroups(); gs = ss.getSheetByName(GROUPS_SHEET); }
    const width = GROUPS_HEADERS.length;
    const old = gs.getLastRow() > 1 ? gs.getRange(2, 1, gs.getLastRow() - 1, width).getDisplayValues() : [];
    const saved = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
    const rows = old.filter(r => String(r[0]).trim() !== key);
    groups.forEach((g, i) => g.forEach(name => {
      name = String(name).trim();
      if (name) rows.push([key, String(i + 1), name, saved]);
    }));
    rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);   // by training, so the tab is easy to read
    if (old.length) gs.getRange(2, 1, old.length, width).clearContent();
    if (rows.length) {
      const range = gs.getRange(2, 1, rows.length, width);
      range.setNumberFormat('@');                         // keep every cell as plain text
      range.setValues(rows);
    }
    clearGroupCache();
    buildGroupData_();                                    // the next phone to open Grupper doesn't wait
    return { ok: true, saved: saved };
  } finally {
    lock.releaseLock();
  }
}

/* Saves who has signed up for one training ([names]), replacing what was saved for it before. [] removes them. */
function saveSignups(token, key, names) {
  requireToken_(token);
  key = String(key || '').trim();
  if (!key || key.length > 40) throw new Error('No training given.');
  if (!Array.isArray(names)) throw new Error('The list could not be read.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const saved = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
    const rows = names.map(name => String(name).trim()).filter(Boolean).map(name => [key, name, saved]);
    replaceTrainingRows_(signupsSheet_(), SIGNUPS_HEADERS.length, key, rows);
    clearGroupCache();
    buildGroupData_();
    return { ok: true, saved: saved };
  } finally {
    lock.releaseLock();
  }
}

/* Saves one training's matches ([[[team A names], [team B names]], …]), replacing what was saved for it before.
   [] removes them. */
function saveMatches(token, key, matches) {
  requireToken_(token);
  key = String(key || '').trim();
  if (!key || key.length > 40) throw new Error('No training given.');
  if (!Array.isArray(matches) || matches.some(m => !Array.isArray(m) || m.length !== 2 || !Array.isArray(m[0]) || !Array.isArray(m[1]))) {
    throw new Error('The matches could not be read.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const saved = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
    const rows = [];
    matches.forEach((m, i) => m.forEach((team, t) => team.forEach(name => {
      name = String(name).trim();
      if (name) rows.push([key, String(i + 1), t ? 'B' : 'A', name, saved]);
    })));
    replaceTrainingRows_(appSheet_(MATCHES_SHEET, MATCHES_HEADERS), MATCHES_HEADERS.length, key, rows);
    clearGroupCache();
    buildGroupData_();
    return { ok: true, saved: saved };
  } finally {
    lock.releaseLock();
  }
}
