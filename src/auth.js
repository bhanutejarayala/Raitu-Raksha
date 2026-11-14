const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev_secret';

const sign = u => jwt.sign({ id: u.user_id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });

function needLogin(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Please log in again' });
  }
}

const needAgronomist = (req, res, next) =>
  req.user.role === 'agronomist' ? next() : res.status(403).json({ error: 'Agronomist access only' });

module.exports = { sign, needLogin, needAgronomist };
