// Fills the knowledge base with starter data. Run once: npm run seed
// Dosages are based on the commonly published state-agri-university recommendations
// (N:P2O5:K2O in kg/ha). The agronomist can change any of this from the admin screen.
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const fertilizers = [
  // name, N, P2O5, K2O, type, instructions
  ['Urea',             46, 0, 0,  'Straight',      'Broadcast on moist soil or apply in a band near the root zone. Do not apply on standing water or just before heavy rain.'],
  ['DAP',              18, 46, 0, 'Complex',       'Place in the seed furrow 4-5 cm away from the seed. Direct seed contact damages germination.'],
  ['SSP',              0, 16, 0,  'Straight',      'Mix into the soil at the time of land preparation. Also supplies about 11% sulphur and 19% calcium.'],
  ['MOP',              0, 0, 60,  'Straight',      'Apply as basal dose or as split dose; mix well into the soil.'],
  ['Zinc Sulphate',    0, 0, 0,   'Micronutrient', 'Mix with dry sand and broadcast, do not mix with phosphate fertilizers before applying.'],
  ['Gypsum',           0, 0, 0,   'Amendment',     'Supplies calcium and sulphur, also helps reclaim sodic soils. Work into the top soil.'],
  ['Agricultural Lime',0, 0, 0,   'Amendment',     'Apply in furrows or broadcast and mix well. Keep a gap of at least a week before applying fertilizers.'],
  ['Farmyard Manure',  0.5, 0.25, 0.5, 'Organic',  'Use well decomposed manure only. Spread evenly and incorporate during the last ploughing.']
];

// crop: [N, P2O5, K2O, P source, notes, split per stage]
// split = share of the full dose of each nutrient that goes in at that stage
const crops = {
  rice: { npk: [120, 60, 40], psrc: 'DAP', notes: 'Transplanted irrigated rice. Basal dose goes in at final puddling.',
    split: { sowing: [.25, 1, .5], vegetative: [.45, 0, 0], flowering: [.30, 0, .5], fruiting: [0, 0, 0] },
    timing: { sowing: 'Basal, at final puddling before transplanting', vegetative: 'Active tillering, 20-25 days after transplanting', flowering: 'Panicle initiation, 40-45 days after transplanting' } },
  wheat: { npk: [120, 60, 40], psrc: 'DAP', notes: 'Irrigated timely sown wheat.',
    split: { sowing: [.5, 1, 1], vegetative: [.25, 0, 0], flowering: [.25, 0, 0], fruiting: [0, 0, 0] },
    timing: { sowing: 'Basal, at sowing, drilled below the seed', vegetative: 'With first irrigation (crown root initiation), 20-25 days after sowing', flowering: 'Before boot stage, 55-60 days after sowing' } },
  maize: { npk: [150, 75, 40], psrc: 'DAP', notes: 'Hybrid maize under irrigation.',
    split: { sowing: [.2, 1, 1], vegetative: [.4, 0, 0], flowering: [.4, 0, 0], fruiting: [0, 0, 0] },
    timing: { sowing: 'Basal, at sowing', vegetative: 'Knee-high stage, 25-30 days after sowing', flowering: 'Just before tasseling, 50-55 days after sowing' } },
  cotton: { npk: [120, 60, 60], psrc: 'DAP', notes: 'Irrigated hybrid cotton.',
    split: { sowing: [.2, 1, .5], vegetative: [.3, 0, 0], flowering: [.3, 0, .25], fruiting: [.2, 0, .25] },
    timing: { sowing: 'Basal, at sowing or within 10 days', vegetative: 'Square formation, 30-35 days after sowing', flowering: 'Flowering, 60-65 days after sowing', fruiting: 'Boll development, 85-90 days after sowing' } },
  groundnut: { npk: [25, 50, 50], psrc: 'SSP', notes: 'Rainfed / irrigated bunch groundnut. Needs calcium at pegging.',
    split: { sowing: [.6, 1, 1], vegetative: [.4, 0, 0], flowering: [0, 0, 0], fruiting: [0, 0, 0] },
    timing: { sowing: 'Basal, mixed in the soil before sowing', vegetative: '20-25 days after sowing, at the time of earthing up' } },
  tomato: { npk: [120, 60, 60], psrc: 'DAP', notes: 'Transplanted tomato, drip or furrow irrigated.',
    split: { sowing: [.25, 1, .3], vegetative: [.25, 0, .2], flowering: [.25, 0, .25], fruiting: [.25, 0, .25] },
    timing: { sowing: 'Basal, at transplanting', vegetative: '25-30 days after transplanting', flowering: '45 days after transplanting, at first flowering', fruiting: '60-65 days after transplanting, at fruit set' } }
};

