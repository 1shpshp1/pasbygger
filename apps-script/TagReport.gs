/* ---------- Tag overview: find messy tags and clean them up ----------
   1. Run tagReport. It writes the tab "Tag-overblik": every tag in Temaer, Undertemaer, Fokus and Kategori,
      how many drills and trainings use it, how it is spelled, and a remark when something looks off
      (e.g. "Ligner: Afslutninger" when two tags are probably the same).
   2. In the column "Omdøb til", write the name a tag should have instead (e.g. merge "Afslutning" into
      "Afslutninger"). Leave it empty for tags that are fine.
   3. Run applyTagRenames. It adds your renames to the "Omdøb" tab (the sheet itself is not changed),
      and makes a fresh overview. The app shows the new names within 5 minutes.
   Optional: a tab "Tags" with the columns Kolonne | Tag holding your fixed list of allowed tags.
   The overview then also marks tags that are not on the list. */
const TAG_REPORT_SHEET = 'Tag-overblik';
const TAG_LIST_SHEET = 'Tags';
const TAG_REPORT_COLS = ['Kilde', 'Temaer', 'Undertemaer', 'Fokus', 'Format'];
const TAG_PLAN_COLS = { Temaer: 'theme', Undertemaer: 'subtheme' };   // the same tags in the training plan
const TAG_REPORT_HEADER = ['Kolonne', 'Tag', 'Øvelser', 'Træningsplan', 'Stavemåder i arket', 'Står under tema', 'Bemærkning', 'Omdøb til'];

