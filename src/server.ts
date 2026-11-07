import http from 'http';
import { createApp } from './app';
import { env, reportOptionalEnv } from './config/env';
import { logger } from './config/logger';
import { db } from './config/supabase';
import { startJobs, stopJobs } from './jobs';

/** Fails fast if the service-role key cannot reach the database. */
async function checkDatabase(): Promise<void> {
  const { error } = await db.from('farmers').select('id', { count: 'exact', head: true }).limit(1);
  if (error) {
    const detail = [error.message, error.code, error.hint].filter(Boolean).join(' · ');
    throw new Error(
      `Supabase rejected the connection${detail ? `: ${detail}` : ''}. ` +
        'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, and that the migrations ' +
        'in supabase/migrations have been applied.',
    );
  }
}

async function bootstrap(): Promise<void> {
  try {
    await checkDatabase();
    logger.info('Supabase connection verified');
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  reportOptionalEnv((message) => logger.warn(message));

  const httpServer = http.createServer(createApp());

  httpServer.listen(env.PORT, () => {
    logger.info(`Agronavis API listening on :${env.PORT} (${env.NODE_ENV})`);
    logger.info(`REST      http://localhost:${env.PORT}/api/${env.API_VERSION}`);
    logger.info(`Health    http://localhost:${env.PORT}/health`);
  });

  startJobs();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);

    stopJobs();
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Do not hang forever on a socket that will not close.
    setTimeout(() => {
      logger.warn('Forcing shutdown after 10s');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', { error: error.stack });
    process.exit(1);
  });
}

void bootstrap();
