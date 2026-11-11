const SHEET_NAME = 'Træningspas Efterår \'26';
const DRILLS_SHEET = 'Øvelser';   // tab with the drill library
/* The password for the "Øvelser" tab is NOT written in this file.
   Set it under Project Settings (gear icon) → Script Properties → Add script property,
   with the name DRILLS_PASSWORD. It stays on the server and is never sent to the page. */
const PASSWORD_PROPERTY = 'DRILLS_PASSWORD';
const LOGIN_SECONDS = 30 * 60;    // a login lasts 30 minutes
const LOGIN_MAX_TRIES = 20;       // wrong codes allowed (for everyone together) ...
const LOGIN_LOCK_SECONDS = 10 * 60;   // ... within 10 minutes, then the login is locked for the rest of that time
const DRILL_CACHE_SECONDS = 6 * 60 * 60;   // the finished library is kept 6 hours, the most Google allows (cleared at once
                                           // when the tabs are edited; warmDrillCache builds it again within 5 minutes)
const SESSION_DRILL_CACHE_SECONDS = 300;   // drills opened from a session are kept 5 min (edits in the sheet show after that)

const ALIAS_SHEET = 'Omdøb';      // optional tab with tag renames (columns: Kolonne, Fra, Til)
const TAGS_SHEET = 'Tags';        // optional tab with the fixed tag list (columns: Kolonne, Tag, Gruppe)
const APP_TITLE = 'Pasbygger';   // shown in the browser tab (of the page that sends people on to the app)

/* Header names in row 1 of the sheet. Column order doesn't matter,
   but these names must match the sheet (capital letters don't matter). */
const HEADERS = {
  iso:      'DatoFormat',      // real date (formatted as date), used to find the next session
  date:     'Dato',            // date text, only used if there is no real date
  theme:    'Tema',          // tag (not shown on the card)
  subtheme: 'Undertema',     // tag (not shown on the card)
  focus:    'Fokus',         // shown as the card title
  notes:    'Noter',
  startup:  'Fælles opstart',
  station1: 'Station 1',
  station2: 'Station 2',
  station3: 'Station 3',
  station4: 'Station 4',
  finish:   'Fælles afslutning'
};

/* Optional columns with the coaches of each part (several names separated by ;). Can be left out. */
const COACH_HEADERS = {
  startup:  'Træner Fælles opstart',
  station1: 'Træner Station 1',
  station2: 'Træner Station 2',
  station3: 'Træner Station 3',
  station4: 'Træner Station 4',
  finish:   'Træner Fælles afslutning'
};

/* The parts of a session, in order (the same keys as in HEADERS and COACH_HEADERS) */
const STATION_KEYS = ['startup', 'station1', 'station2', 'station3', 'station4', 'finish'];

/* Column names in the "Øvelser" tab that the app uses. A header written with other
   capital letters (e.g. "navn") is treated as the same column. */
const DRILL_COLUMNS = ['ID', 'Navn', 'Publiceret', 'Video', 'Diagram', 'Link', 'Noter',
  'Aldersgruppe', 'Temaer', 'Undertemaer', 'Fokus', 'Kategori', 'Sessioner', 'Banestørrelse',
  'Antal spillere min', 'Antal spillere max', 'Varighed min', 'Varighed max',
  'Læringsmål', 'Beskrivelse', 'Felt', 'Fokuspunkter', 'Variationer', 'Konkurrence', 'Format', 'Kilde', 'Materialer',
  'Kampnærhed'];

/* The app itself lives on GitHub Pages (index.html in the repository). This script's own web address only
   sends people there, keeping a link to one training (?s=2026-11-03) or one drill (?d=FA-…), so old
   bookmarks and shared links still work. Change the address here if the app moves (e.g. to its own domain). */
const APP_PAGE_URL = 'https://1shpshp1.github.io/pasbygger/';

function doGet(e) {
  const p = (e && e.parameter) || {};
  const query = ['s', 'd'].filter(k => p[k]).map(k => k + '=' + encodeURIComponent(p[k])).join('&');
  const url = APP_PAGE_URL + (query ? '?' + query : '');
  const attr = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return HtmlService.createHtmlOutput(
      '<base target="_top">' +
      '<p style="font:18px/1.5 Arial,sans-serif;margin:24px">Pasbygger åbner …<br>' +
      'Sker der ikke noget, så tryk her: <a href="' + attr + '">Åbn Pasbygger</a></p>' +
      '<script>try { window.top.location.replace(' + JSON.stringify(url) + '); } catch (err) { /* the link above works */ }</script>')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');   // without this, phones show the page zoomed out
}

