/* ---------- Tag structure: DBU's categories lead, FCK fits into them ----------
   Filters in the app: Kilde · Tema · Undertema · Fokus · Format · Aldersgruppe
   - DBU drills: Tema and Undertema are not touched. Fokus spellings are merged (FOKUS_MERGE),
     and session words that are not coaching points are removed (FOKUS_DROP).
   - FCK drills get one DBU Tema and one Undertema, and DBU's Fokus words where they exist.
   - Every drill gets Kilde (DBU / FCK / Egne) and Format (from the title, and FCK's old formats).
   - FCK training videos (titles like "U10 træning") are unpublished.

   1. Run previewNewStructure. It writes the tab "Ny struktur" with every drill that would change.
      Nothing in "Øvelser" is changed yet.
   2. If it looks right, run applyNewStructure. It writes the tags, rebuilds the "Tags" tab
      (the old one is kept as "Tags (gammel)") and adds the Fokus merges to the "Omdøb" tab.
   It is safe to run again, e.g. after a new import. */
const STRUCTURE_PREVIEW_SHEET = 'Ny struktur';
const STRUCTURE_COLS = ['Kilde', 'Temaer', 'Undertemaer', 'Fokus', 'Format', 'Kategori'];

const DBU_TEMAER = ['VI har bolden', 'DE har bolden', 'Omstillinger VI-DE', 'Omstillinger DE-VI', 'Leg'];

/* DBU Fokus written in several ways -> one spelling */
const FOKUS_MERGE = {
  'Genpres eller returløb?': ['Genpres el. returløb?', 'Returløb eller genpres?'],
  'Selv eller sammen?': ['Løse selv eller sammen?', 'Løse spillet selv eller løse det sammen?'],
  'Spil igennem pres': ['Spille igennem pres'],
  'Halvvending': ['Halvvende sig'],
  'Boldholders orientering': ['Boldholderes orientering'],
  'Erobre eller forsvare?': ['Forsvare eller erobre?'],
  'Lukke pasningslinjer': ['Lukke linjer'],
  'Opsøge eller tiltrække pres': ['Opsøge pres', 'Mod til at opsøge/tiltrække pres'],
  'Gøre banen bred': ['Skabe bredde']
};
/* Words in Fokus that describe the session, not a coaching point */
const FOKUS_DROP = ['Kamp', 'Kampdag', 'Spilledag', 'Humør', 'Masser af mål'];

/* FCK Fokus (from the earlier import) -> DBU's words, or new FCK words where DBU has none.
   [] = dropped. Words not listed are kept as they are. */
const FCK_FOKUS = {
  'førsteberøring': ['Aktiv 1. berøring'],
  'finter': ['Finte + temposkifte'],
  'cuts og vendinger': ['Cuts', 'Retvending'],
  'afslutning': ['Sparketeknik'],
  'aflevering': ['Sparketeknik'],
  'dribling': ['Dribling'],
  'agility': ['Koordination'],
  'balance': ['Koordination'],
  'orientering': ['Orientering'],
  'genpres': ['Genpres eller returløb?'],
  'pres': ['Sprinte i pres'],
  'bevægelse efter aflevering': ['Spil, og løb!'],
  'bredde og dybde': ['Gøre banen stor'],
  'drible eller spille': ['Selv eller sammen?'],
  'temposkift': [], 'lavt tyngdepunkt': [], 'spil i overtal': [], 'spilbarhed': []
};
/* FCK's own categories (a fresh import puts them in Undertemaer / Temaer) -> the earlier words */
const FCK_RAW = {
  'afleveringer': ['fokus', 'Aflevering'], 'afslutninger': ['fokus', 'Afslutning'], 'cuts': ['fokus', 'Cuts og vendinger'],
  'vendinger': ['fokus', 'Cuts og vendinger'], 'driblinger': ['fokus', 'Dribling'], 'finter': ['fokus', 'Finter'],
  'førsteberøringer': ['fokus', 'Førsteberøring'], '2v1': ['kat', '2v1'], '2v2': ['kat', '2v2'], '3v2': ['kat', '3v2'],
  'horst wein spil': ['kat', 'Horst Wein'], 'possession spil': ['kat', 'Boldbesiddelse']
};
const FCK_RAW_TEMA = { 'basisteknik': 'Teknik' };

/* Fokus words that only FCK drills have, with their heading in the filter */
const FCK_FOKUS_GROUPS = {
  'Dribling': 'Teknik', 'Cuts': 'Teknik',
  'Koordination': 'Krop og motorik',
  'Gribeteknik': 'Keeper', 'Faldteknik': 'Keeper', 'Placering': 'Keeper'
};

