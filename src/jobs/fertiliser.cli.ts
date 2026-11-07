import { logger } from '../config/logger';
import { runFertiliserCropSync } from './fertiliser.job';

/** Manual entry point: `npm run sync:fertiliser`. */
runFertiliserCropSync()
  .then((counts) => {
    logger.info('Fertiliser crop sync finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('Fertiliser crop sync failed', { error: error.message });
    process.exit(1);
  });