/* ---------- API for the app (PWA) ----------
   The app sends POST { action, args } and gets back { result } or { error }.
   Only the functions listed here can be called from outside. */
const API_ACTIONS = {
  getSessions:      getSessions,
  login:            login,
  getDrills:        getDrills,
  getDrillsDa:      getDrillsDa,        // the Danish translations, fetched by the app after the library
  getSessionDrills: getSessionDrills,
  track:            track,              // usage statistics (file Statistik)
  // training groups (file Grupper); called through a function, so it works whatever order the files load in
  getGroupData:     function () { return getGroupData.apply(null, arguments); },
  saveGroups:       function () { return saveGroups.apply(null, arguments); },
  saveSignups:      function () { return saveSignups.apply(null, arguments); }
};

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = API_ACTIONS[req.action];
    if (!fn) throw new Error('Unknown action: ' + req.action);
    out = { result: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSessions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tab "' + SHEET_NAME + '" not found.');
  const tz = ss.getSpreadsheetTimeZone();

  const range    = sheet.getDataRange();
  const values   = range.getValues();            // real Date objects for date cells
  const display  = range.getDisplayValues();     // text exactly as shown in the sheet
  const rich     = range.getRichTextValues();
  const formulas = range.getFormulas();

  // Find each column by its header name
  const norm = s => String(s).trim().toLowerCase();
  const headerRow = display[0].map(norm);
  const col = {};
  const missing = [];
  Object.keys(HEADERS).forEach(key => {
    const idx = headerRow.indexOf(norm(HEADERS[key]));
    if (idx === -1) missing.push(HEADERS[key]);
    col[key] = idx;
  });
  if (missing.length) {
    throw new Error('Column(s) not found in row 1: ' + missing.join(', '));
  }

  // Optional coach columns (not an error if a column is missing)
  const coachCol = {};
  Object.keys(COACH_HEADERS).forEach(key => { coachCol[key] = headerRow.indexOf(norm(COACH_HEADERS[key])); });
  const coachesOf = (r, key) => coachCol[key] === -1 ? [] :
    String(display[r][coachCol[key]] || '').split(/[;\n]/).map(x => x.trim()).filter(x => /[\p{L}\p{N}]/u.test(x));

  // Real date -> "2026-10-12" (empty string if it can't be read as a date)
  function isoDate(v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);   // day.month.year
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return '';
  }

  const drillIdx = drillIndex_();                // which stations belong to a drill in the library

  // { text, url, drillId } for one station cell
  function cell(r, c) {
    const rt = rich[r][c];

    let url = rt.getLinkUrl();
    if (!url) {                                  // link on only part of the text
      const run = rt.getRuns().find(x => x.getLinkUrl());
      if (run) url = run.getLinkUrl();
    }
    if (!url) {                                  // =HYPERLINK("url","text") formulas
      const m = String(formulas[r][c]).match(/HYPERLINK\(\s*"([^"]+)"/i);
      if (m) url = m[1];
    }

    const text = rt.getText() || display[r][c] || "";
    return { text: text, url: url || "", drillId: resolveDrill_(drillIdx, text, url || "") };
  }

  // Notes: a list of pieces [{ text, url }]. Each linked piece is its own link;
  // text without a link stays plain text. Empty list if the cell is empty.
  function segments(r, c) {
    const rt = rich[r][c];
    const out = [];

    rt.getRuns().forEach(run => {
      const text = run.getText().trim();
      const url = run.getLinkUrl() || "";
      if (!text && !url) return;                 // skip blank pieces between links
      out.push({ text: text, url: url });
    });

    // A =HYPERLINK("url","text") formula counts as one link
    if (out.length && !out.some(p => p.url)) {
      const m = String(formulas[r][c]).match(/HYPERLINK\(\s*"([^"]+)"/i);
      if (m) return [{ text: out.map(p => p.text).join(" "), url: m[1] }];
    }
    return out;
  }

  const rows = [];
  for (let r = 1; r < display.length; r++) {
    if (!display[r].some(v => String(v).trim())) continue;   // completely empty row: no card
    const row = {
      date:     display[r][col.date] || display[r][col.iso],
      iso:      isoDate(values[r][col.iso]),
      theme:    display[r][col.theme],
      subtheme: display[r][col.subtheme],
      focus:    display[r][col.focus],
      notes:    segments(r, col.notes)
    };
    STATION_KEYS.forEach(k => {
      const c = cell(r, col[k]);
      c.coaches = coachesOf(r, k);
      row[k] = c;
    });
    rows.push(row);
  }
  try {   // remember which drills the plan uses, so opening a drill doesn't have to re-read the plan
    CacheService.getScriptCache().put('usedIds', JSON.stringify(usedDrillIds_(rows)), SESSION_DRILL_CACHE_SECONDS);
  } catch (e) { /* the cache is only a speed-up */ }
  return rows;
}

