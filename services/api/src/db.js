const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', {
    error: err.message,
    code: err.code
  });
});

async function connect() {
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  logger.info('Database connection pool ready');
}

module.exports = { pool, connect };
