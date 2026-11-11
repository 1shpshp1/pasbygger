/* Test data shared by the tests: three trainings (dated from today, so they are always "coming up"),
   one drill and 16 made-up players with level bands (1 = most experienced). */
const { makeSheet, makeServer } = require('./sheet-sim.js');

const NAMES = ['Alma', 'Bo', 'Carl', 'Dina', 'Emil', 'Frida', 'Gustav', 'Hjalte', 'Ida', 'Jonas', 'Karla', 'Lucas', 'Malou', 'Noah', 'Olivia', 'Pelle'];
const BANDS = [[1, 2], [1, 2], [1, 3], [2, 3], [2, 3], [2, 4], [3, 4], [3, 4], [3, 5], [4, 5], [4, 5], [2, 3], [3, 4], [1, 2], [3, 4], [2, 4]];
const CODE = 'coach';

function isoInDays(days) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const SESSION_DATES = [2, 9, 16].map(isoInDays);

/* A simulated server with the Øvelser, plan, Spillere and Grupper tabs filled in */
function testServer() {
  const plan = makeSheet("Træningspas Efterår '26", [
    ['DatoFormat', 'Dato', 'Tema', 'Undertema', 'Fokus', 'Noter', 'Fælles opstart', 'Station 1', 'Station 2', 'Station 3', 'Station 4', 'Fælles afslutning'],
    ...SESSION_DATES.map((d, i) => [new Date(d + 'T00:00:00Z'), d, 'Tema', 'Undertema', 'Fokus ' + (i + 1), '', 'Opvarmning', 'S1', 'S2', 'S3', 'S4', 'Kamp'])
  ]);
  const drills = makeSheet('Øvelser', [['ID', 'Navn', 'Link', 'Kilde'], ['RINUS-40303', '3 mod 3 linjefodbold', 'https://rinus.knvb.nl/exercise/id/40303', 'Rinus']]);
  const props = { DRILLS_PASSWORD: CODE };
  const srv = makeServer([plan, drills], props);
  srv.ctx.setupGroups();
  NAMES.forEach((n, i) => srv.book['Spillere'].getRange(i + 2, 1, 1, 3).setValues([[n, String(BANDS[i][0]), String(BANDS[i][1])]]));
  srv.call = (action, ...args) => srv.post(JSON.stringify({ action, args }));
  srv.props = props;
  return srv;
}

module.exports = { testServer, NAMES, BANDS, CODE, SESSION_DATES };
