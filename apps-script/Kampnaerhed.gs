/* ---------- Kampnærhed: how close each drill is to the real game (1-5) ----------
   From repetition to the real game; the fewer constraints, the higher:
     1 Uden bold                      – tag games, catching games, coordination without a ball at the feet
     2 Bold uden reel modstand        – technique, patterns, ball mastery, shooting from a queue, ball games with
                                        catchers or passive resistance
     3 Afgrænset situation            – duels and small overloads played in rounds (served, over at a goal or when the
                                        ball is out), rondos and keep-ball without direction
     4 Retningsspil med faste rammer  – continuous play with direction and transitions, but heavy constraints: players
                                        locked in zones, fixed roles, one-way overload attacks restarted from one place
     5 Spil med få begrænsninger      – both teams attack and defend freely, light rules only (small goals, a fixed
                                        forward, bander/jokers, intervals), up to free match play
   Rated by reading each drill's format, description and type. Change any rating if you disagree.
   1. Run previewKampnaerhed. It writes the tab "Kampnærhed-forslag": drill, format and the suggested level.
      Change a level there if you like (column "Forslag", 1-5).
   2. Run applyKampnaerhed. It writes the levels into the column "Kampnærhed" in "Øvelser" (the column is added
      if it is missing) where the cell is empty or still holds an automatic level from before; anything you have
      typed yourself is kept. */
const KAMP_SHEET = 'Kampnærhed-forslag';
const KAMP_COLUMN = 'Kampnærhed';
const KAMP_LABELS = {
  1: '1 Uden bold', 2: '2 Bold uden reel modstand', 3: '3 Afgrænset situation',
  4: '4 Retningsspil med faste rammer', 5: '5 Spil med få begrænsninger'
};
/* The labels from the first version of this scale: cells that still hold one of them are updated */
const KAMP_OLD_LABELS = ['1 Teknik uden modstand', '2 Leg og teknik med lidt modstand', '3 Afgrænset situation',
  '4 Retningsspil med regler', '5 Kamplignende spil'];

