import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { runCatalogueSync } from './catalogue.job';
import { runFertiliserCropSync } from './fertiliser.job';
import { runMandiMirrorSync } from './mandi.job';
import { runFirePoll } from './fires.job';
import { runNdviSync } from './ndvi.job';
import { runMarketPoll } from './market.job';
import { runSoilSync } from './soil.job';
import { runWeatherPoll } from './weather.job';

const tasks: ScheduledTask[] = [];

/**
 * Guards against overlap: a poll that runs long must not have a second copy
 * started on top of it, which would double the upstream API spend.
 */
function guarded(name: string, job: () => Promise<unknown>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      logger.warn(`${name} is still running — skipping this tick`);
      return;
    }
    running = true;
    try {
      await job();
    } catch (error) {
      logger.error(`${name} threw`, { error: (error as Error).message });
    } finally {
      running = false;
    }
  };
}

export function startJobs(): void {
  if (!env.ENABLE_JOBS || env.isTest) {
    logger.info('Background jobs disabled (ENABLE_JOBS=false)');
    return;
  }

  tasks.push(cron.schedule(env.WEATHER_POLL_CRON, guarded('Weather poll', runWeatherPoll)));
  tasks.push(cron.schedule(env.MARKET_POLL_CRON, guarded('Market poll', runMarketPoll)));
  tasks.push(cron.schedule(env.CATALOGUE_SYNC_CRON, guarded('Catalogue sync', runCatalogueSync)));
  tasks.push(cron.schedule(env.SOIL_SYNC_CRON, guarded('Soil sync', () => runSoilSync())));
  tasks.push(cron.schedule(env.FERTILISER_SYNC_CRON, guarded('Fertiliser crops', runFertiliserCropSync)));
  tasks.push(cron.schedule(env.MANDI_MIRROR_CRON, guarded('Mandi mirror', runMandiMirrorSync)));
  tasks.push(cron.schedule(env.FIRE_POLL_CRON, guarded('Fire poll', runFirePoll)));
  tasks.push(cron.schedule(env.NDVI_SYNC_CRON, guarded('NDVI sync', runNdviSync)));

  logger.info('Background jobs scheduled', {
    weather: env.WEATHER_POLL_CRON,
    market: env.MARKET_POLL_CRON,
    catalogue: env.CATALOGUE_SYNC_CRON,
    soil: env.SOIL_SYNC_CRON,
    fertiliser: env.FERTILISER_SYNC_CRON,
    mandiMirror: env.MANDI_MIRROR_CRON,
    firePoll: env.FIRE_POLL_CRON,
  });
}

export function stopJobs(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}

export {
  runCatalogueSync,
  runFertiliserCropSync,
  runMandiMirrorSync,
  runMarketPoll,
  runSoilSync,
  runWeatherPoll,
};