/* IDs of all drills that a station in the plan uses */
function usedDrillIds_(rows) {
  const used = {};
  rows.forEach(s => STATION_KEYS.forEach(k => {
    if (s[k] && s[k].drillId) used[s[k].drillId] = true;
  }));
  return Object.keys(used);
}


/* ---------- Drill library (tab "Øvelser") ----------
   One row per drill. Row 1 = column names. "Navn" is required.
   Any extra column you add is shown automatically as a text section.
   Rows with Publiceret = FALSE / nej are hidden. */

/* Called with the password. Returns a code that is valid for 30 minutes. */
function login(password) {
  const cache = CacheService.getScriptCache();
  const pw = PropertiesService.getScriptProperties().getProperty(PASSWORD_PROPERTY);
  if (!pw) return { ok: false, setup: true };                 // the password has not been set up yet

  const tries = +(cache.get('loginTries') || 0);
  if (tries >= LOGIN_MAX_TRIES) return { ok: false, locked: true };

  // The extra code GROUPS_PASSWORD (file Grupper), if set, logs in the same way
  const groupsPw = PropertiesService.getScriptProperties().getProperty(GROUPS_PASSWORD_PROPERTY);
  if (groupsPw && String(password || '').trim() === String(groupsPw).trim()) {
    countToday_({ 'Login til Øvelser': 1 });
    const token = Utilities.getUuid();
    cache.put('tok_' + token, 'g', LOGIN_SECONDS);
    return { ok: true, token: token, seconds: LOGIN_SECONDS, groups: true };
  }

  if (String(password || '').trim() !== String(pw).trim()) {
    cache.put('loginTries', String(tries + 1), LOGIN_LOCK_SECONDS);
    countToday_({ 'Forkert kode': 1 });
    return { ok: false };
  }
  countToday_({ 'Login til Øvelser': 1 });
  const token = Utilities.getUuid();
  cache.put('tok_' + token, '1', LOGIN_SECONDS);
  return { ok: true, token: token, seconds: LOGIN_SECONDS };
}

/* Throws "LOGIN" unless the code is valid. (The trailing underscore keeps it private to the server.) */
function requireToken_(token) {
  const cache = CacheService.getScriptCache();
  const kind = token ? cache.get('tok_' + token) : null;
  if (!kind) throw new Error('LOGIN');
  cache.put('tok_' + token, kind, LOGIN_SECONDS);     // in use: the login lasts another 30 minutes (the app does the same)
}

/* Header row of the "Øvelser" tab, with known column names in their standard spelling */
function drillHeaders_(row) {
  const known = {};
  DRILL_COLUMNS.forEach(n => { known[n.toLowerCase()] = n; });
  return row.map(h => {
    const t = String(h).trim();
    return known[t.toLowerCase()] || t;
  });
}

const isUnpublished_ = v => /^(false|nej|no|0)$/i.test(String(v || '').trim());

/* ---------- Which drill does a station belong to? ----------
   Looks at the "Øvelser" tab (published drills only). A station belongs to a drill if its link carries
   the drill's ID, or if its text is the drill's name. */