/* Drill ID -> level, grouped by level */
const KAMP_LEVELS = {
  1: [
    '13204', '13232', '13233', '13234', '13235', '13236',
    '13237', 'FCK-1556', 'FCK-651161dfdcaa6', 'FCK-6659952647c5e', 'FCK-66599a3984e1e', 'FCK-673482e877520',
    'FCK-d6d85796af0ea15c', 'FCK-f477f34aa534f192', 'NFF-50840aa9'
  ],
  2: [
    '13194', '13201', '13202', '13203', '13206', '13207',
    '13208', '13209', '13210', '13212', '13214', '13242',
    '13250', 'FCK-0f5ba155b837efd3', 'FCK-1546', 'FCK-1552', 'FCK-1553', 'FCK-1554',
    'FCK-1555', 'FCK-1557', 'FCK-15575c02df65bed3', 'FCK-1558', 'FCK-1559', 'FCK-1560',
    'FCK-1616', 'FCK-1637', 'FCK-1671', 'FCK-1673', 'FCK-1677', 'FCK-1688',
    'FCK-3784fdfbd6f6bf37', 'FCK-650d76541f0e8', 'FCK-6511626a1ed2d', 'FCK-6511627ad1df0', 'FCK-651162cadc7ba', 'FCK-655b6bc17ea1e',
    'FCK-667148314b30c', 'FCK-66714f117f766', 'FCK-66714fb6ab01c', 'FCK-6671590c03fb9', 'FCK-667537381c4c4', 'FCK-667539809bc50',
    'FCK-67347f0c6f09a', 'FCK-67c7fc6b2d927', 'FCK-67c7fd7153edb', 'FCK-67c83deb1cb18', 'FCK-67ee8a599c661', 'NFF-005c2004',
    'NFF-0122a47c', 'NFF-01e37d06', 'NFF-05f8f9c0', 'NFF-1a8438b0', 'NFF-201eb83c', 'NFF-34925fa1',
    'NFF-3ff65472', 'NFF-43f72c40', 'NFF-45f7dff2', 'NFF-46811b03', 'NFF-4c3b1b0b', 'NFF-4ca284cd',
    'NFF-4ce48890', 'NFF-57fb7cd4', 'NFF-66d96c10', 'NFF-79f8e879', 'NFF-7c0ea34b', 'NFF-7c6f0553',
    'NFF-8bf8af7b', 'NFF-93ccc3cc', 'NFF-ae31303e', 'NFF-ae3d7b2b', 'NFF-b6e9a0b9', 'NFF-bd0fcba9',
    'NFF-c2f798e4', 'NFF-c645ffa2', 'NFF-cc4079d4', 'NFF-ccb2bc42', 'NFF-cf4ee0eb', 'NFF-deb3aca2',
    'NFF-drafts.f', 'NFF-ee043bdd', 'NFF-f06b2692', 'NFF-f1210f1c', 'NFF-f4de3a27', 'NFF-fe8ad76f'
  ],
  3: [
    '12928', '12935', '12936', '12937', '12943', '12976',
    '12982', '12983', '12984', '13021', '13023', '13052',
    '13060', '13061', '13062', '13089', '13091', '13096',
    '13117', '13127', '13141', '13145', '13157', '13159',
    '13160', '13211', '13213', '13215', '13266', '13267',
    'FCK-1573', 'FCK-1574', 'FCK-1583', 'FCK-1586', 'FCK-1639', 'FCK-1641',
    'FCK-1642', 'FCK-1643', 'FCK-214cfcec066e544e', 'FCK-37ce4145aaf49808', 'FCK-65116122af97e', 'FCK-651161b211b81',
    'FCK-651161c9b7fa1', 'FCK-6511620597b9d', 'FCK-6511621deb374', 'FCK-6511623a41c99', 'FCK-6511625380bb2', 'FCK-6513d7c236e53',
    'FCK-6517013d155ec', 'FCK-654ac1a9a5ebfd1c', 'FCK-656074b51c0d6', 'FCK-65607632521fe', 'FCK-65702c124ef33', 'FCK-6614f7fed6f09',
    'FCK-6614fd88934a4', 'FCK-6614ff5939169', 'FCK-66163adc4bc10', 'FCK-66163f5bdac0f', 'FCK-661643ba6401d', 'FCK-6617b4f522f7d',
    'FCK-6628dbd24a628', 'FCK-662b8fbd08185', 'FCK-662b92901501a', 'FCK-662bdd43830ee', 'FCK-662be10a08621', 'FCK-662ca704d1c98',
    'FCK-662cab3cbdd59', 'FCK-665b37185cfe7', 'FCK-6662bdf227fa4', 'FCK-667177958f882', 'FCK-6673e9636d0f4', 'FCK-667404bab8f93',
    'FCK-6674070847eed', 'FCK-66740bab31ead', 'FCK-667530740f70d', 'FCK-667531edbdfee', 'FCK-667533afb6eb6', 'FCK-667534b238e1d',
    'FCK-66753b0726650', 'FCK-67347a76ca8b4', 'FCK-67347d006c6d4', 'FCK-6734854eaba12', 'FCK-67c730a6c162e', 'FCK-67c750194b322',
    'FCK-67c752e0f19dc', 'FCK-67c7efe961438', 'FCK-67c7f24b184b9', 'FCK-67c7f4c763886', 'FCK-67c7f839d1c1d', 'FCK-67c7fac9bf5e9',
    'FCK-689f1cdd38a13', 'FCK-72e9619abd9f4d29', 'FCK-7d0f54cbbc95b863', 'FCK-8e5859d76b7597aa', 'FCK-9484c0ccd6d4a0fa', 'FCK-c57523c5508e19ac',
    'FCK-ecfc8bd5b4ab264b', 'FCK-f724e920c84b6098', 'NFF-016abc4e', 'NFF-062a8469', 'NFF-0aa50f64', 'NFF-0b3023ee',
    'NFF-1155d8a8', 'NFF-11feaba9', 'NFF-23b898f0', 'NFF-284a300d', 'NFF-34a84eb8', 'NFF-3839f07f',
    'NFF-48c81bf0', 'NFF-5120fe06', 'NFF-53fdc7d3', 'NFF-5b1c1d3b', 'NFF-5e6adf61', 'NFF-60aacce4',
    'NFF-66fb3de4', 'NFF-6fd074c9', 'NFF-7b3ada81', 'NFF-8358ed88', 'NFF-8de9aca9', 'NFF-8ef13e90',
    'NFF-928ba4d0', 'NFF-94d93fdd', 'NFF-a4780a2f', 'NFF-ab8fa2fe', 'NFF-af63d5f5', 'NFF-b155c8fe',
    'NFF-b6970a80', 'NFF-b866cfca', 'NFF-bb5e2ae8', 'NFF-bca960b1', 'NFF-bcb066b4', 'NFF-c1a27a1b',
    'NFF-c2fccc2f', 'NFF-c3236303', 'NFF-cb1e1d01', 'NFF-d00af075', 'NFF-d4cbf958', 'NFF-d5638b61',
    'NFF-d62fef82', 'NFF-dd21d42c', 'NFF-drafts.e', 'NFF-e13ab42e', 'NFF-e2f3b35f', 'NFF-e39dab6a',
    'NFF-ecda33b6', 'NFF-ef7e21ac', 'NFF-f5b1a6c9', 'NFF-f9f8f3b4'
  ],
  4: [
    '12929', '12931', '12934', '12938', '12940', '12942',
    '12944', '12946', '12975', '12987', '12991', '13022',
    '13025', '13027', '13028', '13030', '13032', '13056',
    '13057', '13058', '13067', '13068', '13070', '13072',
    '13105', '13106', '13110', '13114', '13128', '13129',
    '13130', '13146', '13150', '13151', '13158', '13304',
    '13307', 'FCK-1570', 'FCK-1601', 'FCK-1607', 'FCK-1651', 'FCK-6659a4076af97',
    'FCK-6661a613780cb', 'FCK-6662a57ba9b26', 'FCK-66717476ca85e', 'NFF-05500069', 'NFF-091fc72e', 'NFF-09a1c283',
    'NFF-0ac3628b', 'NFF-0b8639b0', 'NFF-1028f094', 'NFF-12a5675c', 'NFF-144bdae5', 'NFF-17db585a',
    'NFF-1cdf6063', 'NFF-1dad056f', 'NFF-1dd23320', 'NFF-23c4f608', 'NFF-24b14e6d', 'NFF-287ab07b',
    'NFF-2db0a9bf', 'NFF-2eb9a15c', 'NFF-3458c5ee', 'NFF-3821468d', 'NFF-38bc0ec7', 'NFF-40507615',
    'NFF-413c1433', 'NFF-418f6835', 'NFF-430f115c', 'NFF-46cddd7a', 'NFF-48de3ddd', 'NFF-51461120',
    'NFF-58485cd4', 'NFF-5c42dbf4', 'NFF-5ecc2be6', 'NFF-5f4b0068', 'NFF-6553418e', 'NFF-6be59e55',
    'NFF-7a2eea8d', 'NFF-82dc9a78', 'NFF-87451b1b', 'NFF-8f92f969', 'NFF-952a4f05', 'NFF-9ed3e73c',
    'NFF-9f1739e4', 'NFF-9f661c92', 'NFF-a56a27f8', 'NFF-a59b58f4', 'NFF-aca97a99', 'NFF-b5cd7069',
    'NFF-b8a2976c', 'NFF-c1124b47', 'NFF-c6bb1048', 'NFF-c81e9c1d', 'NFF-d7a7110d', 'NFF-db8cb5b1',
    'NFF-efed6365', 'NFF-f054093c', 'NFF-f7628618', 'NFF-f8dca576'
  ],
  5: [
    '12930', '12933', '12939', '12941', '12945', '12947',
    '12977', '12978', '12979', '12980', '12981', '12986',
    '12988', '12989', '12990', '12992', '12993', '12994',
    '12995', '12996', '12997', '13024', '13026', '13029',
    '13031', '13033', '13053', '13054', '13055', '13059',
    '13063', '13064', '13065', '13066', '13069', '13071',
    '13073', '13090', '13097', '13104', '13107', '13108',
    '13109', '13111', '13112', '13115', '13116', '13118',
    '13119', '13121', '13133', '13142', '13143', '13144',
    '13147', '13148', '13149', '13243', '13247', '13248',
    '13262', '13263', '13264', '13265', '13297', 'FCK-1561',
    'FCK-1568', 'FCK-1591', 'FCK-1592', 'FCK-1593', 'FCK-1595', 'FCK-474eaa81e61284db',
    'FCK-6511629a36369', 'FCK-651162ad583a8', 'FCK-662cad2db7a95', 'FCK-6662ada445783', 'FCK-d2901a8e739bcff4', 'FCK-fed24d7cb5d99c17',
    'NFF-2995155b', 'NFF-3a3b4e1f', 'NFF-3a83deaa', 'NFF-3ab608f6', 'NFF-49de0862', 'NFF-4d77b21a',
    'NFF-517868d6', 'NFF-90867e34', 'NFF-9fe83aa6', 'NFF-a1909f01', 'NFF-a3a0b4cc', 'NFF-ab38645a',
    'NFF-b4f68c89', 'NFF-cc2a991f', 'NFF-d5f141bc', 'NFF-dd03b376', 'NFF-e6bf48d4', 'NFF-e75847d3',
    'NFF-e8193f37', 'NFF-fca11ab0'
  ]
};

