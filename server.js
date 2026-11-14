require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./src/db');
const { sign, needLogin, needAgronomist } = require('./src/auth');
const { recommend } = require('./src/engine');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// small wrapper so a thrown error in an async route turns into a json response
const h = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e.message);
  res.status(e.status || 400).json({ error: e.message });
});

/* ---------- auth ---------- */
app.post('/api/auth/register', h(async (req, res) => {
  const { name, email, password, phone, location } = req.body;
  if (!name || !email || !password) throw new Error('Name, email and password are required');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  const [dup] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
  if (dup.length) throw new Error('This email is already registered');
  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.query('INSERT INTO users (name, role, email, password_hash, phone, location) VALUES (?,?,?,?,?,?)',
    [name, 'user', email, hash, phone || null, location || null]);
  const user = { user_id: r.insertId, role: 'user', name };
  res.json({ token: sign(user), user: { id: r.insertId, name, role: 'user' } });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const { email, password } = req.body;
  const [[u]] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    const e = new Error('Wrong email or password'); e.status = 401; throw e;
  }
  res.json({ token: sign(u), user: { id: u.user_id, name: u.name, role: u.role, location: u.location } });
}));

/* ---------- crops / knowledge base ---------- */
app.get('/api/crops', needLogin, h(async (req, res) => {
  const [rows] = await db.query('SELECT crop_id AS cropId, crop_name AS cropName, typical_n AS n, typical_p AS p, typical_k AS k, notes FROM crops ORDER BY crop_name');
  res.json(rows);
}));

app.get('/api/kb', needLogin, h(async (req, res) => {
  const [crops] = await db.query('SELECT * FROM crops ORDER BY crop_name');
  const [fertilizers] = await db.query('SELECT * FROM fertilizers ORDER BY name');
  const [rules] = await db.query(
    `SELECT r.*, c.crop_name, f.name AS fertilizer_name FROM rules r
       LEFT JOIN crops c ON c.crop_id = r.crop_id JOIN fertilizers f ON f.fertilizer_id = r.fertilizer_id
      ORDER BY c.crop_name, FIELD(r.growth_stage,'sowing','vegetative','flowering','fruiting'), r.rule_id`);
  res.json({ crops, fertilizers, rules });
}));

/* ---------- recommendations ---------- */
app.post('/api/recommendations/request', needLogin, h(async (req, res) => {
  const { cropId, stage, soil, area, areaUnit } = req.body;
  if (!['sowing', 'vegetative', 'flowering', 'fruiting'].includes(stage)) throw new Error('Select a growth stage');
  const result = await recommend({ cropId, stage, soilInput: soil, area, areaUnit: areaUnit || 'hectare' });
  const [r] = await db.query(
    'INSERT INTO recommendations (user_id, crop_id, soil_input, growth_stage, area_ha, area_input, result) VALUES (?,?,?,?,?,?,?)',
    [req.user.id, cropId, JSON.stringify(soil), stage, result.areaHa, `${area} ${areaUnit}`, JSON.stringify(result)]);
  res.json({ recId: r.insertId, ...result });
}));

// literal "user" path has to be declared before /:id
app.get('/api/recommendations/user/:userId', needLogin, h(async (req, res) => {
  if (+req.params.userId !== req.user.id && req.user.role !== 'agronomist') return res.status(403).json({ error: 'Not allowed' });
  const [rows] = await db.query(
    `SELECT r.rec_id AS recId, c.crop_name AS crop, r.growth_stage AS stage, r.area_input AS area, r.saved, r.generated_at AS generatedAt
       FROM recommendations r JOIN crops c ON c.crop_id = r.crop_id WHERE r.user_id = ? ORDER BY r.generated_at DESC, r.rec_id DESC`, [req.params.userId]);
  res.json(rows);
}));

