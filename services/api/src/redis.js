const redis = require('redis');
const logger = require('./logger');

let client;

async function connect() {
  client = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error('Redis: max reconnection attempts reached');
          return new Error('Too many retries');
        }
        return Math.min(retries * 100, 3000);
      }
    }
  });

  client.on('error', (err) =>
    logger.error('Redis client error', { error: err.message })
  );
  client.on('reconnecting', () => logger.warn('Redis: reconnecting...'));
  client.on('ready', () => logger.info('Redis connection ready'));

  await client.connect();
}

function getClient() {
  if (!client || !client.isReady) {
    throw new Error('Redis client not ready');
  }
  return client;
}

module.exports = { connect, getClient };
