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

test('Kampe 25-50-25: middle levels move towards the aim over time; nobody is far from their match', () => {
  const P = squad(), level = name => (P.find(p => p.name === name) || {}).lo;
  const saved = [];
  for (let s = 0; s < 16; s++) {
    const present = P.filter((_, i) => (i * 5 + s) % 7);
    const groups = A.sortedGroups(present, 4, p => p.lo, s + 1);
    const ms = A.makeMixMatches(groups, p => p.lo, A.matchMix(saved, level), s + 7);
    assert.equal(ms.reduce((n, m) => n + m.teams[0].length + m.teams[1].length, 0), present.length, 'everyone plays');
    ms.forEach(m => {
      assert.ok(Math.abs(m.teams[0].length - m.teams[1].length) <= 1);
      const ps = m.teams[0].concat(m.teams[1]);
      ps.forEach(p => {
        const o = ps.filter(q => q !== p).map(q => q.lo), avg = o.reduce((x, y) => x + y, 0) / o.length;
        assert.ok(Math.abs(avg - p.lo) <= 1.5 + 1e-9, `${p.name} (${p.lo}) in a match averaging ${avg.toFixed(2)}`);
      });
    });
    saved.unshift(Array.from(ms, m => m.teams.map(t => t.map(p => p.name))));
  }
  const mix = A.matchMix(saved, level);
  const fra2 = P.filter(p => p.lo === 2).map(p => mix[p.name]).filter(Boolean);
  const share = r => fra2.reduce((x, m) => x + m[r] / m[3], 0) / fra2.length;
  assert.ok(share(0) >= 0.15 && share(2) >= 0.15, `level 2 gets harder (${share(0).toFixed(2)}) and easier (${share(2).toFixed(2)}) matches`);
  assert.ok(share(1) >= 0.3, `and mostly own level (${share(1).toFixed(2)})`);
});

test('Kampe 25-50-25: what counts as harder, own level and easier', () => {
  assert.equal(A.matchCategory(3, 2.5), 0);      // the others are half a level more experienced: harder
  assert.equal(A.matchCategory(3, 2.7), 1);
  assert.equal(A.matchCategory(3, 3.5), 2);      // half a level less experienced: easier
  assert.equal(A.matchCategory(NaN, 2), 1);      // no level: counts as own level
});

test('Antal kampe: 4 groups can give 1, 2, 3 or 4 matches in both modes; Auto is half the groups', () => {
  const groups = A.sortedGroups(squad(), 4, p => p.lo, 1);
  assert.equal(A.matchCount(groups), 2);
  assert.equal(A.matchCount(A.sortedGroups(squad(), 5, p => p.lo, 1)), 3);
  for (const count of [1, 2, 3, 4]) {
    for (const ms of [A.makeMatches(groups, p => p.lo, 1, count), A.makeMixMatches(groups, p => p.lo, {}, 1, count)]) {
      assert.equal(ms.length, count);
      assert.equal(ms.reduce((n, m) => n + m.teams[0].length + m.teams[1].length, 0), 16, 'everyone plays');
      ms.forEach(m => assert.ok(Math.abs(m.teams[0].length - m.teams[1].length) <= 1));
    }
  }
  const three = A.makeMatches(groups, p => p.lo, 1, 3);
  assert.ok(three[0].avg[0] <= three[1].avg[0] && three[1].avg[0] <= three[2].avg[0], 'Niveau: most experienced match first');
});

test('Chosen match sizes: used when they add up to the players, in both modes', () => {
  const groups = A.sortedGroups(squad(), 4, p => p.lo, 1);
  const sizes = ms => Array.from(ms, m => m.teams[0].length + m.teams[1].length);
  assert.deepEqual(sizes(A.makeMatches(groups, p => p.lo, 1, 3, [4, 4, 8])), [4, 4, 8]);
  assert.deepEqual(sizes(A.makeMixMatches(groups, p => p.lo, {}, 1, 3, [4, 4, 8])), [4, 4, 8]);
  assert.deepEqual(sizes(A.makeMatches(groups, p => p.lo, 1, 2, [10, 6])), [10, 6]);
  assert.equal(A.sizesFor(groups, 3, [5, 5, 5]), null, 'sizes that don\'t add up to 16 are not used');
  assert.deepEqual(sizes(A.makeMatches(groups, p => p.lo, 1, 3, [5, 5, 5])), [6, 6, 4], 'even sizes instead');
  const big = A.makeMatches(groups, p => p.lo, 1, 3, [4, 4, 8]);
  assert.ok(big[0].avg[0] <= big[2].avg[0], 'Niveau: match 1 is still the most experienced');
});

