import { logger } from '../config/logger';
import { runDiseaseSeed } from './diseases.job';

/** Manual entry point: `npm run seed:diseases`. */
runDiseaseSeed()
  .then((counts) => {
    logger.info('Disease seed finished', counts);
    process.exit(0);
  })
  .catch((error: Error) => {
    logger.error('Disease seed failed', { error: error.message });
    process.exit(1);
  });