const normName_ = v => String(v || '').toLowerCase().replace(/["“”„‟«»'’‘`]/g, '')
  .replace(/[?!.:,]+/g, ' ').replace(/\s+/g, ' ').trim();

function drillIndex_() {
  const idx = { ids: {}, names: {} };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  if (!sheet) return idx;
  const v = sheet.getDataRange().getDisplayValues();
  const h = drillHeaders_(v[0]);
  const iId = h.indexOf('ID'), iName = h.indexOf('Navn'), iPub = h.indexOf('Publiceret');
  if (iId === -1 || iName === -1) return idx;
  for (let r = 1; r < v.length; r++) {
    const id = String(v[r][iId]).trim(), name = normName_(v[r][iName]);
    if (!id || !name) continue;
    if (iPub !== -1 && isUnpublished_(v[r][iPub])) continue;
    if (!idx.ids[id]) idx.ids[id] = true;
    if (!idx.names[name]) idx.names[name] = id;
  }
  return idx;
}

function resolveDrill_(idx, text, url) {
  const m = String(url || '').match(/[?&](?:exerciseId|id)=(\d+)/i);
  if (m && idx.ids[m[1]]) return m[1];
  const p = String(url || '').match(/[?&]d=([^&#]+)/);          // a Pasbygger link: <app>?d=FCK-1677
  let id = '';
  try { id = p ? decodeURIComponent(p[1]) : ''; } catch (e) { id = ''; }
  if (id && idx.ids[id]) return id;
  return idx.names[normName_(text)] || '';
}

/* All published drills of the "Øvelser" tab */
function readDrills_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  if (!sheet) throw new Error('Tab "' + DRILLS_SHEET + '" not found.');

  const range   = sheet.getDataRange();
  const display = range.getDisplayValues();
  const headers = drillHeaders_(display[0]);

  if (headers.indexOf('Navn') === -1) throw new Error('Column "Navn" not found in row 1.');

  // Links are only read for the columns that can hold them (reading them for every cell is slow)
  const rich = {};
  ['Video', 'Diagram', 'Link', 'Noter'].forEach(h => {
    const c = headers.indexOf(h);
    if (c !== -1) rich[c] = sheet.getRange(1, c + 1, display.length, 1).getRichTextValues().map(r => r[0]);
  });

  const drills = [];
  const seen = {};                                   // a drill that appears twice is shown once
  for (let r = 1; r < display.length; r++) {
    const d = {};
    headers.forEach((h, c) => {
      if (!h) return;
      let v = display[r][c];
      if (h === 'Video' || h === 'Diagram' || h === 'Link') {   // use the link if the cell has one
        const rt = rich[c][r];
        const run = rt.getRuns().find(x => x.getLinkUrl());
        const url = rt.getLinkUrl() || (run && run.getLinkUrl()) || '';
        if (h === 'Link') d['__linktext'] = v;                  // label for the link button
        v = url || v;
        if (h === 'Diagram' || h === 'Video') {                 // several pictures/videos: one link per line, all kept
          const all = rt.getRuns().map(x => x.getLinkUrl()).filter(Boolean);
          if (all.length > 1) v = all.filter((u, i) => all.indexOf(u) === i).join('\n');
        }
      }
      if (h === 'Noter') {                                      // every link in Noter stays its own link
        d['__noter'] = rich[c][r].getRuns()
          .map(run => ({ text: run.getText().trim(), url: run.getLinkUrl() || '' }))
          .filter(p => p.text || p.url);
      }
      d[h] = v;
    });
    if (!d['Navn']) continue;
    if (isUnpublished_(d['Publiceret'])) continue;             // checked first, so a hidden copy can't hide a published one
    if (d['ID']) { if (seen[d['ID']]) continue; seen[d['ID']] = true; }
    drills.push(d);
  }
  return { headers: headers, drills: drills };
}

/* The finished library as JSON, with a short version code that changes whenever the content changes.
   It comes in two parts, so the app can show the drills before the translations have arrived:
   'lib' (all drills, without the " (DA)" columns) and 'libda' (the Danish texts, by drill ID).
   Both are kept in the script cache in pieces (each cache value can hold about 100 KB), so most
   requests don't have to read the sheet at all. */
const LIB_PARTS = ['lib', 'libda'];

function libraryJson_() { return libraryPart_('lib'); }
function libraryDaJson_() { return libraryPart_('libda'); }

function libraryPart_(name) {
  const cached = cachedPart_(name);
  if (cached) return cached;
  return buildLibrary_()[name];
}

/* A part from the cache, or null */
function cachedPart_(name) {
  const cache = CacheService.getScriptCache();
  const meta = String(cache.get(name + '_meta') || '').split('|');      // "version|number of pieces"
  if (meta.length !== 2) return null;
  const keys = Array.from({ length: +meta[1] }, (_, i) => name + '_' + i);
  const got = cache.getAll(keys);
  return keys.every(k => got[k] != null) ? { json: keys.map(k => got[k]).join(''), version: meta[0] } : null;
}

/* Reads the sheet once and stores both parts in the cache */
function buildLibrary_() {
  const lib = readDrills_();
  const da = {};
  lib.drills.forEach(d => {
    const t = slimDrill_(d);
    if (t) { da[String(d['ID'] || d['Navn']).trim()] = t; d['__da'] = 1; }
  });
  const parts = {
    lib: JSON.stringify({ headers: lib.headers, drills: lib.drills, aliases: getAliases(), groups: getTagGroups() }),
    libda: JSON.stringify(da)
  };
  const cache = CacheService.getScriptCache();
  const out = {};
  LIB_PARTS.forEach(name => {
    const json = parts[name];
    const version = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, json, Utilities.Charset.UTF_8)).slice(0, 12);
    const put = {};
    let n = 0;
    for (let i = 0; i < json.length; i += 30000) put[name + '_' + n++] = json.slice(i, i + 30000);
    try {
      cache.putAll(put, DRILL_CACHE_SECONDS);
      cache.put(name + '_meta', version + '|' + n, DRILL_CACHE_SECONDS);   // last, so a half-written copy is never used
    } catch (e) { /* cache full: the next request reads the sheet again */ }
    out[name] = { json: json, version: version };
  });
  return out;
}

/* Makes a drill smaller before it is sent: empty cells are left out, the Danish texts are taken out
   (returned, for the 'libda' part), a note without links is sent once (not also as __noter), and
   England Football's picture links lose their long cache codes (the pictures are the same without them). */
function slimDrill_(d) {
  let da = null;
  Object.keys(d).forEach(k => {
    if (/ \(DA\)$/.test(k)) {
      if (String(d[k]).trim()) (da = da || {})[k] = d[k];
      delete d[k];
    } else if (d[k] === '' || d[k] == null) delete d[k];
  });
  if (d['__noter'] && !d['__noter'].some(p => p.url)) delete d['__noter'];
  if (d['Diagram']) d['Diagram'] = String(d['Diagram']).split('\n')
    .map(u => /^https:\/\/cdn\.englandfootball\.com\//.test(u) ? u.split('?')[0] : u).join('\n');
  return da;
}

/* Forget the cached library, so the next request reads the sheet. Runs by itself when the tabs
   "Øvelser", "Omdøb" or "Tags" are edited by hand. Run it yourself after a script has changed them
   (otherwise the change shows within 6 hours). */
function clearDrillCache() {
  const cache = CacheService.getScriptCache();
  LIB_PARTS.forEach(name => cache.remove(name + '_meta'));
}

/* Simple trigger: Google runs this on every edit made by hand in the spreadsheet */
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if ([DRILLS_SHEET, ALIAS_SHEET, TAGS_SHEET].indexOf(name) !== -1) clearDrillCache();
  if ([PLAYERS_SHEET, GROUPS_SHEET, SIGNUPS_SHEET].indexOf(name) !== -1) clearGroupCache();   // players, groups, signups (file Grupper)
}

/* Keeps the library ready in the cache, so no coach has to wait for the sheet to be read.
   Runs every 5 minutes once installWarmTrigger has been run (once). Costs almost nothing when
   the cache is already filled; after an edit it builds the library again. */
function warmDrillCache() {
  let groups = '';
  try { groups = ' ' + warmGroupCache(); } catch (e) { groups = ' Groups: ' + e.message; }   // file Grupper
  if (LIB_PARTS.every(name => cachedPart_(name))) return 'The library is already in the cache.' + groups;
  buildLibrary_();
  return 'The library was built and put in the cache.' + groups;
}

/* Run this ONCE (choose installWarmTrigger above and click Run, then allow access). It makes Google
   run warmDrillCache every 5 minutes. Running it again replaces the old schedule, it doesn't add one. */
function installWarmTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'warmDrillCache')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('warmDrillCache').timeBased().everyMinutes(5).create();
  warmDrillCache();
  const msg = 'warmDrillCache now runs every 5 minutes.';
  Logger.log(msg);
  return msg;
}

