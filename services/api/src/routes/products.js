const express = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('../db');
const { getClient } = require('../redis');
const { authenticate, requireAdmin } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

const PRODUCT_CACHE_TTL = 300;

router.get('/', async (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const cacheKey = `products:${category || 'all'}:${search || ''}:${page}:${limit}`;

  try {
    const cached = await getClient().get(cacheKey);
    if (cached) {
      logger.debug('Products served from cache', { cacheKey });
      return res.json(JSON.parse(cached));
    }

    let query = `
      SELECT p.id, p.name, p.description, p.price, p.stock_count,
             p.image_url, p.category, p.created_at
      FROM products p
      WHERE p.active = true
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND p.category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    query += ` ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    const response = { products: result.rows, page: parseInt(page), count: result.rows.length };

    await getClient().setEx(cacheKey, PRODUCT_CACHE_TTL, JSON.stringify(response));

    res.json(response);
  } catch (err) {
    logger.error('Failed to fetch products', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const cached = await getClient().get(`product:${id}`);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND active = true',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = result.rows[0];
    await getClient().setEx(`product:${id}`, PRODUCT_CACHE_TTL, JSON.stringify(product));
    res.json(product);
  } catch (err) {
    logger.error('Failed to fetch product', { error: err.message, productId: id });
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, description, price, stockCount, category, imageUrl } = req.body;

  if (!name || !price || !category) {
    return res.status(400).json({ error: 'name, price, and category are required' });
  }

  try {
    const id = randomUUID();
    const result = await pool.query(
      `INSERT INTO products (id, name, description, price, stock_count, category, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, name, description, price, stockCount || 0, category, imageUrl]
    );

    const keys = await getClient().keys('products:*');
    if (keys.length > 0) await getClient().del(keys);

    logger.info('Product created', { productId: id, adminId: req.user.userId });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Failed to create product', { error: err.message });
    res.status(500).json({ error: 'Failed to create product' });
  }
});

module.exports = router;
