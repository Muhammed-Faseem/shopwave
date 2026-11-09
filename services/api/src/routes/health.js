const express = require('express');
const { pool } = require('../db');
const { getClient } = require('../redis');
const logger = require('../logger');

const router = express.Router();

router.get('/health', async (req, res) => {
  const checks = {
    database: { status: 'unknown' },
    redis: { status: 'unknown' }
  };

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    checks.database = { status: 'healthy' };
  } catch (err) {
    logger.warn('Health check: database unhealthy', { error: err.message });
    checks.database = { status: 'unhealthy', error: err.message };
  }

  try {
    await getClient().ping();
    checks.redis = { status: 'healthy' };
  } catch (err) {
    logger.warn('Health check: redis unhealthy', { error: err.message });
    checks.redis = { status: 'unhealthy', error: err.message };
  }

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy');
  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || 'unknown'
  });
});

router.get('/live', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

module.exports = router;
