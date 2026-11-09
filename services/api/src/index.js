const app = require('./app');
const { connect: connectDb } = require('./db');
const { connect: connectRedis } = require('./redis');
const { migrate } = require('./migrate');
const logger = require('./logger');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    logger.info('Starting ShopWave API...');

    await connectDb();
    await connectRedis();
    await migrate();

    const server = app.listen(PORT, () => {
      logger.info(`API server listening on port ${PORT}`, {
        port: PORT,
        nodeEnv: process.env.NODE_ENV,
        version: process.env.APP_VERSION
      });
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received - beginning graceful shutdown');
      server.close(() => {
        logger.info('HTTP server closed - all requests complete');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Graceful shutdown timeout - forcing exit');
        process.exit(1);
      }, 25000);
    });

  } catch (err) {
    logger.error('Failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

start();