/* Format from FCK's old Kategori (kept), the rest of Kategori is dropped */
const FCK_FORMATS = ['1v1', '2v1', '2v2', '3v2', 'Horst Wein', 'Kampspil', 'Boldbesiddelse'];
/* Named game forms in titles: [pattern, Format, only for FCK drills] */
const FORMAT_WORDS = [
  [/minisoccer/, 'Minisoccer'], [/interval/, 'Intervalspil'], [/hammeren/, 'Hammeren'],
  [/united/, 'United'], [/3-holdsspil/, '3-holdsspil'], [/bolden hos træneren/, 'Bolden hos træneren'],
  [/wael/, 'Wael-spillet'], [/horst\s*wein/, 'Horst Wein'],
  [/rondo|possession|boldbesiddelse/, 'Boldbesiddelse', true], [/kamp(e|spil)?\b/, 'Kampspil', true]
];
const FORMAT_GROUP_NAMES = ['Antal spillere', 'Spilform'];

function previewNewStructure() {
  const plan = structurePlan_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = ss.getSheetByName(STRUCTURE_PREVIEW_SHEET) || ss.insertSheet(STRUCTURE_PREVIEW_SHEET);
  out.clear();
  const cols = ['Kilde', 'Temaer', 'Undertemaer', 'Fokus', 'Format'];
  const head = ['ID', 'Navn'];
  cols.forEach(c => head.push(c + ' før', c + ' efter'));
  head.push('Bemærkning');
  const rows = plan.changes.map(ch => {
    const r = [ch.id, ch.name];
    cols.forEach(c => r.push(ch.before[c], ch.after[c]));
    r.push(ch.note || '');
    return r;
  });
  const all = [head].concat(rows.length ? rows : [['Ingen ændringer'].concat(Array(head.length - 1).fill(''))]);
  out.getRange(1, 1, all.length, head.length).setNumberFormat('@').setValues(all);
  out.getRange(1, 1, 1, head.length).setFontWeight('bold');
  out.setFrozenRows(1);
  const msg = plan.changes.length + ' drill(s) would change. See the tab "' + STRUCTURE_PREVIEW_SHEET + '".';
  Logger.log(msg);
  return msg;
}

function applyNewStructure() {
  const plan = structurePlan_();
  const sheet = plan.sheet;

  // Missing columns are added at the end of row 1
  let headers = plan.headers.slice();
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const missing = STRUCTURE_COLS.concat(['Publiceret']).filter(c => headers.indexOf(c) === -1);
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }

  // Each column is written in one go; cells of unchanged rows keep their value
  const nRows = plan.values.length - 1;
  STRUCTURE_COLS.concat(['Publiceret']).forEach(c => {
    const ci = headers.indexOf(c);
    const col = [];
    for (let r = 1; r <= nRows; r++) col.push([ci < plan.values[r].length ? plan.values[r][ci] : '']);
    let touched = false;
    plan.changes.forEach(ch => {
      if (c === 'Publiceret') {
        if (!ch.unpublish) return;
        const old = col[ch.row - 1][0];
        col[ch.row - 1] = [typeof old === 'boolean' ? false : 'FALSE'];
      } else col[ch.row - 1] = [ch.after[c]];
      touched = true;
    });
    if (touched && nRows) sheet.getRange(2, ci + 1, nRows, 1).setValues(col);
  });

  writeTagsTab_();
  addFokusMerges_();
  try { CacheService.getScriptCache().remove('aliasesJson'); } catch (e) { /* only a speed-up */ }
  const msg = plan.changes.length + ' drill(s) changed. "' + TAGS_SHEET + '" rebuilt, Fokus merges added to "' + ALIAS_SHEET + '".';
  Logger.log(msg);
  return msg;
}

