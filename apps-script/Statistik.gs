/* ---------- Usage statistics ----------
   Tab "Statistik": one row per day with
     App åbnet          – the app was opened
     Unikke telefoner   – different phones/computers that day (each phone remembers whether it has been
                          counted today, so no device ID is ever sent or stored)
     Login til Øvelser  – correct code typed
     Forkert kode       – wrong code typed
     Øvelser åbnet      – drills opened (from the library or from a training)
   To the right: totals for the last 7 days, the last 30 days and all time.
   Tab "Statistik øvelser": how many times each drill has been opened, most opened first.
   Both tabs are created by themselves the first time something is counted. Counting can never
   break the app: if the sheet is busy, that one count is skipped. */
const STATS_SHEET = 'Statistik';
const STATS_DRILLS_SHEET = 'Statistik øvelser';
const STATS_COLUMNS = ['Dato', 'App åbnet', 'Unikke telefoner', 'Login til Øvelser', 'Forkert kode', 'Øvelser åbnet'];

/* Called by the app: track('open', firstTimeToday) or track('drill', id, name). No login needed. */
function track(event, a, b) {
  if (event === 'open') countToday_({ 'App åbnet': 1, 'Unikke telefoner': a ? 1 : 0 });
  if (event === 'drill') {
    countToday_({ 'Øvelser åbnet': 1 }, function () { countDrill_(String(a || '').slice(0, 100), String(b || '').slice(0, 200)); });
  }
  return true;
}

/* Adds to today's numbers (and runs extra() while the sheet is locked) */
function countToday_(add, extra) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;                 // busy: skip this one count rather than slow the app down
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = statsSheet_(ss);
    const tz = ss.getSpreadsheetTimeZone();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const head = sheet.getRange(1, 1, 1, STATS_COLUMNS.length).getDisplayValues()[0];

    // the last day is found in the date column only (the overview to the right makes the sheet look longer)
    const dates = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 1).getValues();
    let row = dates.length;
    while (row > 1 && dates[row - 1][0] === '') row--;
    const last = row > 1 ? dates[row - 1][0] : '';
    const lastDay = last instanceof Date ? Utilities.formatDate(last, tz, 'yyyy-MM-dd') : String(last);
    if (row < 2 || lastDay !== today) {            // first count today: a new row with zeros
      row = Math.max(row, 1) + 1;
      sheet.getRange(row, 1, 1, STATS_COLUMNS.length)
        .setValues([[Utilities.parseDate(today, tz, 'yyyy-MM-dd')].concat(STATS_COLUMNS.slice(1).map(() => 0))]);
      sheet.getRange(row, 1).setNumberFormat('yyyy-mm-dd');
    }
    const cells = sheet.getRange(row, 1, 1, STATS_COLUMNS.length);
    const v = cells.getValues()[0];
    Object.keys(add).forEach(name => {
      const c = head.indexOf(name);
      if (c > 0) v[c] = (+v[c] || 0) + add[name];
    });
    cells.setValues([v]);
    if (extra) extra();
  } catch (e) {
    /* statistics must never break the app */
  } finally {
    lock.releaseLock();
  }
}

/* The tab "Statistik", made with its headings and the overview the first time */
function statsSheet_(ss) {
  let sheet = ss.getSheetByName(STATS_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(STATS_SHEET);
  sheet.getRange(1, 1, 1, STATS_COLUMNS.length).setValues([STATS_COLUMNS]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Overview to the right (formulas, so it is always up to date)
  const col = i => String.fromCharCode(65 + i);    // 0 -> A
  const rows = [['Oversigt', 'Sidste 7 dage', 'Sidste 30 dage', 'I alt']];
  STATS_COLUMNS.slice(1).forEach((name, i) => {
    const c = col(i + 1);
    rows.push([name,
      `=SUMIFS(${c}2:${c},A2:A,">="&(TODAY()-6))`,
      `=SUMIFS(${c}2:${c},A2:A,">="&(TODAY()-29))`,
      `=SUM(${c}2:${c})`]);
  });
  const box = sheet.getRange(1, STATS_COLUMNS.length + 2, rows.length, 4);
  box.setValues(rows);
  sheet.getRange(1, STATS_COLUMNS.length + 2, 1, 4).setFontWeight('bold');
  sheet.getRange(2, STATS_COLUMNS.length + 2, rows.length - 1, 1).setFontWeight('bold');
  sheet.getRange(rows.length + 1, STATS_COLUMNS.length + 2)
    .setValue('"Unikke telefoner" lægges sammen dag for dag: en telefon, der bruges tre dage, tæller 3.')
    .setFontStyle('italic');
  return sheet;
}

/* Tab "Statistik øvelser": ID | Navn | Åbnet i alt | Sidst åbnet, most opened first */
function countDrill_(id, name) {
  if (!id && !name) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STATS_DRILLS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(STATS_DRILLS_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['ID', 'Navn', 'Åbnet i alt', 'Sidst åbnet']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const key = id || name;
  const n = sheet.getLastRow() - 1;
  const keys = n > 0 ? sheet.getRange(2, 1, n, 2).getDisplayValues().map(r => r[0] || r[1]) : [];
  const i = keys.indexOf(key);
  const now = new Date();
  if (i === -1) {
    sheet.getRange(n + 2, 1, 1, 4).setValues([[id, name, 1, now]]);
    sheet.getRange(n + 2, 1).setNumberFormat('@');
  } else {
    const r = sheet.getRange(i + 2, 2, 1, 3);
    const v = r.getValues()[0];
    r.setValues([[name || v[0], (+v[1] || 0) + 1, now]]);
  }
  sheet.getRange(2, 4, Math.max(1, sheet.getLastRow() - 1), 1).setNumberFormat('yyyy-mm-dd hh:mm');
  if (sheet.getLastRow() > 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).sort({ column: 3, ascending: false });
}
