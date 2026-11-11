/* ---------- Import drills from FCK's drill bank (Better Coaching) into the "Øvelser" tab ----------
   How to use:
   1. Paste the drill bank's response into the file FckData (see the instructions there).
   2. Open this file, choose importFckDrills in the toolbar above and click Run.
   Drills that are already in the tab (same ID) are not added again. Only their EMPTY cells are filled in
   (e.g. tags), so your own changes are never overwritten. It is safe to run again with more drills.
   New drills get Publiceret = nej: look them over and change it to ja for the ones you want in the app.
   Columns the tab doesn't have yet (e.g. Materialer, Kilde) are added at the end of row 1.
   The categories (FCK_CATEGORIES at the bottom) become tags: main categories -> Temaer,
   sub-categories -> Undertemaer, and the ones in FCK_KATEGORI_IDS -> Kategori. */
const FCK_SOURCE = 'FC København / Better Coaching';
const FCK_LINK = 'https://fck.better-coaching.dk/drills/drill-bank';
const FCK_LINK_TEXT = "FCK's drill bank";
const FCK_LINK_COLUMNS = ['Diagram', 'Video', 'Link'];   // these cells become clickable links
/* Categories that describe the kind of drill rather than a theme: Børne-koncept, Fungames, Træningspas */
const FCK_KATEGORI_IDS = ['650c6aae8ab0d', '667145dc98098', '1512'];
/* Category names that need more than "first letter capital, rest small" */
const FCK_NAMES = { 'HORST WEIN SPIL': 'Horst Wein spil', 'FUNGAMES': 'Fun games' };

function importFckDrills() {
  // FCK_DATA (file FckData) holds one response, or several separated by commas
  const pages = typeof FCK_DATA === 'undefined' ? [] : (Array.isArray(FCK_DATA) ? FCK_DATA : [FCK_DATA]);
  const seen = {};
  const list = [].concat.apply([], pages.map(p => (p && p.data) || []))
    .filter(x => x && x.drill_id && !seen[x.drill_id] && (seen[x.drill_id] = true));   // each drill once
  if (!list.length) throw new Error('No drills found in FCK_DATA (file FckData).');
  const cats = fckCategoryIndex_();
  return writeDrillRows_(list.map(x => fckToRow_(x, cats)), fckCell_);
}

/* Writes drills (column name -> text) into the "Øvelser" tab. Shared by the FCK and Tiim imports.
   New drills go at the bottom; drills already there (same ID) only get their EMPTY cells filled in.
   cellFn(column, text) makes the rich text value for one cell. */
function writeDrillRows_(rows, cellFn) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  if (!sheet) throw new Error('Tab "' + DRILLS_SHEET + '" not found.');

  // Columns by name; missing ones are added at the end of row 1
  const lastCol = Math.max(1, sheet.getLastColumn());
  let headers = drillHeaders_(sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]);
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const missing = Object.keys(rows[0]).filter(h => headers.indexOf(h) === -1);
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }

  // Drills already in the tab: row number by ID, and what their cells hold now
  const iId = headers.indexOf('ID');
  const nOld = sheet.getLastRow() - 1;
  const current = nOld > 0 ? sheet.getRange(2, 1, nOld, headers.length).getDisplayValues() : [];
  const rowOf = {};
  current.forEach((r, i) => { rowOf[String(r[iId]).trim()] = i; });

  // Existing drills: fill in only the cells that are empty
  let filled = 0;
  rows.filter(r => rowOf[r.ID] != null).forEach(r => {
    const i = rowOf[r.ID];
    headers.forEach((h, c) => {
      const text = r[h] == null ? '' : String(r[h]);
      if (!text || String(current[i][c]).trim()) return;
      sheet.getRange(i + 2, c + 1).setRichTextValue(cellFn(h, text));
      filled++;
    });
  });

  // New drills: added at the bottom
  const fresh = rows.filter(r => rowOf[r.ID] == null);
  const cells = fresh.map(r => headers.map(h => cellFn(h, r[h] == null ? '' : String(r[h]))));
  if (cells.length) sheet.getRange(sheet.getLastRow() + 1, 1, cells.length, headers.length).setRichTextValues(cells);

  clearDrillCache();                                 // the app gets the new drills at once
  const msg = cells.length + ' drill(s) added. ' + (rows.length - cells.length) + ' already in the tab, ' +
    filled + ' empty cell(s) filled in.';
  Logger.log(msg);
  return msg;
}

