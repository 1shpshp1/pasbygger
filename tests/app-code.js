/* The grouping code exactly as the app runs it: the block from index.html between
   "The grouping itself" and "Training groups", evaluated on its own (it uses no screen code). */
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('/* ---- The grouping itself (no screen code here) ----');
const end = html.indexOf('/* ===================== Training groups');
if (start < 0 || end < start) throw new Error('Could not find the grouping code in index.html');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(start, end) +
  '\n;this.api = { makeGroups, sortedGroups, makeMatches, poolSizes, pairHistory, stayRuns, skillMix, groupLevel, bandsMeet, hashText };', ctx);
module.exports = ctx.api;
