const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { Pool } = require('pg');
const redis = require('redis');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'shopwave-worker' },
  transports: [new winston.transports.Console()]
});

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const ses = new SESClient({ region: process.env.AWS_REGION });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

let redisClient;

async function connectRedis() {
  redisClient = redis.createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', err => logger.error('Redis error', { error: err.message }));
  await redisClient.connect();
}

async function sendConfirmationEmail(order) {
  await ses.send(new SendEmailCommand({
    Source: process.env.FROM_EMAIL,
    Destination: { ToAddresses: [order.userEmail] },
    Message: {
      Subject: { Data: `Order Confirmed — ShopWave #${order.orderId.slice(0, 8)}` },
      Body: {
        Text: {
          Data: `
Your order has been confirmed!

Order ID: ${order.orderId}
Total: ₹${order.totalAmount.toFixed(2)}

Items:
${order.items.map(i => `  - ${i.productName} x${i.quantity} — ₹${i.lineTotal.toFixed(2)}`).join('\n')}

Thank you for shopping with ShopWave!
          `.trim()
        }
      }
    }
  }));
}

async function processOrder(orderData) {
  const { orderId, userId, userEmail, items, totalAmount } = orderData;

  logger.info('Processing order', { orderId, userId, itemCount: items.length });

  try {
    await sendConfirmationEmail({ orderId, userEmail, items, totalAmount });
    logger.info('Confirmation email sent', { orderId, userEmail });
  } catch (err) {
    logger.error('Failed to send confirmation email', { orderId, error: err.message });
  }

  await pool.query(
    `UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
    [orderId]
  );

  await redisClient.del(`user-orders:${userId}`);

  logger.info('Order processing complete', { orderId, status: 'confirmed' });
}

async function pollQueue() {
  logger.info('Worker started - polling SQS queue');

  while (true) {
    try {
      const response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: process.env.SQS_ORDER_QUEUE_URL,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 90,
        AttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All']
      }));

      const messages = response.Messages || [];

      for (const message of messages) {
        const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || '1');

        try {
          const orderData = JSON.parse(message.Body);
          await processOrder(orderData);

          await sqs.send(new DeleteMessageCommand({
            QueueUrl: process.env.SQS_ORDER_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle
          }));

          logger.info('Message processed and deleted', { messageId: message.MessageId });
        } catch (err) {
          logger.error('Failed to process message', {
            messageId: message.MessageId,
            receiveCount,
            error: err.message
          });

          if (receiveCount >= 3) {
            logger.warn('Message approaching DLQ threshold', {
              messageId: message.MessageId,
              receiveCount
            });
          }
        }
      }
    } catch (err) {
      logger.error('Queue polling error', { error: err.message });
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function start() {
  try {
    await connectRedis();
    await pollQueue();
  } catch (err) {
    logger.error('Worker failed to start', { error: err.message });
    process.exit(1);
  }
}

start();