/* The whole library: only with a valid login code. If the app already has this version, only
   { unchanged: true } is sent back, which is much faster than sending every drill again.
   daVersion tells the app whether it must fetch the Danish texts again (getDrillsDa). */
function getDrills(token, version) {
  requireToken_(token);
  const lib = libraryJson_();
  const daVersion = libraryDaJson_().version;
  if (version && version === lib.version) return { unchanged: true, version: lib.version, daVersion: daVersion };
  const out = JSON.parse(lib.json);
  out.version = lib.version;
  out.daVersion = daVersion;
  return out;
}

/* The Danish texts of all translated drills: { version, da: { drill ID: { "Navn (DA)": ..., ... } } } */
function getDrillsDa(token, version) {
  requireToken_(token);
  const part = libraryDaJson_();
  if (version && version === part.version) return { unchanged: true, version: part.version };
  return { version: part.version, da: JSON.parse(part.json) };
}

/* One drill, without a login code, but only if a station in the session plan uses it.
   This is what lets any coach open a drill from a session, without being able to browse the library. */
function getSessionDrills(ids) {
  ids = (Array.isArray(ids) ? ids : [ids]).map(x => String(x || '').trim()).filter(Boolean);
  ids = ids.filter((x, i) => ids.indexOf(x) === i).slice(0, 12);
  if (!ids.length) return null;
  const cache = CacheService.getScriptCache();
  const hits = cache.getAll(ids.map(id => 'sd_' + id));        // already looked up in the last minutes
  const out = {}, missing = [];
  ids.forEach(id => {
    try { out[id] = JSON.parse(hits['sd_' + id]); } catch (e) { missing.push(id); }
  });
  if (missing.length) {
    let used = null;
    try { used = JSON.parse(cache.get('usedIds')); } catch (e) { /* not cached */ }
    if (!used) used = usedDrillIds_(getSessions());
    const allowed = missing.filter(id => used.indexOf(id) !== -1);   // only drills the plan really uses
    if (allowed.length) {
      const lib = JSON.parse(libraryJson_().json);
      const da = JSON.parse(libraryDaJson_().json);
      const put = {};
      allowed.forEach(id => {
        const d = lib.drills.find(x => String(x['ID']).trim() === id);
        if (!d) return;
        Object.assign(d, da[id] || {});                             // the translation travels with the drill
        out[id] = { h: lib.headers, d: d };
        put['sd_' + id] = JSON.stringify(out[id]);
      });
      try { cache.putAll(put, SESSION_DRILL_CACHE_SECONDS); } catch (e) { /* too big: skip */ }
    }
  }
  const found = ids.filter(id => out[id]);
  if (!found.length) return null;
  let aliases = null;
  try { aliases = JSON.parse(cache.get('aliasesJson')); } catch (e) { /* not cached */ }
  if (!aliases) {
    aliases = getAliases();
    try { cache.put('aliasesJson', JSON.stringify(aliases), SESSION_DRILL_CACHE_SECONDS); } catch (e) { /* skip */ }
  }
  return { headers: out[found[0]].h, aliases: aliases, drills: found.map(id => out[id].d) };
}