/* A cell written as rich text: the text is stored exactly as it is (a line starting with + or - is not
   read as a formula), and Diagram, Video and Link become real links that the app picks up */
function fckCell_(h, text) {
  const b = SpreadsheetApp.newRichTextValue().setText(text);
  if (text && FCK_LINK_COLUMNS.indexOf(h) !== -1) b.setLinkUrl(h === 'Link' ? FCK_LINK : text);
  return b.build();
}

/* Category id -> { name, parent id } from FCK_CATEGORIES */
function fckCategoryIndex_() {
  const idx = {};
  const walk = (list, parent) => (list || []).forEach(c => {
    idx[String(c.category_id)] = { name: fckTagName_(c.name), parent: parent };
    walk(c.children, String(c.category_id));
  });
  walk(typeof FCK_CATEGORIES !== 'undefined' && FCK_CATEGORIES ? FCK_CATEGORIES.data : [], '');
  return idx;
}

/* "SPILFORSTÅELSE" -> "Spilforståelse", "2V1" -> "2v1" */
function fckTagName_(n) {
  n = String(n || '').trim();
  if (FCK_NAMES[n]) return FCK_NAMES[n];
  const low = n.toLocaleLowerCase('da');
  return low.charAt(0).toLocaleUpperCase('da') + low.slice(1);
}

/* A drill's category ids -> Temaer, Undertemaer and Kategori (several values separated by ;) */
function fckTags_(ids, cats) {
  const t = { Temaer: [], Undertemaer: [], Kategori: [] };
  const add = (col, v) => { if (v && t[col].indexOf(v) === -1) t[col].push(v); };
  (ids || []).forEach(id => {
    const c = cats[String(id)];
    if (!c) return;
    if (FCK_KATEGORI_IDS.indexOf(String(id)) !== -1) add('Kategori', c.name);
    else if (c.parent) { add('Undertemaer', c.name); add('Temaer', cats[c.parent] && cats[c.parent].name); }
    else add('Temaer', c.name);
  });
  return { Temaer: t.Temaer.join('; '), Undertemaer: t.Undertemaer.join('; '), Kategori: t.Kategori.join('; ') };
}

/* One drill from the drill bank -> one row for the "Øvelser" tab (column name -> text) */
function fckToRow_(x, cats) {
  const name = String(x.drill_name || '').trim();
  const from = String(x.age_from || '').trim(), to = String(x.age_to || '').trim();
  const tags = fckTags_(x.categories, cats);
  return {
    'ID':                 'FCK-' + x.drill_id,      // not only digits, so the app doesn't make a DBU link of it
    'Navn':               name.charAt(0).toUpperCase() + name.slice(1),
    'Publiceret':         'nej',
    'Aldersgruppe':       from && to && from !== to ? 'U' + from + '-U' + to : (from || to ? 'U' + (from || to) : ''),
    'Temaer':             tags.Temaer,
    'Undertemaer':        tags.Undertemaer,
    'Kategori':           tags.Kategori,
    'Antal spillere min': x.players_from || '',
    'Antal spillere max': x.players_to || '',
    'Varighed min':       x.duration_from || '',
    'Varighed max':       x.duration_to || '',
    'Beskrivelse':        fckLines_(x.description).join('\n'),
    'Fokuspunkter':       fckLines_(x.instructions).filter(l => !/^fokuspunkter\s*:?$/i.test(l)).join('\n'),
    'Variationer':        fckVariations_(x.progression_regression),
    'Materialer':         fckLines_(x.materials).join('\n'),
    'Diagram':            fckUrl_(x.image),
    'Video':              fckUrl_(x.video),
    'Link':               x.drill_id ? FCK_LINK_TEXT : '',
    'Kilde':              FCK_SOURCE
  };
}