/* Works out the new tags of every drill. Changes nothing. */
function structurePlan_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  if (!sheet) throw new Error('Tab "' + DRILLS_SHEET + '" not found.');
  const values = sheet.getDataRange().getValues();
  const display = sheet.getDataRange().getDisplayValues();
  const headers = drillHeaders_(display[0]);
  const cell = (r, h) => headers.indexOf(h) === -1 ? '' : String(display[r][headers.indexOf(h)] || '');

  const merge = {};
  Object.keys(FOKUS_MERGE).forEach(to => FOKUS_MERGE[to].forEach(f => { merge[tagKey_(f)] = to; }));
  const drop = {};
  FOKUS_DROP.forEach(f => { drop[tagKey_(f)] = true; });
  const addTo = (list, v) => { if (v && !list.some(x => tagKey_(x) === tagKey_(v))) list.push(v); };

  const changes = [];
  for (let r = 1; r < display.length; r++) {
    const id = cell(r, 'ID').trim();
    if (!id || !cell(r, 'Navn').trim()) continue;
    const kilde = /^FCK-/i.test(id) ? 'FCK' : (/^\d+$/.test(id) ? 'DBU' : 'Egne');
    const before = {};
    STRUCTURE_COLS.forEach(c => { before[c] = cell(r, c); });
    const after = Object.assign({}, before, { Kilde: kilde });
    const name = cell(r, 'Navn').toLowerCase();
    let note = '', unpublish = false;

    // A freshly imported FCK drill still has FCK's own categories: read them as the earlier words
    let fokusIn = splitTags_(before.Fokus), katIn = splitTags_(before.Kategori), temaIn = splitTags_(before.Temaer);
    const fresh = kilde === 'FCK' && !(temaIn.length === 1 && DBU_TEMAER.indexOf(temaIn[0]) !== -1 && splitTags_(before.Undertemaer).length);
    if (fresh) splitTags_(before.Undertemaer).forEach(v => {
      const raw = FCK_RAW[tagKey_(v)];
      if (!raw) return;
      if (raw[0] === 'fokus') fokusIn.push(raw[1]); else katIn.push(raw[1]);
    });
    if (fresh) temaIn = temaIn.map(v => FCK_RAW_TEMA[tagKey_(v)] || v);
    if (fresh && temaIn.some(v => tagKey_(v) === 'spil')) katIn.push('Kampspil');

    // Fokus: merged spellings, session words removed; FCK words translated
    const fokus = [];
    fokusIn.forEach(v => {
      const k = tagKey_(v);
      if (drop[k]) return;
      if (kilde === 'FCK' && FCK_FOKUS[k]) { FCK_FOKUS[k].forEach(x => addTo(fokus, x)); return; }
      addTo(fokus, merge[k] || v);
    });
    after.Fokus = fokus.join('; ');

    // Format: numbers and game forms in the title, plus FCK's old formats from Kategori
    // (only for drills without a Format: a Format you have set or corrected yourself is kept as it is)
    const format = splitTags_(before.Format);
    const kat = katIn;
    if (!format.length) {
      formatsFromTitle_(name).forEach(f => addTo(format, f));
      FORMAT_WORDS.forEach(w => { if ((!w[2] || kilde === 'FCK') && w[0].test(name)) addTo(format, w[1]); });
    }
    kat.forEach(v => { const f = FCK_FORMATS.find(x => tagKey_(x) === tagKey_(v)); if (f) addTo(format, f); });
    after.Format = sortFormats_(format).join('; ');
    after.Kategori = '';                                           // its content now lives in Format

    // FCK: one DBU Tema and one Undertema (kept if the drill already has a DBU Tema and Undertema)
    if (kilde === 'FCK') {
      const tema = temaIn;
      if (fresh) {
        const pick = fckPhase_(tema, fokusIn, kat, cell(r, 'Beskrivelse') + ' ' + cell(r, 'Materialer'), name);
        after.Temaer = pick[0];
        after.Undertemaer = pick[1];
        if (!pick[0]) note = 'Ingen Tema fundet – sæt den selv';
      }
      if (/^u\d+(\s*-\s*u\d+)?\s+træning$/i.test(cell(r, 'Navn').trim())) {   // recordings of whole sessions
        after.Temaer = ''; after.Undertemaer = '';
        unpublish = !/^(false|nej|no|0)$/i.test(cell(r, 'Publiceret').trim());
        note = 'Træningsvideo – afpubliceres';
      }
    }

    const changed = STRUCTURE_COLS.some(c => before[c].trim() !== after[c]) || unpublish;
    if (changed) changes.push({ row: r, id: id, name: cell(r, 'Navn'), before: before, after: after, note: note, unpublish: unpublish });
  }
  return { sheet: sheet, values: values, headers: headers, changes: changes };
}

