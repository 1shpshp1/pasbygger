/* ---------- Import sessions from England Football Learning (The FA) into the "Øvelser" tab ----------
   How to use:
   1. Add the files FaData1 ... FaData11 (they hold the sessions, already converted to this sheet's columns).
      Each file must end with ]; on its last line – if not, the copy was cut off.
   2. Open this file, choose importFaDrills in the toolbar above and click Run.
   The original English text goes in the usual columns (Navn, Beskrivelse, ...), the Danish translation in the
   columns ending in " (DA)" (they are added at the end of row 1 if missing). The app shows the English original,
   with a flag switch to show the Danish translation.
   Diagram holds every picture of the session, one link per line; Billedtekster holds the text for each picture.
   Video likewise: one link per line when the session is in several parts (YouTube; the FA's Vimeo videos only
   play on their own site, so the same videos from the FA's YouTube channel are used where they exist).
   Sessions that are already in the tab (same ID) are not added again; only their EMPTY cells are filled in,
   so your own changes are never overwritten. The exceptions are the media columns (FA_MEDIA_COLUMNS) and the
   corrections in FA_TEXT_FIXES: they are brought up to date. It is safe to run again.
   New sessions get Publiceret = FA_PUBLISHED below: 'nej' lets you look them over first. */
const FA_SOURCE = 'FA';                        // Kilde, and the text in the corner of the card
const FA_PUBLISHED = 'nej';                    // 'ja' to show all imported sessions in the app at once
const FA_LINK_TEXT = 'Sessionen hos England Football';
const FA_LINK_COLUMNS = ['Link'];
/* Updated on sessions already in the tab too: the pictures, video and PDF link (Noter only while it holds
   the note made by this import, so a note of your own is kept) */
const FA_MEDIA_COLUMNS = ['Video', 'Diagram', 'Noter', 'Billedtekster', 'Billedtekster (DA)'];
const FA_NOTE = /^(Sessionen som PDF|Videoen kan kun)|the-fa-slavery/;
/* Text from an earlier import that is out of date once the video plays in the app: such a cell gets the new text */
const FA_STALE = ["The session is shown in the video on England Football's website", 'Øvelsen vises i videoen på England Footballs hjemmeside'];
/* Wrong week number in the FA text, corrected in the tab: [ID, column, wrong text, right text] */
const FA_TEXT_FIXES = [
  ['FA-Pressing-session-hunt-the-ball', 'Beskrivelse', 'This is week one of', 'This is week five of'],
  ['FA-Pressing-session-hunt-the-ball', 'Beskrivelse (DA)', 'Uge 1 i FA', 'Uge 5 i FA'],
  ['FA-Pressing-session-pressing-as-a-team', 'Beskrivelse', 'This is week three of', 'This is week four of']
];

/* All sessions from the files FaData1-11 (a missing file is reported, so nothing is skipped by accident) */
function faDrills_() {
  const parts = [
    typeof FA_DRILLS_1 === 'undefined' ? null : FA_DRILLS_1,
    typeof FA_DRILLS_2 === 'undefined' ? null : FA_DRILLS_2,
    typeof FA_DRILLS_3 === 'undefined' ? null : FA_DRILLS_3,
    typeof FA_DRILLS_4 === 'undefined' ? null : FA_DRILLS_4,
    typeof FA_DRILLS_5 === 'undefined' ? null : FA_DRILLS_5,
    typeof FA_DRILLS_6 === 'undefined' ? null : FA_DRILLS_6,
    typeof FA_DRILLS_7 === 'undefined' ? null : FA_DRILLS_7,
    typeof FA_DRILLS_8 === 'undefined' ? null : FA_DRILLS_8,
    typeof FA_DRILLS_9 === 'undefined' ? null : FA_DRILLS_9,
    typeof FA_DRILLS_10 === 'undefined' ? null : FA_DRILLS_10,
    typeof FA_DRILLS_11 === 'undefined' ? null : FA_DRILLS_11
  ];
  const missing = parts.map((p, i) => p ? '' : 'FaData' + (i + 1)).filter(String);
  if (missing.length) throw new Error('Missing file(s): ' + missing.join(', ') + '. Add them and run again.');
  return [].concat.apply([], parts);
}

