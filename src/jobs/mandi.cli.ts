import { logger } from '../config/logger';
import { runMandiMirrorSync } from './mandi.job';

/** Manual entry point: `npm run sync:mandi`. */
runMandiMirrorSync()
  .then((counts) => {
    logger.info('Mandi mirror sync finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('Mandi mirror sync failed', { error: error.message });
    process.exit(1);
  });
