/* A small in-memory stand-in for Google Sheets and Apps Script (SpreadsheetApp, CacheService, …), enough to
   run the real server files in apps-script/ in Node. Used by the tests; it is not part of the app. */
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');

function rt(text, url, links) {
  text = String(text ?? ''); url = url || null; links = links || null;
  const runs = () => {
    if (!links) return [{ getText: () => text, getLinkUrl: () => url }];
    const out = []; let at = 0;
    links.slice().sort((a, b) => a.s - b.s).forEach(l => {
      if (l.s > at) out.push({ getText: () => text.slice(at, l.s), getLinkUrl: () => null });
      out.push({ getText: () => text.slice(l.s, l.e), getLinkUrl: () => l.u }); at = l.e;
    });
    if (at < text.length) out.push({ getText: () => text.slice(at), getLinkUrl: () => null });
    return out;
  };
  return { getText: () => text, getLinkUrl: () => url, getRuns: runs, _t: text, _u: url, _l: links };
}
const iso = d => d.toISOString().slice(0, 10);
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
const disp = c => c == null ? '' : isDate(c.v) ? iso(c.v) : c.v === true ? 'TRUE' : c.v === false ? 'FALSE' : String(c.v ?? '');

function makeSheet(name, rows) {
  const g = rows.map(r => r.map(v => (v && typeof v === 'object' && !isDate(v)) ? v : { v }));
  const sh = {
    name, g,
    getName: () => name,
    getLastRow: () => { let n = g.length; while (n && !g[n - 1].some(c => c && (disp(c) !== '' || c.f))) n--; return n; },
    getLastColumn: () => Math.max(0, ...g.map(r => r.length)),
    cell: (r, c) => { while (g.length < r) g.push([]); const row = g[r - 1]; while (row.length < c) row.push({ v: '' }); return row[c - 1]; },
    getDataRange: () => sh.getRange(1, 1, Math.max(1, sh.getLastRow()), Math.max(1, sh.getLastColumn())),
    getRange: (r, c, nr = 1, nc = 1) => range(sh, r, c, nr, nc),
    deleteRow: r => { g.splice(r - 1, 1); },
    clear: () => { g.length = 0; },
    setFrozenRows() {}
  };
  return sh;
}
function range(sh, r, c, nr, nc) {
  const each = f => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => f(sh.cell(r + i, c + j), i, j)));
  const R = {
    getValues: () => each(x => x.v ?? ''), getDisplayValues: () => each(disp), getFormulas: () => each(x => x.f || ''),
    getRichTextValues: () => each(x => rt(disp(x), x.link, x.links)),
    getDisplayValue: () => disp(sh.cell(r, c)), getFormula: () => sh.cell(r, c).f || '', getValue: () => sh.cell(r, c).v ?? '',
    setFontStyle: () => R,
    sort: o => { const rows = Array.from({ length: nr }, (_, i) => sh.g[r - 1 + i]);
      rows.sort((a, b) => { const x = +(a[o.column - 1] || {}).v || 0, y = +(b[o.column - 1] || {}).v || 0; return o.ascending ? x - y : y - x; });
      rows.forEach((row, i) => { sh.g[r - 1 + i] = row; }); return R; },
    setValues: v => { v.forEach((row, i) => row.forEach((x, j) => Object.assign(sh.cell(r + i, c + j), { v: x, link: null, links: null, f: null }))); return R; },
    setValue: x => { Object.assign(sh.cell(r, c), { v: x, link: null, f: null }); return R; },
    setRichTextValue: x => { Object.assign(sh.cell(r, c), { v: x._t, link: x._u, links: x._l, f: null }); return R; },
    setRichTextValues: v => { v.forEach((row, i) => row.forEach((x, j) => Object.assign(sh.cell(r + i, c + j), { v: x._t, link: x._u, links: x._l, f: null }))); return R; },
    clearContent: () => { each(x => { x.v = ''; x.f = null; }); return R; }, setFontWeight: () => R, setNumberFormat: () => R, setBackground: () => R,
    getCell: (i, j) => range(sh, r + i - 1, c + j - 1, 1, 1),
    copyTo: (dest, type) => {
      if (type) return;                       // formats: nothing to copy in the mock
      const src = sh.cell(r, c), to = dest._sh.cell(dest._r, dest._c);
      to.f = src.f; to.v = src.f ? '(formel)' : src.v;
    },
    _sh: sh, _r: r, _c: c
  };
  return R;
}

function makeServer(sheets, props) {
  const book = {};
  sheets.forEach(s => { book[s.name] = s; });
  const store = {};
  const cache = {
    get: k => store[k] ?? null, put: (k, v) => { store[k] = String(v); }, remove: k => { delete store[k]; },
    getAll: ks => Object.fromEntries(ks.filter(k => k in store).map(k => [k, store[k]])),
    putAll: o => Object.entries(o).forEach(([k, v]) => { store[k] = v; })
  };
  const ss = {
    getSheetByName: n => book[n] || null, insertSheet: n => (book[n] = makeSheet(n, [])),
    getSpreadsheetTimeZone: () => 'UTC'
  };
  const builder = () => { let t = '', u = null, l = null; const b = { setText: x => (t = x, b),
    setLinkUrl: (...a) => (a.length === 3 ? (l = (l || []).concat([{ s: a[0], e: a[1], u: a[2] }])) : (u = a[0]), b), build: () => rt(t, u, l) }; return b; };
  const ctx = {
    console, Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newRichTextValue: builder, flush() {},
      CopyPasteType: { PASTE_FORMAT: 'format' } },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: html => { const o = { html, title: '', setTitle(t) { o.title = t; return o; }, addMetaTag() { return o; } }; return o; } },
    ScriptApp: {},
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, s) => [...crypto.createHash('md5').update(s, 'utf8').digest()],
      base64EncodeWebSafe: b => Buffer.from(b.map(x => x & 255)).toString('base64url'),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? iso(d) : d.toISOString().slice(0, 16),
      parseDate: s => new Date(s + 'T00:00:00Z')
    }
  };
  vm.createContext(ctx);
  const VDate = vm.runInContext('Date', ctx);            // dates must come from the script's own world
  ctx.Utilities.parseDate = str => new VDate(str + 'T00:00:00Z');
  sheets.forEach(sh => sh.g.forEach(r => r.forEach(c => { if (c && isDate(c.v)) c.v = new VDate(c.v.getTime()); })));
  const dir = path.join(__dirname, '..', 'apps-script');
  vm.runInContext(['Code.gs', 'Statistik.gs', 'Grupper.gs'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n'), ctx);
  return { ctx, book, post: body => JSON.parse(ctx.doPost({ postData: { contents: body } }).t) };
}

module.exports = { makeSheet, makeServer, rt };