/* HTML from the drill bank -> lines of plain text */
function fckLines_(html) {
  const text = String(html || '')
    .replace(/<br\s*\/?>|<\/(p|div|li|ul|ol|h\d)>|<li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return fckDecode_(text).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/* Progression lines get "+ ", regression lines "- ", so the app shows them with a plus/minus badge */
function fckVariations_(html) {
  let sign = '';
  const out = [];
  fckLines_(html).forEach(line => {
    if (/^pro\w*ion\w*\s*:?$/i.test(line)) { sign = '+ '; return; }   // Progression (also with typos)
    if (/^regre\w*\s*:?$/i.test(line)) { sign = '- '; return; }        // Regression (also with typos)
    out.push(sign + line);
  });
  return out.join('\n');
}

/* &aelig; &oslash; &#39; … -> æ ø ' … */
function fckDecode_(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aelig: 'æ', oslash: 'ø', aring: 'å',
    AElig: 'Æ', Oslash: 'Ø', Aring: 'Å', eacute: 'é', Eacute: 'É', aacute: 'á', oacute: 'ó', frac12: '½', frac14: '¼', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', auml: 'ä', ouml: 'ö', uuml: 'ü',
    ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return named[e] != null ? named[e] : m;
  });
}

/* Spaces and special letters in a file address are encoded, so the link works everywhere */
function fckUrl_(u) {
  u = String(u || '').trim();
  return u && u.indexOf('%') === -1 ? encodeURI(u) : u;
}


/* ---------- Paste the drill bank's category list here ---------- */
const FCK_CATEGORIES = {
    "success": true,
    "message": "Kategorier hentet",
    "data": [
        {
            "category_id": "1494", "name": "BASISTEKNIK", "platform": "fck", "parent": "",
            "children": [
                { "category_id": "1495", "name": "AFLEVERINGER", "platform": "fck", "parent": "1494", "children": [] },
                { "category_id": "1496", "name": "AFSLUTNINGER", "platform": "fck", "parent": "1494", "children": [] },
                { "category_id": "1497", "name": "CUTS", "platform": "fck", "parent": "1494", "children": [] },
                { "category_id": "1498", "name": "DRIBLINGER", "platform": "fck", "parent": "1494", "children": [] },
                { "category_id": "1499", "name": "FINTER", "platform": "fck", "parent": "1494", "children": [] },
                { "category_id": "1500", "name": "FØRSTEBERØRINGER", "platform": "fck", "parent": "1494", "children": [] },
                { "category_id": "1501", "name": "VENDINGER", "platform": "fck", "parent": "1494", "children": [] }
            ]
        },
        { "category_id": "1502", "name": "KOORDINATION", "platform": "fck", "children": [], "parent": "" },
        { "category_id": "1505", "name": "SPIL", "platform": "fck", "children": [], "parent": "" },
        {
            "category_id": "1506", "name": "SPILFORSTÅELSE", "platform": "fck", "parent": "",
            "children": [
                { "category_id": "1507", "name": "2V1", "platform": "fck", "parent": "1506", "children": [] },
                { "category_id": "1508", "name": "2V2", "platform": "fck", "parent": "1506", "children": [] },
                { "category_id": "1509", "name": "3V2", "platform": "fck", "parent": "1506", "children": [] },
                { "category_id": "1510", "name": "HORST WEIN SPIL", "platform": "fck", "parent": "1506", "children": [] },
                { "category_id": "1511", "name": "POSSESSION SPIL", "platform": "fck", "parent": "1506", "children": [] }
            ]
        },
        { "category_id": "1504", "name": "KEEPER", "platform": "fck", "children": [], "parent": "" },
        { "category_id": "1512", "name": "TRÆNINGSPAS", "platform": "fck", "children": [], "parent": "" },
        { "category_id": "650c6aae8ab0d", "name": "BØRNE-KONCEPT", "platform": "fck", "children": [], "parent": "" },
        { "category_id": "667145dc98098", "name": "FUNGAMES", "platform": "fck", "children": [], "parent": "" }
    ]
};