// soil test level -> how much of the full dose to apply
const LEVEL_FACTOR = { low: 1.25, medium: 1, high: 0.5 };
const roundTo5 = x => Math.max(5, Math.round(x / 5) * 5);

(async () => {
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['feedback', 'recommendations', 'rules', 'fertilizers', 'crops']) await db.query(`TRUNCATE TABLE ${t}`);
  await db.query('SET FOREIGN_KEY_CHECKS = 1');

  const fid = {};
  for (const f of fertilizers) {
    const [r] = await db.query('INSERT INTO fertilizers (name, n_pct, p_pct, k_pct, type, instructions) VALUES (?,?,?,?,?,?)', f);
    fid[f[0]] = { id: r.insertId, n: f[1], p: f[2], k: f[3] };
  }

  const stages = ['sowing', 'vegetative', 'flowering', 'fruiting'];
  const insertRule = (cropId, stage, lv, fert, qty, timing, precaution) => db.query(
    `INSERT INTO rules (crop_id, growth_stage, n_level, p_level, k_level, ph_min, ph_max, fertilizer_id, quantity_per_ha, timing, precaution)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [cropId, stage, lv.n || null, lv.p || null, lv.k || null, lv.phMin ?? null, lv.phMax ?? null, fid[fert].id, qty, timing, precaution || null]);

  for (const [name, c] of Object.entries(crops)) {
    const [n, p, k] = c.npk;
    const [r] = await db.query('INSERT INTO crops (crop_name, typical_n, typical_p, typical_k, notes) VALUES (?,?,?,?,?)', [name, n, p, k, c.notes]);
    const cropId = r.insertId;

    for (const st of stages) {
      const [fn, fp, fk] = c.split[st];
      const when = c.timing[st];
      for (const lvl of Object.keys(LEVEL_FACTOR)) {
        const m = LEVEL_FACTOR[lvl];
        if (fn) await insertRule(cropId, st, { n: lvl }, 'Urea', roundTo5(n * fn * m / 0.46), when, lvl === 'high' ? 'Soil nitrogen is already high, dose cut to half. Excess urea causes lodging and pest attack.' : null);
        if (fp) await insertRule(cropId, st, { p: lvl }, c.psrc, roundTo5(p * fp * m / (c.psrc === 'DAP' ? 0.46 : 0.16)), when, c.psrc === 'DAP' ? 'DAP also adds nitrogen, the urea quantity is adjusted for it automatically.' : null);
        if (fk) await insertRule(cropId, st, { k: lvl }, 'MOP', roundTo5(k * fk * m / 0.60), when);
      }
    }

    // organic manure for every crop at sowing
    const fym = name === 'tomato' ? 10000 : name === 'groundnut' ? 2500 : 5000;
    await insertRule(cropId, 'sowing', {}, 'Farmyard Manure', fym, 'At last ploughing, 2-3 weeks before sowing', 'Fresh or half-rotten manure can bring weed seeds and burn seedlings.');
  }

  const cid = {};
  const [cr] = await db.query('SELECT crop_id, crop_name FROM crops');
  cr.forEach(x => (cid[x.crop_name] = x.crop_id));

  // crop specific extras
  await insertRule(cid.rice, 'sowing', {}, 'Zinc Sulphate', 25, 'Basal, at puddling', 'Zinc deficiency shows up as khaira disease, brown patches on young leaves.');
  await insertRule(cid.maize, 'sowing', {}, 'Zinc Sulphate', 25, 'Basal, at sowing', null);
  await insertRule(cid.groundnut, 'flowering', {}, 'Gypsum', 500, 'At pegging stage, 40-45 days after sowing, near the plant base', 'Apply when the soil is moist so that calcium reaches the developing pods.');

  // pH rules, valid for every crop
  await insertRule(null, 'sowing', { phMax: 5.5 }, 'Agricultural Lime', 500, 'Before sowing, mixed in the furrows', 'Soil is acidic. Get a lime requirement test done for the exact dose.');
  await insertRule(null, 'sowing', { phMin: 8.5 }, 'Gypsum', 500, 'Before sowing, with the last ploughing', 'Soil is strongly alkaline, avoid urea on the surface and prefer split doses.');

  const hash = await bcrypt.hash('agro@123', 10);
  await db.query('DELETE FROM users WHERE email = ?', ['agronomist@raitu-raksha.in']);
  await db.query('INSERT INTO users (name, role, email, password_hash, phone, location) VALUES (?,?,?,?,?,?)',
    ['Agronomist', 'agronomist', 'agronomist@raitu-raksha.in', hash, null, 'Warangal']);

  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM rules');
  console.log(`seeded: ${Object.keys(crops).length} crops, ${fertilizers.length} fertilizers, ${n} rules`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
