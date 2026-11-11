/* The grouping rules, tested on the code exactly as it is in index.html (no browser needed). */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./app-code.js');
const { NAMES, BANDS } = require('./fixtures.js');

const squad = () => NAMES.map((name, i) => ({ name, lo: BANDS[i][0], hi: BANDS[i][1] }));
const random = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const sizesOk = groups => { const s = groups.map(g => g.length); return Math.max(...s) - Math.min(...s) <= 1; };
const names = groups => groups.map(g => g.map(p => p.name));

test('Bånd: no group breaks the level rule, and sizes differ by at most 1', () => {
  const r = A.makeGroups({ players: squad(), k: 4, prev: null, history: {}, stay: {}, change: 0.25, seed: 1 });
  assert.equal(r.conflicts, 0);
  assert.ok(sizesOk(r.groups));
  r.groups.forEach(g => g.forEach((a, i) => g.slice(i + 1).forEach(b => assert.ok(A.bandsMeet(a, b), `${a.name} and ${b.name} share a group`))));
});

test('Bånd: with nothing saved, pressing again gives a different mix', () => {
  const a = A.makeGroups({ players: squad(), k: 4, prev: null, history: {}, stay: {}, change: 0.25, seed: 1 });
  const b = A.makeGroups({ players: squad(), k: 4, prev: null, history: A.pairHistory([names(a.groups)]), stay: {}, change: 0.25, seed: 2 });
  const key = r => JSON.stringify(names(r.groups).map(g => g.slice().sort()).sort());   // compare as text (the app's lists live in its own sandbox)
  assert.notEqual(key(a), key(b));
});

test('Bånd: the slider decides how many players change group', () => {
  const saved = [];
  let off = 0;
  for (let s = 0; s < 10; s++) {
    const r = A.makeGroups({ players: squad(), k: 4, prev: saved[0] || null, history: A.pairHistory(saved), stay: A.stayRuns(saved), change: 0.25, seed: 100 + s });
    if (r.target != null) off += Math.abs(r.moved - r.target);
    assert.equal(r.conflicts, 0);
    saved.unshift(names(r.groups));
  }
  assert.ok(off <= 2, `moves differed from the slider by ${off} in total over 10 trainings`);
});

test('Bånd: over time players get many different teammates', () => {
  const saved = [], met = new Set();
  for (let s = 0; s < 10; s++) {
    const r = A.makeGroups({ players: squad(), k: 4, prev: saved[0] || null, history: A.pairHistory(saved), stay: A.stayRuns(saved), change: 0.5, seed: 200 + s });
    names(r.groups).forEach(g => g.forEach((a, i) => g.slice(i + 1).forEach(b => met.add([a, b].sort().join()))));
    saved.unshift(names(r.groups));
  }
  let allowed = 0;
  squad().forEach((a, i, all) => all.slice(i + 1).forEach(b => { if (A.bandsMeet(a, b)) allowed++; }));
  assert.ok(met.size >= 0.8 * allowed, `${met.size} of ${allowed} possible pairs met`);
});

test('Even sizes: an even split is found whenever one is possible (narrow bands)', () => {
  let avoidable = 0, total = 0;
  const roster = [...Array(20)].map((_, i) => ({ name: 'p' + i, lo: 1 + (i % 5), hi: Math.min(5, 1 + (i % 5) + 1) }));
  const skill = Object.fromEntries(roster.map(p => [p.name, p.lo]));
  for (const k of [3, 4]) {
    const saved = [];
    for (let s = 0; s < 15; s++) {
      const present = roster.filter((_, i) => (i * 7 + s) % 9);
      const r = A.makeGroups({ players: present, k, prev: saved[0] || null, history: A.pairHistory(saved), stay: A.stayRuns(saved), change: 0.25, seed: s, skill, mix: A.skillMix(saved, skill) });
      total++;
      if (!sizesOk(r.groups) && sizesOk(A.makeGroups({ players: present, k, prev: null, history: {}, stay: {}, change: 1, seed: s + 99 }).groups)) avoidable++;
      saved.unshift(names(r.groups));
    }
  }
  assert.ok(avoidable <= 1, `${avoidable} of ${total} trainings had uneven sizes that could have been even`);
});