app.get('/api/recommendations/:id', needLogin, h(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT r.*, u.name AS farmer, u.location FROM recommendations r JOIN users u ON u.user_id = r.user_id WHERE r.rec_id = ?`, [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Recommendation not found' });
  if (r.user_id !== req.user.id && req.user.role !== 'agronomist') return res.status(403).json({ error: 'Not allowed' });
  const result = typeof r.result === 'string' ? JSON.parse(r.result) : r.result;
  const [fb] = await db.query('SELECT rating, comments FROM feedback WHERE rec_id = ? AND user_id = ?', [r.rec_id, req.user.id]);
  res.json({ recId: r.rec_id, farmer: r.farmer, location: r.location, generatedAt: r.generated_at,
             areaInput: r.area_input, saved: !!r.saved, feedback: fb[0] || null, ...result });
}));

app.post('/api/recommendations/:id/save', needLogin, h(async (req, res) => {
  const [r] = await db.query('UPDATE recommendations SET saved = 1 WHERE rec_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Recommendation not found' });
  res.json({ saved: true });
}));

app.post('/api/recommendations/:id/feedback', needLogin, h(async (req, res) => {
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) throw new Error('Rating must be between 1 and 5');
  const [[own]] = await db.query('SELECT rec_id FROM recommendations WHERE rec_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!own) return res.status(404).json({ error: 'Recommendation not found' });
  await db.query('DELETE FROM feedback WHERE rec_id = ? AND user_id = ?', [req.params.id, req.user.id]);   // one feedback per rec
  await db.query('INSERT INTO feedback (rec_id, user_id, rating, comments) VALUES (?,?,?,?)',
    [req.params.id, req.user.id, rating, (req.body.comments || '').slice(0, 500)]);
  res.json({ ok: true });
}));

/* ---------- admin / agronomist ---------- */
const admin = [needLogin, needAgronomist];

app.post('/api/admin/crops', admin, h(async (req, res) => {
  const { cropName, n, p, k, notes } = req.body;
  if (!cropName) throw new Error('Crop name is required');
  const [r] = await db.query('INSERT INTO crops (crop_name, typical_n, typical_p, typical_k, notes) VALUES (?,?,?,?,?)',
    [cropName.trim().toLowerCase(), n || 0, p || 0, k || 0, notes || null]);
  res.json({ cropId: r.insertId });
}));
app.put('/api/admin/crops', admin, h(async (req, res) => {
  const { cropId, cropName, n, p, k, notes } = req.body;
  await db.query('UPDATE crops SET crop_name=?, typical_n=?, typical_p=?, typical_k=?, notes=? WHERE crop_id=?',
    [cropName.trim().toLowerCase(), n || 0, p || 0, k || 0, notes || null, cropId]);
  res.json({ ok: true });
}));

app.post('/api/admin/fertilizers', admin, h(async (req, res) => {
  const f = req.body;
  if (!f.name) throw new Error('Fertilizer name is required');
  const [r] = await db.query('INSERT INTO fertilizers (name, n_pct, p_pct, k_pct, type, instructions) VALUES (?,?,?,?,?,?)',
    [f.name, f.n || 0, f.p || 0, f.k || 0, f.type || 'Straight', f.instructions || null]);
  res.json({ fertilizerId: r.insertId });
}));
app.put('/api/admin/fertilizers', admin, h(async (req, res) => {
  const f = req.body;
  await db.query('UPDATE fertilizers SET name=?, n_pct=?, p_pct=?, k_pct=?, type=?, instructions=? WHERE fertilizer_id=?',
    [f.name, f.n || 0, f.p || 0, f.k || 0, f.type || 'Straight', f.instructions || null, f.fertilizerId]);
  res.json({ ok: true });
}));

const ruleParams = b => {
  if (!b.fertilizerId || !(Number(b.quantityPerHa) > 0)) throw new Error('Fertilizer and a quantity above zero are required');
  if (!b.timing) throw new Error('Timing is required');
  const e = v => (v === '' || v === undefined ? null : v);
  return [e(b.cropId), e(b.stage), e(b.nLevel), e(b.pLevel), e(b.kLevel), e(b.phMin), e(b.phMax),
          b.fertilizerId, b.quantityPerHa, b.timing, b.precaution || null];
};
app.post('/api/admin/rules', admin, h(async (req, res) => {
  const [r] = await db.query(
    `INSERT INTO rules (crop_id, growth_stage, n_level, p_level, k_level, ph_min, ph_max, fertilizer_id, quantity_per_ha, timing, precaution)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`, ruleParams(req.body));
  res.json({ ruleId: r.insertId });
}));
app.put('/api/admin/rules', admin, h(async (req, res) => {
  await db.query(
    `UPDATE rules SET crop_id=?, growth_stage=?, n_level=?, p_level=?, k_level=?, ph_min=?, ph_max=?,
            fertilizer_id=?, quantity_per_ha=?, timing=?, precaution=? WHERE rule_id=?`, [...ruleParams(req.body), req.body.ruleId]);
  res.json({ ok: true });
}));
app.delete('/api/admin/rules/:id', admin, h(async (req, res) => {
  await db.query('DELETE FROM rules WHERE rule_id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/feedback', admin, h(async (req, res) => {
  const [rows] = await db.query(
    `SELECT f.feedback_id AS id, f.rating, f.comments, f.created_at AS createdAt, u.name AS farmer,
            c.crop_name AS crop, r.growth_stage AS stage, r.rec_id AS recId
       FROM feedback f JOIN users u ON u.user_id = f.user_id JOIN recommendations r ON r.rec_id = f.rec_id
       JOIN crops c ON c.crop_id = r.crop_id ORDER BY f.created_at DESC, f.feedback_id DESC`);
  const [stats] = await db.query(
    `SELECT c.crop_name AS crop, ROUND(AVG(f.rating),1) AS avgRating, COUNT(*) AS responses
       FROM feedback f JOIN recommendations r ON r.rec_id = f.rec_id JOIN crops c ON c.crop_id = r.crop_id GROUP BY c.crop_name`);
  res.json({ feedback: rows, byCrop: stats });
}));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Raitu Raksha running on http://localhost:' + port));
