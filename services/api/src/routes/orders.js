const express = require('express');
const { randomUUID } = require('crypto');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();
const sqs = new SQSClient({ region: process.env.AWS_REGION });

router.post('/', authenticate, async (req, res) => {
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const result = await client.query(
        'SELECT id, name, price, stock_count FROM products WHERE id = $1 AND active = true FOR UPDATE',
        [item.productId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Product ${item.productId} not found`);
      }

      const product = result.rows[0];

      if (product.stock_count < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}: ${product.stock_count} available`);
      }

      await client.query(
        'UPDATE products SET stock_count = stock_count - $1 WHERE id = $2',
        [item.quantity, item.productId]
      );

      const lineTotal = parseFloat(product.price) * item.quantity;
      totalAmount += lineTotal;

      orderItems.push({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        lineTotal
      });
    }

    const orderId = randomUUID();

    await client.query(
      `INSERT INTO orders (id, user_id, status, total_amount, created_at)
       VALUES ($1, $2, 'pending', $3, NOW())`,
      [orderId, req.user.userId, totalAmount]
    );

    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, item.productId, item.quantity, item.unitPrice, item.lineTotal]
      );
    }

    await client.query('COMMIT');

    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.SQS_ORDER_QUEUE_URL,
      MessageBody: JSON.stringify({
        orderId,
        userId: req.user.userId,
        userEmail: req.user.email,
        items: orderItems,
        totalAmount,
        createdAt: new Date().toISOString()
      }),
      MessageGroupId: req.user.userId,
      MessageDeduplicationId: orderId
    }));

    logger.info('Order created and queued', {
      orderId,
      userId: req.user.userId,
      totalAmount,
      itemCount: items.length
    });

    res.status(201).json({
      orderId,
      status: 'pending',
      totalAmount,
      items: orderItems,
      message: 'Order placed successfully. You will receive a confirmation email shortly.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Order creation failed', { error: err.message, userId: req.user.userId });

    if (err.message.includes('Insufficient stock') || err.message.includes('not found')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Order creation failed' });
  } finally {
    client.release();
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              json_agg(json_build_object(
                'productId', oi.product_id,
                'quantity', oi.quantity,
                'unitPrice', oi.unit_price,
                'lineTotal', oi.line_total
              )) as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.user.userId]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    logger.error('Failed to fetch orders', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

module.exports = router;