function kampIndex_() {
  const out = {};
  Object.keys(KAMP_LEVELS).forEach(lv => KAMP_LEVELS[lv].forEach(id => { out[id] = +lv; }));
  return out;
}

function previewKampnaerhed() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const v = ss.getSheetByName(DRILLS_SHEET).getDataRange().getDisplayValues();
  const h = drillHeaders_(v[0]);
  const at = c => h.indexOf(c);
  const levels = kampIndex_();
  const rows = [], seen = {};
  v.slice(1).forEach(r => {
    const id = String(r[at('ID')]).trim();
    if (!levels[id] || seen[id]) return;
    seen[id] = true;
    rows.push([id, r[at('Navn')], at('Kilde') === -1 ? '' : r[at('Kilde')], at('Format') === -1 ? '' : r[at('Format')],
      at(KAMP_COLUMN) === -1 ? '' : r[at(KAMP_COLUMN)], levels[id], KAMP_LABELS[levels[id]]]);
  });
  const out = ss.getSheetByName(KAMP_SHEET) || ss.insertSheet(KAMP_SHEET);
  out.clear();
  const all = [['ID', 'Navn', 'Kilde', 'Format', 'Nu', 'Forslag', 'Betyder']].concat(rows);
  out.getRange(1, 1, all.length, 7).setNumberFormat('@').setValues(all.map(r => r.map(String)));
  out.getRange(1, 1, 1, 7).setFontWeight('bold');
  out.getRange(1, 6, all.length, 1).setBackground('#fff8d6');
  out.setFrozenRows(1);
  const msg = rows.length + ' drill(s) got a suggested level. See the tab "' + KAMP_SHEET + '".';
  Logger.log(msg);
  return msg;
}

