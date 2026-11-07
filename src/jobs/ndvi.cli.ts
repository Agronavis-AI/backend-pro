import { logger } from '../config/logger';
import { runNdviSync } from './ndvi.job';

/**
 * Manual entry point: `npm run sync:ndvi`.
 *
 * Same reason as sync:fires — a sleeping instance fires no cron, and this is
 * how the first readings get measured.
 */
runNdviSync()
  .then((counts) => {
    logger.info('NDVI sync finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('NDVI sync failed', { error: error.message });
    process.exit(1);
  });
