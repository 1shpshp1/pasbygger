/* ---------- Danish translation of the tiim.no exercises (NFF) ----------
   How to use:
   1. Add the files TiimDA1, TiimDA2 and TiimDA3 (the Danish texts, by exercise ID).
      Each file must end with }; on its last line – if not, the copy was cut off.
   2. Open this file, choose addTiimDanish in the toolbar above and click Run.
   The Norwegian original stays where it is. The translation goes in the columns ending in " (DA)"
   (added at the end of row 1 if missing). The app shows the Norwegian original, with a flag switch to show
   the Danish translation. Only EMPTY " (DA)" cells of NFF exercises already in the tab are filled in, so no
   exercise is added and no text of yours is overwritten. It is safe to run again. */
const TIIM_DA_COLUMNS = ['Navn', 'Beskrivelse', 'Læringsmål', 'Fokuspunkter', 'Variationer', 'Noter'];

/* All translations from TiimDA1-3 (a missing file is reported, so nothing is skipped by accident) */
function tiimDanish_() {
  const parts = [
    typeof TIIM_DA_1 === 'undefined' ? null : TIIM_DA_1,
    typeof TIIM_DA_2 === 'undefined' ? null : TIIM_DA_2,
    typeof TIIM_DA_3 === 'undefined' ? null : TIIM_DA_3
  ];
  const missing = parts.map((p, i) => p ? '' : 'TiimDA' + (i + 1)).filter(String);
  if (missing.length) throw new Error('Missing file(s): ' + missing.join(', ') + '. Add them and run again.');
  return Object.assign.apply(null, [{}].concat(parts));
}

function addTiimDanish() {
  const da = tiimDanish_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  if (!sheet) throw new Error('Tab "' + DRILLS_SHEET + '" not found.');

  // The " (DA)" columns; missing ones are added at the end of row 1
  let headers = drillHeaders_(sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0]);
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const cols = TIIM_DA_COLUMNS.map(c => c + ' (DA)');
  const missing = cols.filter(c => headers.indexOf(c) === -1);
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }

  const n = sheet.getLastRow() - 1;
  if (n < 1) return 'No exercises in the tab.';
  const ids = sheet.getRange(2, headers.indexOf('ID') + 1, n, 1).getDisplayValues().map(r => String(r[0]).trim());
  let filled = 0, found = 0;
  ids.forEach(id => { if (da[id]) found++; });

  // One column at a time: the cells already filled keep their text, the empty ones get the translation.
  // Written as rich text, so a line starting with + or - stays text (not a formula).
  cols.forEach((col, k) => {
    const c = headers.indexOf(col) + 1;
    const now = sheet.getRange(2, c, n, 1).getDisplayValues();
    let changed = false;
    const out = now.map((r, i) => {
      const text = String(r[0]);
      const add = !text.trim() && da[ids[i]] ? (da[ids[i]][TIIM_DA_COLUMNS[k]] || '') : '';
      if (add) { filled++; changed = true; }
      return [SpreadsheetApp.newRichTextValue().setText(add || text).build()];
    });
    if (changed) sheet.getRange(2, c, n, 1).setRichTextValues(out);
  });

  clearDrillCache();                                 // the app gets the translations at once
  const msg = found + ' NFF exercise(s) found, ' + filled + ' Danish cell(s) filled in.';
  Logger.log(msg);
  return msg;
}