/* ---------- Tag renames (optional tab "Omdøb") ----------
   Row 1: Kolonne | Fra | Til.  Every tag written as "Fra" is shown as "Til" in the app.
   Kolonne is optional; empty means Fokus. The tab can be left out completely. */
function getAliases() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ALIAS_SHEET);
  if (!sheet) return [];
  const v = sheet.getDataRange().getDisplayValues();
  const h = v[0].map(x => String(x).trim().toLowerCase());
  const iFra = h.indexOf('fra'), iTil = h.indexOf('til'), iCol = h.indexOf('kolonne');
  if (iFra === -1 || iTil === -1) return [];
  return v.slice(1).map(r => ({
    col:  iCol === -1 ? 'Fokus' : (String(r[iCol]).trim() || 'Fokus'),
    from: String(r[iFra]).trim(),
    to:   String(r[iTil]).trim()
  })).filter(a => a.from && a.to);
}


/* ---------- Tag groups (optional tab "Tags") ----------
   Row 1: Kolonne | Tag | Gruppe. Tags with a Gruppe are shown under that heading in the app's filter
   (e.g. Fokus "Dribling" under "Med bold – teknik"), in the order of the tab. */
function getTagGroups() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAGS_SHEET);
  if (!sheet) return [];
  const v = sheet.getDataRange().getDisplayValues();
  const h = v[0].map(x => String(x).trim().toLowerCase());
  const iCol = h.indexOf('kolonne'), iTag = h.indexOf('tag'), iGrp = h.indexOf('gruppe');
  if (iCol === -1 || iTag === -1 || iGrp === -1) return [];
  return v.slice(1).map(r => ({
    col:   String(r[iCol]).trim(),
    tag:   String(r[iTag]).trim(),
    group: String(r[iGrp]).trim()
  })).filter(g => g.col && g.tag && g.group);
}