/* The DBU phase of an FCK drill, from its earlier tags. Returns [Tema, Undertema]. */
function fckPhase_(tema, fokus, kat, text, name) {
  const has = (list, words) => list.some(v => words.indexOf(tagKey_(v)) !== -1);
  const withBall = /bold|dribl/i.test(text) || has(fokus, ['dribling', 'finter', 'afslutning', 'aflevering', 'førsteberøring']);
  if (has(tema, ['keeper']) || has(fokus, ['gribeteknik', 'faldteknik', 'placering'])) return ['DE har bolden', 'Keeper'];
  const attack = has(tema, ['teknik', 'spilforståelse']);
  if (has(kat, ['fangeleg', 'fun game', 'fun games']) || (has(tema, ['koordination']) && !has(kat, ['1v1', '2v1', '2v2', '3v2']))) {
    return ['Leg', withBall ? 'Med bold' : 'Uden bold'];
  }
  if (has(kat, ['kampspil', 'boldbesiddelse'])) return ['VI har bolden', 'Opbygningsspil'];
  if (has(fokus, ['afslutning'])) return ['VI har bolden', 'Afslutningsspil'];
  if (has(fokus, ['dribling', 'finter', 'cuts og vendinger'])) return ['VI har bolden', 'Gennembrudsspil'];
  if (has(fokus, ['aflevering', 'førsteberøring', 'spilbarhed', 'orientering'])) return ['VI har bolden', 'Opbygningsspil'];
  if (has(fokus, ['pres', 'genpres']) && !attack) return ['DE har bolden', 'Forsvarsspil'];
  if (attack) return ['VI har bolden', 'Opbygningsspil'];
  if (/\b[12]v[12]\b/.test(name || '')) return ['VI har bolden', 'Gennembrudsspil'];   // 1v1 / 2v1 in the title
  return ['', ''];
}

/* Player numbers in a title, written exactly as in the title but without spaces:
   "2v1", "4 mod 2", "3:1", "4 vs. 4" -> 2v1, 4v2, 3v1, 4v4; "2+2 v 2+2" -> 2+2v2+2, "3v3 + 2" -> 3v3+2.
   "2 x 3-mandsmål" and "5-mandsmål" are not formats. */
function formatsFromTitle_(title) {
  const out = [];
  const side = '(\\d{1,2}(?:\\s*\\+\\s*\\d{1,2})*)';
  const re = new RegExp('(?:^|[^\\d+])' + side + '\\s*(?:v|vs\\.?|mod|:)\\s*' + side + '(?![\\d+]|\\s*-?\\s*mands)', 'gi');
  const tidy = x => x.replace(/\s+/g, '');
  let m;
  while ((m = re.exec(String(title)))) {
    const f = tidy(m[1]) + 'v' + tidy(m[2]);
    if (out.indexOf(f) === -1) out.push(f);
  }
  return out;
}

/* Is this Format a number of players (1v1, 3v3+2, 7+1v7+1)? */
const isPlayerFormat_ = f => /^\d+(\+\d+)*v\d+(\+\d+)*$/.test(f);

/* One time: drills whose title has a "+" format get it exactly as in the title (e.g. 2+1v3 instead of 3v3).
   Only the player numbers in Format are replaced; Minisoccer, Intervalspil etc. are kept. */
function refreshPlusFormats() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  const values = sheet.getDataRange().getValues();
  const h = drillHeaders_(values[0].map(String));
  const iN = h.indexOf('Navn'), iF = h.indexOf('Format');
  if (iF === -1) throw new Error('Column "Format" not found. Run applyNewStructure first.');
  const changed = [];
  const col = values.slice(1).map(r => {
    const fromTitle = formatsFromTitle_(r[iN]);
    if (!fromTitle.some(f => f.indexOf('+') !== -1)) return [r[iF]];
    const keep = splitTags_(r[iF]).filter(f => !isPlayerFormat_(f));
    const now = sortFormats_(fromTitle.concat(keep)).join('; ');
    if (now !== String(r[iF])) changed.push(r[iN] + ': ' + r[iF] + ' -> ' + now);
    return [now];
  });
  if (col.length) sheet.getRange(2, iF + 1, col.length, 1).setValues(col);
  writeTagsTab_();
  changed.forEach(c => Logger.log(c));
  const msg = changed.length + ' drill(s) got their Format from the title. "' + TAGS_SHEET + '" rebuilt.';
  Logger.log(msg);
  return msg;
}

/* Numbers first (1v1, 2v1, 2v2 …), then named game forms */
function sortFormats_(list) {
  const total = side => side.split('+').reduce((n, x) => n + Number(x), 0);
  const num = v => {
    if (!isPlayerFormat_(v)) return null;
    const p = v.split('v');
    return [total(p[0]) + total(p[1]), total(p[0]), v.indexOf('+') === -1 ? 0 : 1];   // plain before "+" forms
  };
  return list.slice().sort((a, b) => {
    const x = num(a), y = num(b);
    if (x && y) return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.localeCompare(b);
    if (x) return -1;
    if (y) return 1;
    return a.localeCompare(b, 'da');
  });
}

