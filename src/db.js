require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'raitu',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'raitu',
  waitForConnections: true,
  connectionLimit: 8
});

module.exports = pool;
