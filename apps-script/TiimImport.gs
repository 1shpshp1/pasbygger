/* ---------- Import exercises from tiim.no (Norges Fotballforbund) into the "Øvelser" tab ----------
   How to use:
   1. Add the file TiimData, or the four smaller files TiimData1-4 (not both). They hold the exercises,
      already converted to this sheet's columns.
   2. Open this file, choose importTiimDrills in the toolbar above and click Run.
   Exercises that are already in the tab (same ID) are not added again. Only their EMPTY cells are filled in,
   so your own changes are never overwritten. It is safe to run again.
   New exercises get Publiceret = TIIM_PUBLISHED below: 'nej' lets you look them over first.
   The texts are in Norwegian. Tags (Tema, Undertema, Format, Fokus, Kategori) are in the DBU structure. */
const TIIM_SOURCE = 'NFF';                      // Kilde, and the text in the corner of the card
const TIIM_PUBLISHED = 'nej';                   // 'ja' to show all imported exercises in the app at once
const TIIM_LINK_TEXT = 'Øvelsen på tiim.no';
const TIIM_LINK_COLUMNS = ['Diagram', 'Video', 'Link'];   // these cells become clickable links

/* All exercises: from the single file TiimData, or from the files TiimData1-4
   (a missing part is reported, so nothing is skipped by accident) */
function tiimDrills_() {
  if (typeof TIIM_DRILLS !== 'undefined') return TIIM_DRILLS;
  const parts = [typeof TIIM_DRILLS_1 === 'undefined' ? null : TIIM_DRILLS_1,
                 typeof TIIM_DRILLS_2 === 'undefined' ? null : TIIM_DRILLS_2,
                 typeof TIIM_DRILLS_3 === 'undefined' ? null : TIIM_DRILLS_3,
                 typeof TIIM_DRILLS_4 === 'undefined' ? null : TIIM_DRILLS_4];
  const missing = parts.map((p, i) => p ? '' : 'TiimData' + (i + 1)).filter(Boolean);
  if (missing.length) throw new Error('Missing file(s): ' + missing.join(', ') + '. Add them and run again.');
  return [].concat.apply([], parts);
}

function importTiimDrills() {
  const list = tiimDrills_();
  const rows = list.map(x => Object.assign({ 'Publiceret': TIIM_PUBLISHED, 'Kilde': TIIM_SOURCE }, x));
  return writeDrillRows_(rows, tiimCell_);
}

/* Like fckCell_: the text is stored exactly as it is; Link shows a short text that links to the exercise */
function tiimCell_(h, text) {
  if (h === 'Link' && text) return SpreadsheetApp.newRichTextValue().setText(TIIM_LINK_TEXT).setLinkUrl(text).build();
  const b = SpreadsheetApp.newRichTextValue().setText(text);
  if (text && TIIM_LINK_COLUMNS.indexOf(h) !== -1) b.setLinkUrl(text);
  return b.build();
}

/* For exercises imported before they had Fokus: writes the Fokus from TiimData into "Øvelser",
   but only where Fokus is still empty or still the automatic "Sparketeknik", so your own edits stay */
function refreshTiimFokus() {
  const fokus = {};
  tiimDrills_().forEach(x => { if (x.Fokus) fokus[x.ID] = x.Fokus; });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  const values = sheet.getDataRange().getValues();
  const h = drillHeaders_(values[0].map(String));
  const iId = h.indexOf('ID'), iF = h.indexOf('Fokus');
  if (iId === -1 || iF === -1) throw new Error('Columns "ID" and "Fokus" must be in row 1.');
  let n = 0;
  const col = values.slice(1).map(r => {
    const want = fokus[String(r[iId]).trim()], now = String(r[iF] || '').trim();
    if (!want || now === want || (now && now !== 'Sparketeknik')) return [r[iF]];
    n++;
    return [want];
  });
  if (col.length) sheet.getRange(2, iF + 1, col.length, 1).setValues(col);
  clearDrillCache();
  const msg = n + ' exercise(s) from ' + TIIM_SOURCE + ' got Fokus.';
  Logger.log(msg);
  return msg;
}

/* Shows every imported exercise in the app (sets Publiceret = ja for all rows with Kilde = NFF) */
function publishTiimDrills() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  const values = sheet.getDataRange().getValues();
  const h = drillHeaders_(values[0].map(String));
  const iK = h.indexOf('Kilde'), iP = h.indexOf('Publiceret');
  if (iK === -1 || iP === -1) throw new Error('Columns "Kilde" and "Publiceret" must be in row 1.');
  let n = 0;
  const col = values.slice(1).map(r => {
    if (String(r[iK]).trim() !== TIIM_SOURCE || !isUnpublished_(String(r[iP]))) return [r[iP]];
    n++;
    return [typeof r[iP] === 'boolean' ? true : 'ja'];
  });
  if (col.length) sheet.getRange(2, iP + 1, col.length, 1).setValues(col);
  clearDrillCache();
  const msg = n + ' exercise(s) from ' + TIIM_SOURCE + ' published.';
  Logger.log(msg);
  return msg;
}