test('Puljer: splitPools gives the chosen sizes by every rule; Max-niveau puts the most experienced first', () => {
  const players = squad().concat([{ name: 'Q1', lo: 2, hi: 3 }, { name: 'Q2', lo: 3, hi: 4 }, { name: 'Q3', lo: 5, hi: 5 }, { name: 'Q4', lo: 1, hi: 2 }]);
  const opts = { level: p => p.lo, meet: A.bandsMeet, keepOrder: true, mix: {} };
  for (const kind of ['max', 'band', 'even', 'chaos', 'mix']) {
    const pools = Array.from(A.splitPools(players, [6, 6, 8], kind, 3, opts));
    assert.deepEqual(pools.map(p => p.length), [6, 6, 8], kind + ': sizes kept');
    assert.equal(new Set(pools.flat().map(p => p.name)).size, 20, kind + ': everyone once');
  }
  const [top, mid, low] = Array.from(A.splitPools(players, [6, 6, 8], 'max', 1, opts));
  assert.ok(Math.max(...top.map(p => p.lo)) <= Math.min(...mid.map(p => p.lo)));
  assert.ok(Math.max(...mid.map(p => p.lo)) <= Math.min(...low.map(p => p.lo)));
  const avg = ps => ps.reduce((x, p) => x + p.lo, 0) / ps.length;
  const even = Array.from(A.splitPools(players, [10, 10], 'even', 1, opts));
  assert.ok(Math.abs(avg(even[0]) - avg(even[1])) <= 0.1 + 1e-9, 'Lige hold: pools as equal as possible');
  const draws = new Set();
  for (let seed = 1; seed <= 10; seed++) draws.add(A.splitPools(players, [10, 10], 'chaos', seed, opts)[0].map(p => p.name).sort().join());
  assert.ok(draws.size >= 9, 'Kaos: different pools each time');
});

test('Del kampene efter: Max-niveau, Bånd, Lige hold, Kaos and given pools', () => {
  const P = squad(), opts = { level: p => p.lo, meet: A.bandsMeet };
  const all = ms => Array.from(ms).reduce((n, m) => n + m.teams[0].length + m.teams[1].length, 0);
  const avg = m => { const ps = m.teams[0].concat(m.teams[1]); return ps.reduce((x, p) => x + p.lo, 0) / ps.length; };
  const max = A.makePoolMatches(P, [8, 8], 'max', 1, opts);
  assert.equal(all(max), 16);
  assert.ok(avg(max[0]) < avg(max[1]), 'Max-niveau: match 1 the more experienced');
  const wide = Array.from({ length: 18 }, (_, i) => ({ name: 'w' + i, lo: 1 + (i % 3), hi: 3 + (i % 3) }));
  const band = A.makePoolMatches(wide, [6, 6, 6], 'band', 1, opts);
  Array.from(band).forEach(m => { const ps = m.teams[0].concat(m.teams[1]); ps.forEach((a, i) => ps.slice(i + 1).forEach(b => assert.ok(A.bandsMeet(a, b)))); });
  const even = A.makePoolMatches(P, [8, 8], 'even', 1, opts);
  assert.ok(Math.abs(avg(even[0]) - avg(even[1])) <= 0.125 + 1e-9, 'Lige hold: averages as equal as 16 players allow');
  const sizes = ms => Array.from(ms, m => m.teams[0].length + m.teams[1].length);
  assert.deepEqual(sizes(A.makePoolMatches(P, [4, 4, 8], 'even', 1, Object.assign({ keepOrder: true }, opts))), [4, 4, 8], 'chosen sizes kept');
  const tiers = A.makePoolMatches(P, null, 'pools', 1, Object.assign({ pools: [P.slice(0, 6), P.slice(6)], keepOrder: true }, opts));
  assert.deepEqual(sizes(tiers), [6, 10]);
});

test('Three teams (winner stays on): player for player, even sizes, near-equal averages; Kaos and 25-50-25 too', () => {
  const P = squad(), opts = { level: p => p.lo, meet: A.bandsMeet, teams: 3 };
  assert.deepEqual(Array.from(A.poolSizes(16, 2, 3)), [9, 7]);
  assert.deepEqual(Array.from(A.poolSizes(16, 2)), [8, 8], 'two teams as before');
  const avg = t => t.reduce((x, p) => x + p.lo, 0) / t.length;
  for (const n of [9, 8, 7]) {
    const [m] = A.makePoolMatches(P.slice(0, n), [n], 'even', 2, opts);
    const sizes = m.teams.map(t => t.length);
    assert.equal(m.teams.length, 3);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, n + ' players: sizes ' + sizes);
    for (let i = 0; i < Math.min(...sizes); i++) {                // a line: three players of about the same level
      const line = m.teams.map(t => t[i].lo);
      assert.ok(Math.max(...line) - Math.min(...line) <= 2, 'line ' + i + ': ' + line);
    }
    if (n === 9) assert.ok(Math.max(...m.teams.map(avg)) - Math.min(...m.teams.map(avg)) <= 0.34, 'averages close');
  }
  const [k] = A.makePoolMatches(P, [16], 'chaos', 1, opts);
  assert.deepEqual(Array.from(k.teams, t => t.length), [6, 5, 5]);
  const mix = Array.from(A.makeMixMatches([P], p => p.lo, {}, 1, 2, [9, 7], 3));
  assert.deepEqual(mix.map(m => m.teams.length), [3, 3]);
});