function importFaDrills() {
  const rows = faDrills_().map(x => Object.assign({ 'Publiceret': FA_PUBLISHED, 'Kilde': FA_SOURCE }, x));
  const msg = writeDrillRows_(rows, faCell_) + ' ' + refreshFaDrills_(rows);
  Logger.log(msg);
  return msg;
}

/* Brings the media columns and the text corrections of sessions already in the tab up to date */
function refreshFaDrills_(rows) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  const display = sheet.getDataRange().getDisplayValues();
  const h = drillHeaders_(display[0]);
  const rowOf = {};
  display.forEach((r, i) => { if (i) rowOf[String(r[h.indexOf('ID')]).trim()] = i; });
  let n = 0;
  const put = (i, col, text) => { sheet.getRange(i + 1, h.indexOf(col) + 1).setRichTextValue(faCell_(col, text)); n++; };
  rows.forEach(r => {
    const i = rowOf[r.ID];
    if (i == null) return;
    FA_MEDIA_COLUMNS.forEach(col => {
      if (h.indexOf(col) === -1) return;
      const now = String(display[i][h.indexOf(col)]), text = String(r[col] || '');
      if (now === text) return;
      if (col === 'Noter' && now.trim() && !FA_NOTE.test(now.trim())) return;
      put(i, col, text);
    });
  });
  rows.forEach(r => {
    const i = rowOf[r.ID];
    if (i == null) return;
    ['Beskrivelse', 'Beskrivelse (DA)'].forEach(col => {
      const c = h.indexOf(col), now = c === -1 ? '' : String(display[i][c]), text = String(r[col] || '');
      if (FA_STALE.some(x => now.indexOf(x) !== -1) && !FA_STALE.some(x => text.indexOf(x) !== -1)) put(i, col, text);
    });
  });
  FA_TEXT_FIXES.forEach(f => {
    const i = rowOf[f[0]], c = h.indexOf(f[1]);
    if (i == null || c === -1 || String(display[i][c]).indexOf(f[2]) === -1) return;
    put(i, f[1], String(display[i][c]).replace(f[2], f[3]));
  });
  if (n) clearDrillCache();
  return n + ' cell(s) brought up to date (pictures, videos, PDF links, corrections).';
}

/* Like tiimCell_: text stored exactly as it is; Link shows a short text that links to the session.
   Diagram and Video: every line (one picture or video) is its own link. */
function faCell_(h, text) {
  if (h === 'Link' && text) return SpreadsheetApp.newRichTextValue().setText(FA_LINK_TEXT).setLinkUrl(text).build();
  const b = SpreadsheetApp.newRichTextValue().setText(text);
  if (h === 'Diagram' || h === 'Video') {
    let at = 0;
    text.split('\n').forEach(line => {
      if (/^https?:\/\//.test(line)) b.setLinkUrl(at, at + line.length, line);
      at += line.length + 1;
    });
    return b.build();
  }
  if (text && FA_LINK_COLUMNS.indexOf(h) !== -1) b.setLinkUrl(text);
  const url = h === 'Noter' && text.match(/https?:\/\/\S+/);  // the PDF link in Noter can be clicked
  if (url) b.setLinkUrl(url.index, url.index + url[0].length, url[0]);
  return b.build();
}

/* Shows every imported FA session in the app (sets Publiceret = ja for all rows with Kilde = FA) */
function publishFaDrills() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DRILLS_SHEET);
  const values = sheet.getDataRange().getValues();
  const h = drillHeaders_(values[0].map(String));
  const iK = h.indexOf('Kilde'), iP = h.indexOf('Publiceret');
  if (iK === -1 || iP === -1) throw new Error('Columns "Kilde" and "Publiceret" must be in row 1.');
  let n = 0;
  const col = values.slice(1).map(r => {
    if (String(r[iK]).trim() !== FA_SOURCE || !isUnpublished_(String(r[iP]))) return [r[iP]];
    n++;
    return [typeof r[iP] === 'boolean' ? true : 'ja'];
  });
  if (col.length) sheet.getRange(2, iP + 1, col.length, 1).setValues(col);
  clearDrillCache();
  const msg = n + ' session(s) from ' + FA_SOURCE + ' published.';
  Logger.log(msg);
  return msg;
}
