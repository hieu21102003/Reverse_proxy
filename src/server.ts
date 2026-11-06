import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'Shutting down');
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Failed to close server cleanly');
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
