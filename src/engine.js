// Rule matching + quantity calculation. No ML here, on purpose: every number in a
// recommendation can be traced back to a row in the rules table.
const db = require('./db');

// available nutrient thresholds in kg/ha (soil health card style ratings)
const THRESHOLDS = {
  n: { low: 280, high: 560 },
  p: { low: 11, high: 25 },
  k: { low: 110, high: 280 }
};

const AREA_TO_HA = { hectare: 1, acre: 0.404686, guntha: 0.0101171, cent: 0.00404686, sqm: 0.0001 };

function toHectares(value, unit) {
  const f = AREA_TO_HA[unit];
  const v = Number(value);
  if (!f) throw new Error('Unknown area unit: ' + unit);
  if (!(v > 0)) throw new Error('Area must be greater than zero');
  return v * f;
}

// accepts "low" / "medium" / "high" or a number in kg/ha
function toLevel(nutrient, raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(s)) return s;
  const v = Number(s);
  if (Number.isNaN(v) || v < 0) throw new Error(`Invalid ${nutrient.toUpperCase()} value`);
  const t = THRESHOLDS[nutrient];
  return v < t.low ? 'low' : v <= t.high ? 'medium' : 'high';
}

function normalizeSoil(input = {}) {
  const ph = input.ph === '' || input.ph == null ? null : Number(input.ph);
  if (ph !== null && (Number.isNaN(ph) || ph < 3 || ph > 10)) throw new Error('pH should be between 3 and 10');
  return {
    ph,
    n: toLevel('n', input.n),
    p: toLevel('p', input.p),
    k: toLevel('k', input.k),
    raw: { n: input.n ?? null, p: input.p ?? null, k: input.k ?? null }
  };
}

function ruleMatches(r, stage, soil) {
  if (r.growth_stage && r.growth_stage !== stage) return false;
  for (const x of ['n', 'p', 'k']) {
    const need = r[x + '_level'];
    if (need && need !== soil[x]) return false;       // soil value missing => rule does not fire
  }
  const needsPh = r.ph_min !== null || r.ph_max !== null;
  if (needsPh) {
    if (soil.ph === null) return false;
    if (r.ph_min !== null && soil.ph < Number(r.ph_min)) return false;
    if (r.ph_max !== null && soil.ph >= Number(r.ph_max)) return false;
  }
  return true;
}

async function recommend({ cropId, stage, soilInput, area, areaUnit }) {
  const areaHa = toHectares(area, areaUnit);
  const soil = normalizeSoil(soilInput);

  const [[crop]] = await db.query('SELECT * FROM crops WHERE crop_id = ?', [cropId]);
  if (!crop) throw new Error('Crop not found');

  const [rules] = await db.query(
    `SELECT r.*, f.name AS fert_name, f.n_pct, f.p_pct, f.k_pct, f.instructions
       FROM rules r JOIN fertilizers f ON f.fertilizer_id = r.fertilizer_id
      WHERE r.crop_id = ? OR r.crop_id IS NULL`, [cropId]);

  // 1. collect every rule that fires and merge by fertilizer
  const merged = new Map();
  for (const r of rules.filter(r => ruleMatches(r, stage, soil))) {
    const m = merged.get(r.fertilizer_id) || {
      fertilizerId: r.fertilizer_id, fertilizer: r.fert_name, composition: `${+r.n_pct}-${+r.p_pct}-${+r.k_pct}`,
      n: +r.n_pct, instructions: r.instructions, perHa: 0, timing: [], precautions: [], ruleIds: []
    };
    m.perHa += Number(r.quantity_per_ha);
    if (!m.timing.includes(r.timing)) m.timing.push(r.timing);
    if (r.precaution && !m.precautions.includes(r.precaution)) m.precautions.push(r.precaution);
    m.ruleIds.push(r.rule_id);
    merged.set(r.fertilizer_id, m);
  }
  let items = [...merged.values()];

  // 2. nitrogen already coming from DAP / manure is taken off the urea dose
  const urea = items.find(i => i.fertilizer.toLowerCase() === 'urea');
  if (urea) {
    const nFromOthers = items.filter(i => i !== urea && i.fertilizer !== 'Farmyard Manure')
      .reduce((s, i) => s + i.perHa * i.n / 100, 0);
    const cut = nFromOthers / (urea.n / 100);
    if (cut > 0) {
      urea.perHa = Math.max(0, urea.perHa - cut);
      urea.precautions.push(`Reduced by ${Math.round(cut)} kg/ha because other fertilizers in this plan already supply nitrogen.`);
    }
    if (urea.perHa < 1) items = items.filter(i => i !== urea);
  }

  // 3. scale to the farmer's land
  items = items.map(i => ({
    fertilizerId: i.fertilizerId,
    fertilizer: i.fertilizer,
    composition: i.composition,
    quantityPerHa: Math.round(i.perHa * 10) / 10,
    quantityForArea: Math.round(i.perHa * areaHa * 100) / 100,
    timing: i.timing.join('; '),
    precautions: i.precautions,
    howToApply: i.instructions,
    ruleIds: i.ruleIds
  })).sort((a, b) => b.quantityPerHa - a.quantityPerHa);

  const remarks = [];
  if (soil.ph !== null && soil.ph >= 6 && soil.ph <= 7.5) remarks.push('Soil pH is in the comfortable range for most crops.');
  if (soil.ph === null) remarks.push('pH was not entered, so lime / gypsum advice was skipped.');
  for (const x of ['n', 'p', 'k']) if (!soil[x]) remarks.push(`${x.toUpperCase()} was not entered, so no ${x.toUpperCase()} specific advice was generated.`);
  if (!items.length) {
    const stageHasRules = rules.some(r => r.crop_id && r.growth_stage === stage);
    remarks.push(stageHasRules
      ? 'No rule in the knowledge base matches this soil combination. Please contact your local agronomist.'
      : `The standard schedule for ${crop.crop_name} has no fertilizer dose at the ${stage} stage. The last top dressing is normally given earlier.`);
  }

  return {
    crop: crop.crop_name, stage, areaHa: Math.round(areaHa * 10000) / 10000,
    soil: { ph: soil.ph, n: soil.n, p: soil.p, k: soil.k },
    items, remarks
  };
}

module.exports = { recommend, normalizeSoil, toHectares, THRESHOLDS, AREA_TO_HA };