test('Kaos matches are completely random: teams are not balanced, and differ from draw to draw', () => {
  const P = squad(), opts = { level: p => p.lo };
  const draws = new Set();
  let unbalanced = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const [m] = A.makePoolMatches(P, [16], 'chaos', seed, opts);
    assert.equal(m.teams[0].length, 8); assert.equal(m.teams[1].length, 8);
    draws.add(m.teams[0].map(p => p.name).sort().join());
    const sum = t => t.reduce((x, p) => x + p.lo, 0);
    if (Math.abs(sum(m.teams[0]) - sum(m.teams[1])) >= 2) unbalanced++;
  }
  assert.ok(draws.size >= 18, 'different teams each time');
  assert.ok(unbalanced >= 5, 'no balancing: often uneven teams');
});

test('Level mix: a soft transition around half a level (fully the same up to 0,25, fully different from 0,75)', () => {
  const w = (me, o) => Array.from(A.levelWeights(me, o), x => Math.round(x * 1000) / 1000);
  assert.deepEqual(w(2.5, 2.5), [0, 1, 0]);
  assert.deepEqual(w(2.5, 2.75), [0, 1, 0], 'up to 0,25: the same level');
  assert.deepEqual(w(2.5, 3), [0, 0.5, 0.5], '0,5: half the same, half less experienced');
  assert.deepEqual(w(2.5, 2), [0.5, 0.5, 0], '… or half more experienced');
  assert.deepEqual(w(2.5, 3.25), [0, 0, 1], '0,75 or more: fully less experienced');
  assert.deepEqual(w(2.5, 1.5), [1, 0, 0]);
  assert.deepEqual(w(2, 2.49), [0, 0.52, 0.48], 'no jump at half a level …');
  assert.deepEqual(w(2, 2.51), [0, 0.48, 0.52], '… 0,49 and 0,51 count almost the same');
  const mix = A.skillMix([[['a', 'b', 'c']]], { a: 2.5, b: 3, c: 1.5 });
  // a: b counts half same, half less; c fully more experienced (each teammate weighs 1/2)
  assert.deepEqual(Array.from(mix.a, x => Math.round(x * 1000) / 1000), [0.5, 0.25, 0.25, 1]);
  // the matches use the same: the others' average 0,5 better is half harder, half own level
  const hist = A.matchMix([[[['x', 'y'], ['z']]]], n => ({ x: 3, y: 2.5, z: 2.5 })[n]);
  assert.deepEqual(Array.from(hist.x), [0.5, 0.5, 0, 1]);
});

test('"Ingen modspiller" in turn: who had none is read from saved matches, and it rotates', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(A.spareCounts([[[['a', 'b'], ['c']]], [[['d'], ['e'], ['f', 'g']], [['h', 'i'], ['j', 'k']]]]))), { b: 1, g: 1 });
  const P = [1, 1.5, 2, 2.5, 3, 3.5, 4.5].map((lo, i) => ({ name: 'p' + i, lo: lo }));
  const run = (teams, size) => {
    const saved = [], count = {};
    for (let s = 1; s <= 8; s++) {
      const [m] = Array.from(A.makePoolMatches(P.slice(0, size), [size], 'even', s, { level: p => p.lo, teams: teams, spares: A.spareCounts(saved) }));
      const names = m.teams.map(t => t.map(p => p.name));
      saved.unshift([names]);
      const full = Math.min(...names.map(t => t.length));
      names.forEach(t => t.slice(full).forEach(n => { count[n] = (count[n] || 0) + 1; }));
    }
    return count;
  };
  const two = run(2, 7);                                  // one without an opposite number each time
  assert.ok(Object.keys(two).length >= 3 && Math.max(...Object.values(two)) <= 3, 'two teams: ' + JSON.stringify(two));
  P.push({ name: 'p7', lo: 5 });
  const three = run(3, 8);                                // two left over each time
  assert.ok(Object.keys(three).length >= 4 && Math.max(...Object.values(three)) <= 4, 'three teams: ' + JSON.stringify(three));
});