function applyKampnaerhed() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DRILLS_SHEET);

  // The levels as they stand in the preview tab (your changes there win); otherwise the list above
  const levels = kampIndex_();
  const prev = ss.getSheetByName(KAMP_SHEET);
  if (prev) prev.getDataRange().getDisplayValues().slice(1).forEach(r => {
    const id = String(r[0]).trim(), lv = parseInt(r[5], 10);
    if (id && lv >= 1 && lv <= 5) levels[id] = lv;
  });

  let values = sheet.getDataRange().getValues();
  let h = drillHeaders_(values[0].map(String));
  if (h.indexOf(KAMP_COLUMN) === -1) {                 // add the column at the end of row 1
    let last = h.length;
    while (last && !String(h[last - 1]).trim()) last--;
    sheet.getRange(1, last + 1).setValue(KAMP_COLUMN);
    values = sheet.getDataRange().getValues();
    h = drillHeaders_(values[0].map(String));
  }
  const iId = h.indexOf('ID'), iK = h.indexOf(KAMP_COLUMN);
  let n = 0;
  const col = values.slice(1).map(r => {
    const lv = levels[String(r[iId]).trim()];
    const now = String(r[iK] || '').trim();
    if (lv && now !== KAMP_LABELS[lv] && (!now || KAMP_OLD_LABELS.indexOf(now) !== -1)) { n++; return [KAMP_LABELS[lv]]; }
    return [r[iK]];
  });
  if (col.length) sheet.getRange(2, iK + 1, col.length, 1).setValues(col);
  if (typeof clearDrillCache === 'function') clearDrillCache();
  const msg = n + ' drill(s) got Kampnærhed.';
  Logger.log(msg);
  return msg;
}
