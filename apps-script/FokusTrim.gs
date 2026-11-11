/* ---------- Shorter Fokus lists for DBU drills with too many tags ----------
   Some DBU drills (mostly games) carry 8-17 Fokus tags, so they show up under almost every Fokus filter.
   The suggestions below keep 1-4 tags per drill, chosen from the drill's own "Fokuspunkter" and description,
   using only Fokus words that already exist (so no new tags).
   1. Run previewFokusTrim. It writes the tab "Fokus-trim": drill, coaching points, current Fokus and the suggestion.
      Change a suggestion there if you like (column "Forslag"). Leave "Forslag" empty to keep a drill as it is.
   2. Run applyFokusTrim. It writes the suggestions into "Øvelser" – but only where Fokus is still exactly
      what the preview saw, so a drill you have edited by hand in the meantime is left alone.
      The old Fokus stays in the "Fokus-trim" tab (column "Nuværende Fokus"), so you can always copy it back. */
const FOKUS_TRIM_SHEET = 'Fokus-trim';

const FOKUS_TRIM = {
  // VI har bolden – Opbygningsspil
  '12931': 'Gøre banen bred; Halvvending; Kommunikation',
  '12933': 'Gøre banen stor; Skabe dybde; Selv eller sammen?; Kommunikation',
  '12937': 'Opsøge eller tiltrække pres; Selv eller sammen?; Aktiv 1. berøring',
  '12938': 'Gøre banen bred; Boldholders orientering; Spil igennem pres',
  '12939': 'Skabe dybde; Gøre banen stor; Boldholders orientering',
  // VI har bolden – Gennembrudsspil
  '12975': 'Opsøge eller tiltrække pres; Spil, og løb!; Dybdeløb',
  '12977': 'Dybdeløb; Selv eller sammen?; Finte + temposkifte',
  '12978': 'Spil, og løb!; Selv eller sammen?; Dybdeløb',
  '12979': 'Dybdeløb; Boldholders orientering; Aktiv 1. berøring',
  '12980': 'Selv eller sammen?; Opsøge eller tiltrække pres; Dybdeløb',
  '12981': 'Selv eller sammen?; Dybdeløb; Boldholders orientering',
  '12982': 'Finte + temposkifte; Selv eller sammen?; Boldholders orientering',
  '12986': 'Dybdeløb ved åben dør; Boldholders orientering; Orientering/timing',
  // VI har bolden – Afslutningsspil
  '13021': 'Afslutte eller tættere på?; Orientering på keeper; Sparketeknik',
  '13027': 'Selv eller sammen?; Orientering på keeper; Sparkefod; Sparketeknik',
  // DE har bolden
  '13053': 'Afstande og vinkler; Fra presspiller til støttespiller; Pres og støtte',
  '13059': 'Presse fremad; Pres og støtte; Fra presspiller til støttespiller',
  '13090': 'Presse fremad; Afstande og vinkler; Erobre eller forsvare?',
  '13096': 'Sprinte i pres; Erobre eller forsvare?; Pres og støtte',
  // Omstillinger DE-VI
  '13142': 'Tempo og fremadrettethed; Medspillernes løb; Boldholderens beslutninger',
  '13145': 'Tempo; Boldholderens beslutninger; Medspillernes løb',
  '13146': 'Tempo; Selv eller sammen?; Boldholderens beslutninger',
  // Leg
  '13201': 'Sparketeknik; Orientering på keeper',
  '13204': 'Orientering; Finte + temposkifte; Retvending',
  '13206': 'Sparketeknik; Orientering på keeper',
  '13207': 'Sparketeknik',
  '13208': 'Koordination; Orientering',
  '13232': 'Orientering; Koordination',
  '13250': 'Sparketeknik; Aktiv 1. berøring; Kommunikation'
};

function previewFokusTrim() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const v = ss.getSheetByName(DRILLS_SHEET).getDataRange().getDisplayValues();
  const h = drillHeaders_(v[0]);
  const at = c => h.indexOf(c);
  const rows = [], seen = {};
  v.slice(1).forEach(r => {
    const id = String(r[at('ID')]).trim();
    if (!FOKUS_TRIM[id] || seen[id]) return;
    seen[id] = true;
    rows.push([id, r[at('Navn')], r[at('Temaer')], r[at('Undertemaer')],
      String(r[at('Fokuspunkter')] || '').split('\n').map(x => x.trim()).filter(Boolean).join(' | '),
      String(r[at('Fokus')] || ''), FOKUS_TRIM[id]]);
  });
  const out = ss.getSheetByName(FOKUS_TRIM_SHEET) || ss.insertSheet(FOKUS_TRIM_SHEET);
  out.clear();
  const all = [['ID', 'Navn', 'Tema', 'Undertema', 'Fokuspunkter', 'Nuværende Fokus', 'Forslag']].concat(rows);
  out.getRange(1, 1, all.length, 7).setNumberFormat('@').setValues(all);
  out.getRange(1, 1, 1, 7).setFontWeight('bold');
  out.getRange(1, 7, all.length, 1).setBackground('#fff8d6');
  out.setFrozenRows(1);
  const msg = rows.length + ' drill(s) got a shorter Fokus suggestion. See the tab "' + FOKUS_TRIM_SHEET + '".';
  Logger.log(msg);
  return msg;
}

function applyFokusTrim() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prev = ss.getSheetByName(FOKUS_TRIM_SHEET);
  if (!prev) throw new Error('Run previewFokusTrim first.');

  // ID -> [Fokus the preview saw, suggestion as it stands in the tab]
  const plan = {};
  prev.getDataRange().getDisplayValues().slice(1).forEach(r => {
    const id = String(r[0]).trim();
    if (id && String(r[6]).trim()) plan[id] = [String(r[5]).trim(), String(r[6]).trim()];
  });

  const sheet = ss.getSheetByName(DRILLS_SHEET);
  const values = sheet.getDataRange().getValues();
  const h = drillHeaders_(values[0].map(String));
  const iId = h.indexOf('ID'), iF = h.indexOf('Fokus');
  if (iF === -1) throw new Error('Column "Fokus" not found in row 1.');
  let n = 0;
  const skipped = [];
  const col = values.slice(1).map(r => {
    const p = plan[String(r[iId]).trim()];
    const now = String(r[iF] || '').trim();
    if (!p || now === p[1]) return [r[iF]];
    if (now !== p[0]) { skipped.push(r[iId]); return [r[iF]]; }   // edited since the preview: leave it
    n++;
    return [p[1]];
  });
  if (col.length) sheet.getRange(2, iF + 1, col.length, 1).setValues(col);
  clearDrillCache();
  const msg = n + ' drill(s) got a shorter Fokus.' +
    (skipped.length ? ' Left alone because Fokus was changed after the preview: ' + skipped.join(', ') + '.' : '');
  Logger.log(msg);
  return msg;
}
