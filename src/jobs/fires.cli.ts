import { logger } from '../config/logger';
import { runFirePoll } from './fires.job';

/**
 * Manual entry point: `npm run sync:fires`.
 *
 * The poll is on a six-hourly cron, but a sleeping instance fires no cron and
 * the free tier sleeps after fifteen minutes idle. This is how the detections
 * table gets its first rows, and how to fill it on demand afterwards.
 */
runFirePoll()
  .then((counts) => {
    logger.info('Fire poll finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('Fire poll failed', { error: error.message });
    process.exit(1);
  });
