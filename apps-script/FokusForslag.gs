/* ---------- Fokus suggestions for DBU drills that have none ----------
   Chosen from each drill's "Fokuspunkter", using only Fokus words DBU already uses (so no new tags).
   1. Run previewFokusForslag. It writes the tab "Fokus-forslag": drill, its coaching points and the suggestion.
      Change a suggestion there if you like (column "Forslag").
   2. Run applyFokusForslag. It writes the suggestions (as they stand in "Fokus-forslag") into "Øvelser",
      but only where Fokus is still empty. */
const FOKUS_FORSLAG_SHEET = 'Fokus-forslag';

const FOKUS_FORSLAG = {
  // VI har bolden – Opbygningsspil
  '12932': 'Selv eller sammen?; Halvvending; Gøre banen stor',
  '12940': 'Gøre banen stor; Selv eller sammen?; Sparketeknik',
  '12941': 'Gøre banen bred; Orientering',
  '12942': 'Gøre banen bred; Boldholders orientering; Sparketeknik',
  '12943': 'Presresistens; Aktiv 1. berøring; Sparketeknik',
  '12944': 'Opsøge eller tiltrække pres; Spil igennem pres; Skabe dybde',
  '12945': 'Opsøge eller tiltrække pres; Orientering',
  '12946': 'Opsøge eller tiltrække pres; Orientering',
  '12947': 'Opsøge eller tiltrække pres; Orientering',
  '13267': 'Presresistens; Orientering',
  // VI har bolden – Gennembrudsspil
  '12987': 'Opsøge eller tiltrække pres; Spil igennem pres',
  '12988': 'Gøre banen stor; Selv eller sammen?',
  '12989': 'Gøre banen stor; Selv eller sammen?',
  '12990': 'Spil, og løb!; Gøre banen stor; Selv eller sammen?',
  '12991': 'Selv eller sammen?; Gøre banen stor',
  '12992': 'Gøre banen stor; Boldholders orientering',
  '12993': 'Selv eller sammen?; Opsøge eller tiltrække pres',
  '12994': 'Gøre banen stor; Boldholders orientering',
  '12995': 'Selv eller sammen?; Dybdeløb',
  '12996': 'Dybdeløb; Boldholders orientering; Orientering/timing',
  '12997': 'Dybdeløb; Orientering/timing',
  '13243': 'Åben dør; Dybdeløb ved åben dør; Orientering/timing; Boldholders orientering',
  '13247': 'Åben dør; Dybdeløb ved åben dør; Boldholders orientering',
  '13304': 'Skabe dybde; Halvvending; Dybdeløb ved åben dør; Orientering og retvending',
  // VI har bolden – Afslutningsspil
  '13028': 'Afslutte eller tættere på?; Orientering på keeper; Sparketeknik',
  '13029': 'Orientering på keeper; Sparkefod; Sparketeknik',
  '13030': 'Selv eller sammen?; Orientering på keeper; Sparkefod',
  '13031': 'Hvornår afslutte?; Boldholders orientering',
  '13032': 'Selv eller sammen?; Orientering på keeper; Sparkefod',
  '13033': 'Hvornår afslutte?; Boldholders orientering',
  '13297': 'Orientering på keeper; Hvornår afslutte?; Sparkefod',
  '13307': 'Boldholders orientering; Sparketeknik',
  // DE har bolden
  '13064': 'Lukke pasningslinjer; Afstande og vinkler; Kommunikation',
  '13065': 'Pres og støtte; Afstande og vinkler',
  '13066': 'Pres og støtte',
  '13067': 'Afstande og vinkler; Pres og støtte',
  '13068': 'Pres og støtte; Afstande og vinkler; Kommunikation',
  '13069': 'Pres og støtte; Afstande og vinkler; Presløb',
  '13070': 'Afstande og vinkler; Erobre eller forsvare?',
  '13071': 'Pres og støtte; Erobre eller forsvare?; Løb, når bolden går',
  '13072': 'Pres og støtte; Lukke pasningslinjer; Kommunikation',
  '13073': 'Kommunikation; Afstande og vinkler',
  '13089': 'Pres og støtte; Erobre eller forsvare?; Lukke pasningslinjer',
  '13091': 'Afstande og vinkler; Kommunikation',
  '13097': 'Erobre eller forsvare?; Kommunikation',
  '13263': 'Presse fremad; Kommunikation',
  '13264': 'Presse fremad; Kommunikation',
  // Omstillinger VI-DE
  '13112': 'Reaktion; Genpres eller returløb?',
  '13114': 'Reaktion; Pres og støtte; Lukke pasningslinjer',
  '13115': 'Reaktion ved boldtab; Sprinte i pres; Genpres eller returløb?',
  '13116': 'Reaktion; Genpres eller returløb?',
  '13117': 'Reaktion; Pres og støtte; Lukke pasningslinjer',
  '13118': 'Reaktion; Genpres eller returløb?; Kommunikation',
  '13119': 'Reaktion; Lukke pasningslinjer',
  '13121': 'Reaktion; Genpres eller returløb?',
  '13129': 'Forsinke modstanderen; Genpres eller returløb?',
  '13130': 'Reaktion; Genpres eller returløb?; Forsinke eller generobre?',
  '13133': 'Kommunikation; Afstande og vinkler',
  // Omstillinger DE-VI
  '13147': 'Boldholderens beslutninger; Tempo; Medspillernes løb',
  '13148': 'Medspillernes løb; Boldholderens beslutninger',
  '13149': 'Tempo og fremadrettethed; Medspillernes løb',
  '13150': 'Tempo og fremadrettethed; Kommunikation',
  '13151': 'Tempo; Medspillernes løb; Selv eller sammen?',
  '13159': 'Medspilleres reaktion; Spil igennem pres; Kommunikation',
  '13160': 'Medspilleres reaktion; Gøre banen stor; Kommunikation',
  // Leg
  '13194': 'Orientering; Kommunikation',
  '13209': 'Orientering på keeper; Orientering/timing',
  '13210': 'Sparketeknik',
  '13211': 'Orientering; Kommunikation',
  '13213': 'Hvornår afslutte?; Orientering på keeper',
  '13214': 'Sparketeknik',
  '13215': 'Orientering; Halvvending; Kommunikation',
  '13234': 'Orientering; Koordination',
  '13235': 'Orientering; Koordination',
  '13236': 'Kommunikation; Koordination',
  '13237': 'Koordination'
};

