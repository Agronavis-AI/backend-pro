import { logger } from '../config/logger';
import { runSoilSync } from './soil.job';

/**
 * Manual entry point: `npm run sync:soil [cycle]`. Used for the first
 * nationwide population and by CI, since the in-process cron only fires while
 * the service is awake.
 */
const cycle = process.argv[2];

runSoilSync(cycle)
  .then((counts) => {
    logger.info('Soil sync finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('Soil sync failed', { error: error.message });
    process.exit(1);
  });