/* Rebuilds the "Tags" tab from the drills: Kilde, Temaer, Fokus under the Tema it is used in, Format in two groups */
function writeTagsTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DRILLS_SHEET);
  const v = sheet.getDataRange().getDisplayValues();
  const h = drillHeaders_(v[0]);
  const at = c => h.indexOf(c);

  const fokusTema = {}, dbuTema = {}, fokusName = {}, formats = {};
  v.slice(1).forEach(row => {
    const tema = at('Temaer') === -1 ? '' : splitTags_(row[at('Temaer')])[0] || '';
    const isDbu = /^\d+$/.test(String(row[at('ID')]).trim());
    if (at('Fokus') !== -1) splitTags_(row[at('Fokus')]).forEach(f => {
      const k = tagKey_(f);
      fokusName[k] = fokusName[k] || f;
      [fokusTema].concat(isDbu ? [dbuTema] : []).forEach(map => {     // DBU's own use decides the group
        const t = map[k] = map[k] || {};
        t[tema] = (t[tema] || 0) + 1;
      });
    });
    if (at('Format') !== -1) splitTags_(row[at('Format')]).forEach(f => { formats[f] = (formats[f] || 0) + 1; });
  });

  const rows = [];
  ['DBU', 'FCK', 'Egne'].forEach(k => rows.push(['Kilde', k, '']));
  DBU_TEMAER.forEach(t => rows.push(['Temaer', t, '']));

  // Fokus: the Tema it is used in most (Leg only if never used elsewhere); FCK's own words under their heading
  const groupOf = {};
  Object.keys(fokusTema).forEach(k => {
    const name = fokusName[k];
    if (FCK_FOKUS_GROUPS[name]) { groupOf[k] = FCK_FOKUS_GROUPS[name]; return; }
    const t = dbuTema[k] || fokusTema[k];
    const phases = Object.keys(t).filter(x => x && x !== 'Leg').sort((a, b) => t[b] - t[a]);
    groupOf[k] = phases[0] || (t.Leg ? 'Leg' : 'Andet');
  });
  const groupOrder = DBU_TEMAER.concat(['Teknik', 'Krop og motorik', 'Keeper', 'Andet']);
  const total = k => Object.keys(fokusTema[k]).reduce((n, x) => n + fokusTema[k][x], 0);
  groupOrder.forEach(g => Object.keys(groupOf).filter(k => groupOf[k] === g)
    .sort((a, b) => total(b) - total(a)).forEach(k => rows.push(['Fokus', fokusName[k], g])));

  sortFormats_(Object.keys(formats)).forEach(f =>
    rows.push(['Format', f, isPlayerFormat_(f) ? FORMAT_GROUP_NAMES[0] : FORMAT_GROUP_NAMES[1]]));

  const old = ss.getSheetByName(TAGS_SHEET);
  if (old) {
    const prev = ss.getSheetByName(TAGS_SHEET + ' (gammel)');
    if (prev) ss.deleteSheet(prev);
    old.setName(TAGS_SHEET + ' (gammel)');
  }
  const out = ss.insertSheet(TAGS_SHEET);
  const all = [['Kolonne', 'Tag', 'Gruppe']].concat(rows);
  out.getRange(1, 1, all.length, 3).setNumberFormat('@').setValues(all);
  out.getRange(1, 1, 1, 3).setFontWeight('bold');
  out.setFrozenRows(1);
}

/* The Fokus merges also go into "Omdøb", so drills imported later are merged in the app too */
function addFokusMerges_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let alias = ss.getSheetByName(ALIAS_SHEET);
  if (!alias) {
    alias = ss.insertSheet(ALIAS_SHEET);
    alias.getRange(1, 1, 1, 3).setValues([['Kolonne', 'Fra', 'Til']]).setFontWeight('bold');
  }
  const done = {};
  getAliases().forEach(a => { done[a.col + '|' + tagKey_(a.from)] = true; });
  const add = [];
  Object.keys(FOKUS_MERGE).forEach(to => FOKUS_MERGE[to].forEach(from => {
    if (!done['Fokus|' + tagKey_(from)]) add.push(['Fokus', from, to]);
  }));
  if (add.length) alias.getRange(alias.getLastRow() + 1, 1, add.length, 3).setNumberFormat('@').setValues(add);
}