function previewFokusForslag() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const v = ss.getSheetByName(DRILLS_SHEET).getDataRange().getDisplayValues();
  const h = drillHeaders_(v[0]);
  const at = c => h.indexOf(c);
  const rows = [];
  v.slice(1).forEach(r => {
    const id = String(r[at('ID')]).trim();
    if (!FOKUS_FORSLAG[id] || String(r[at('Fokus')] || '').trim()) return;
    rows.push([id, r[at('Navn')], r[at('Temaer')], r[at('Undertemaer')],
      String(r[at('Fokuspunkter')] || '').split('\n').map(x => x.trim()).filter(Boolean).join(' | '), FOKUS_FORSLAG[id]]);
  });
  const out = ss.getSheetByName(FOKUS_FORSLAG_SHEET) || ss.insertSheet(FOKUS_FORSLAG_SHEET);
  out.clear();
  const all = [['ID', 'Navn', 'Tema', 'Undertema', 'Fokuspunkter', 'Forslag']].concat(rows);
  out.getRange(1, 1, all.length, 6).setNumberFormat('@').setValues(all);
  out.getRange(1, 1, 1, 6).setFontWeight('bold');
  out.getRange(1, 6, all.length, 1).setBackground('#fff8d6');
  out.setFrozenRows(1);
  const msg = rows.length + ' drill(s) without Fokus got a suggestion. See the tab "' + FOKUS_FORSLAG_SHEET + '".';
  Logger.log(msg);
  return msg;
}

function applyFokusForslag() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DRILLS_SHEET);

  // The suggestions as they stand in the preview tab (your changes there win); otherwise the list above
  const forslag = Object.assign({}, FOKUS_FORSLAG);
  const prev = ss.getSheetByName(FOKUS_FORSLAG_SHEET);
  if (prev) prev.getDataRange().getDisplayValues().slice(1).forEach(r => {
    if (String(r[0]).trim()) forslag[String(r[0]).trim()] = String(r[5]).trim();
  });

  const values = sheet.getDataRange().getValues();
  const h = drillHeaders_(values[0].map(String));
  const iId = h.indexOf('ID'), iF = h.indexOf('Fokus');
  if (iF === -1) throw new Error('Column "Fokus" not found in row 1.');
  let n = 0;
  const col = values.slice(1).map(r => {
    const id = String(r[iId]).trim();
    if (forslag[id] && !String(r[iF] || '').trim()) { n++; return [forslag[id]]; }
    return [r[iF]];
  });
  if (col.length) sheet.getRange(2, iF + 1, col.length, 1).setValues(col);
  clearDrillCache();
  const msg = n + ' drill(s) got Fokus.';
  Logger.log(msg);
  return msg;
}