test('Max-niveau: sorted by Fra, group 1 the most experienced, sizes even', () => {
  const players = squad().concat([{ name: 'Uden niveau', lo: null, hi: null }]);
  const groups = A.sortedGroups(players, 4, p => p.lo, 7);
  assert.equal(groups.flat().length, players.length);
  assert.ok(sizesOk(groups));
  const known = groups.map(g => g.filter(p => p.lo != null).map(p => p.lo));
  for (let i = 0; i + 1 < known.length; i++) assert.ok(Math.max(...known[i]) <= Math.min(...known[i + 1]), `group ${i + 1} is not before group ${i + 2}`);
});

test('Kampe: 3 groups make 2 matches, every player plays, sizes differ by at most 1', () => {
  const mk = (gi, levels) => levels.map((l, i) => ({ name: gi + '-' + i, lo: l }));
  const groups = [mk(1, [1, 1, 1, 2, 2]), mk(2, [2, 2, 3, 3, 3]), mk(3, [3, 4, 4, 4])];
  const ms = A.makeMatches(groups, p => p.lo, 1);
  assert.equal(ms.length, 2);
  assert.equal(ms.reduce((n, m) => n + m.teams[0].length + m.teams[1].length, 0), 14);
  ms.forEach(m => assert.ok(Math.abs(m.teams[0].length - m.teams[1].length) <= 1));
  assert.ok(ms[0].avg[0] <= ms[1].avg[0] && ms[0].avg[1] <= ms[1].avg[1], 'the first match is the more experienced');
});

test('Kampe: with an even number of players every pair is as close as possible', () => {
  const rand = random(11);
  for (let t = 0; t < 120; t++) {
    const k = 2 + Math.floor(rand() * 4);
    const groups = Array.from({ length: k }, (_, gi) => Array.from({ length: 2 + Math.floor(rand() * 5) }, (_, i) => ({ name: gi + '-' + i, lo: 1 + Math.floor(rand() * 5) })));
    const ms = A.makeMatches(groups, p => p.lo, t);
    assert.equal(ms.length, k % 2 ? (k + 1) / 2 : k / 2);
    ms.filter(m => (m.teams[0].length + m.teams[1].length) % 2 === 0).forEach(m => {
      const [a, b] = m.teams;
      const gap = a.reduce((x, p, i) => x + Math.abs(p.lo - b[i].lo), 0);
      const v = a.concat(b).map(p => p.lo).sort((x, y) => x - y);
      let best = 0; for (let i = 0; i < v.length; i += 2) best += v[i + 1] - v[i];
      assert.equal(gap, best);
    });
  }
});

test('Kampe: the team with a player fewer gets a little more experience', () => {
  const mk = (gi, levels) => levels.map((l, i) => ({ name: gi + '-' + i, lo: l }));
  const [m] = A.makeMatches([mk(1, [3, 3, 3, 3, 3]), mk(2, [4, 4])], p => p.lo, 3);
  const [big, small] = m.teams;
  assert.equal(big.length, 4); assert.equal(small.length, 3);
  const points = t => t.reduce((x, p) => x + (5 - p.lo), 0);   // most experienced level gives the most points
  assert.equal(points(big), points(small));
});

test('Pool sizes are even where possible', () => {
  assert.deepEqual(Array.from(A.poolSizes(14, 2)), [8, 6]);   // (Array.from: the list comes from the app's own sandbox)
  assert.deepEqual(Array.from(A.poolSizes(15, 2)), [8, 7]);
  assert.deepEqual(Array.from(A.poolSizes(16, 2)), [8, 8]);
});