/* The same rules as the app: quotes, capitals and ?!.:, are ignored when tags are compared */
const tagKey_ = v => String(v || '').replace(/["“”„‟«»]/g, '').toLowerCase().replace(/['’‘`]/g, '')
  .replace(/[?!.:,]+/g, ' ').replace(/\s+/g, ' ').trim();
const splitTags_ = v => String(v || '').split(/[;\n]+/)
  .map(x => x.replace(/["“”„‟«»]/g, '').replace(/\s+/g, ' ').trim())
  .filter(x => /[\p{L}\p{N}]/u.test(x));

/* Two tags that are probably meant to be the same: one is the other plus an ending (Dribling / Driblinger),
   or they differ by one or two letters (Orientering / Orinetering) */
function similarTags_(a, b) {
  if (a.length < 4 || b.length < 4) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.indexOf(s) === 0 && l.length - s.length <= 3) return true;
  if (l.length - s.length > 2 || s.length < 6) return false;
  let prev = Array.from({ length: l.length + 1 }, (_, j) => j);       // edit distance
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= l.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === l[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[l.length] <= 2;
}

function tagReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aliases = {};
  getAliases().forEach(a => { (aliases[a.col] = aliases[a.col] || {})[tagKey_(a.from)] = a.to; });
  const rename = (col, v) => (aliases[col] && aliases[col][tagKey_(v)]) || v;

  const stats = {};                                  // column -> tag key -> numbers
  const add = (col, v, field, parents) => {
    const name = rename(col, v), k = tagKey_(name);
    if (!k) return;
    const byCol = stats[col] = stats[col] || {};
    const t = byCol[k] = byCol[k] || { names: {}, spellings: {}, drills: 0, plan: 0, parents: {} };
    t.names[name] = (t.names[name] || 0) + 1;
    t.spellings[v] = true;
    t[field]++;
    (parents || []).forEach(p => { t.parents[p] = (t.parents[p] || 0) + 1; });
  };

  // Drills
  const drillSheet = ss.getSheetByName(DRILLS_SHEET);
  if (!drillSheet) throw new Error('Tab "' + DRILLS_SHEET + '" not found.');
  const dv = drillSheet.getDataRange().getDisplayValues();
  const dh = drillHeaders_(dv[0]);
  const iName = dh.indexOf('Navn');
  dv.slice(1).forEach(row => {
    if (iName !== -1 && !String(row[iName]).trim()) return;
    const temaer = dh.indexOf('Temaer') === -1 ? [] : splitTags_(row[dh.indexOf('Temaer')]).map(v => rename('Temaer', v));
    TAG_REPORT_COLS.forEach(col => {
      const c = dh.indexOf(col);
      if (c !== -1) splitTags_(row[c]).forEach(v => add(col, v, 'drills', col === 'Undertemaer' ? temaer : null));
    });
  });

  // Training plan
  const planSheet = ss.getSheetByName(SHEET_NAME);
  if (planSheet) {
    const pv = planSheet.getDataRange().getDisplayValues();
    const ph = pv[0].map(h => String(h).trim().toLowerCase());
    Object.keys(TAG_PLAN_COLS).forEach(col => {
      const c = ph.indexOf(HEADERS[TAG_PLAN_COLS[col]].toLowerCase());
      if (c !== -1) pv.slice(1).forEach(row => splitTags_(row[c]).forEach(v => add(col, v, 'plan')));
    });
  }

  // Optional fixed list of allowed tags
  const listSheet = ss.getSheetByName(TAG_LIST_SHEET);
  const allowed = {};
  if (listSheet) {
    const lv = listSheet.getDataRange().getDisplayValues();
    const lh = lv[0].map(h => String(h).trim().toLowerCase());
    const iCol = lh.indexOf('kolonne'), iTag = lh.indexOf('tag');
    if (iCol !== -1 && iTag !== -1) lv.slice(1).forEach(r => {
      const col = String(r[iCol]).trim(), k = tagKey_(r[iTag]);
      if (!col || !k) return;
      allowed[col + '|' + k] = true;
      const byCol = stats[col] = stats[col] || {};
      if (!byCol[k]) byCol[k] = { names: { [String(r[iTag]).trim()]: 1 }, spellings: {}, drills: 0, plan: 0, parents: {}, unused: true };
    });
  }
  const hasList = Object.keys(allowed).length > 0;

  // One row per tag, most used first
  const rows = [];
  TAG_REPORT_COLS.forEach(col => {
    const keys = Object.keys(stats[col] || {});
    const label = k => Object.keys(stats[col][k].names).sort((a, b) => stats[col][k].names[b] - stats[col][k].names[a])[0];
    keys.forEach(k => {
      const t = stats[col][k];
      const name = label(k);
      const alike = keys.filter(o => o !== k && similarTags_(k, o)).map(label);   // e.g. Afslutning / Afslutninger
      const spellings = Object.keys(t.spellings);
      const parents = Object.keys(t.parents).sort((a, b) => t.parents[b] - t.parents[a])
        .map(p => p + ' (' + t.parents[p] + ')');
      const notes = [];
      if (t.unused) notes.push('På Tags-listen, men ikke brugt');
      else {
        if (alike.length) notes.push('Ligner: ' + alike.join(', '));
        if (t.drills === 0) notes.push('Kun i træningsplanen – ingen øvelser har det');
        else if (t.drills + t.plan === 1) notes.push('Bruges kun én gang');
        if (hasList && !allowed[col + '|' + k]) notes.push('Ikke på Tags-listen');
      }
      rows.push([col, name, t.drills, t.plan, spellings.join(' · '), parents.join(', '), notes.join('; '), '']);
    });
  });
  rows.sort((a, b) => TAG_REPORT_COLS.indexOf(a[0]) - TAG_REPORT_COLS.indexOf(b[0]) ||
    (b[2] + b[3]) - (a[2] + a[3]) || String(a[1]).localeCompare(String(b[1]), 'da'));

  const out = ss.getSheetByName(TAG_REPORT_SHEET) || ss.insertSheet(TAG_REPORT_SHEET);
  out.clear();
  const all = [TAG_REPORT_HEADER].concat(rows);
  out.getRange(1, 1, all.length, TAG_REPORT_HEADER.length).setNumberFormat('@').setValues(all);
  out.getRange(1, 1, 1, TAG_REPORT_HEADER.length).setFontWeight('bold');
  out.getRange(1, TAG_REPORT_HEADER.length, all.length, 1).setBackground('#fff8d6');   // the column to fill in
  out.setFrozenRows(1);
  out.autoResizeColumns(1, TAG_REPORT_HEADER.length - 1);

  const msg = rows.length + ' tags listed in "' + TAG_REPORT_SHEET + '", ' +
    rows.filter(r => r[6]).length + ' with a remark.';
  Logger.log(msg);
  return msg;
}

/* Adds the names written in "Omdøb til" to the "Omdøb" tab, then makes a fresh overview */
function applyTagRenames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rep = ss.getSheetByName(TAG_REPORT_SHEET);
  if (!rep) throw new Error('Run tagReport first.');
  const rv = rep.getDataRange().getDisplayValues();
  const h = rv[0];
  const iCol = h.indexOf('Kolonne'), iTag = h.indexOf('Tag'), iSp = h.indexOf('Stavemåder i arket'), iTo = h.indexOf('Omdøb til');

  let alias = ss.getSheetByName(ALIAS_SHEET);
  if (!alias) {
    alias = ss.insertSheet(ALIAS_SHEET);
    alias.getRange(1, 1, 1, 3).setValues([['Kolonne', 'Fra', 'Til']]).setFontWeight('bold');
  }
  const done = {};
  getAliases().forEach(a => { done[a.col + '|' + tagKey_(a.from)] = true; });

  const add = [];
  rv.slice(1).forEach(r => {
    const col = String(r[iCol]).trim(), to = String(r[iTo]).trim();
    if (!col || !to) return;
    [String(r[iTag])].concat(String(r[iSp]).split(' · ')).forEach(from => {
      from = from.trim();
      const key = col + '|' + tagKey_(from);
      if (!from || tagKey_(from) === tagKey_(to) || done[key]) return;
      done[key] = true;
      add.push([col, from, to]);
    });
  });
  if (add.length) alias.getRange(alias.getLastRow() + 1, 1, add.length, 3).setNumberFormat('@').setValues(add);
  try { CacheService.getScriptCache().remove('aliasesJson'); } catch (e) { /* only a speed-up */ }

  tagReport();
  const msg = add.length + ' rename(s) added to "' + ALIAS_SHEET + '". The overview is updated.';
  Logger.log(msg);
  return msg;
}
