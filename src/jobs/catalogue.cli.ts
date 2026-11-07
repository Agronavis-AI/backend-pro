import { logger } from '../config/logger';
import { runCatalogueSync } from './catalogue.job';

/**
 * Manual entry point: `npm run sync:catalogue`. Used for the first population
 * and by CI, since the in-process cron only fires while the service is awake.
 */
runCatalogueSync()
  .then((counts) => {
    logger.info('Catalogue sync finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('Catalogue sync failed', { error: error.message });
    process.exit(1);
  });
