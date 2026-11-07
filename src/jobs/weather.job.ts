import { logger } from '../config/logger';
import { advisoryService } from '../modules/advisory/advisory.service';
import { weatherService } from '../modules/weather/weather.service';
import { notificationsService } from '../modules/notifications/notifications.service';
import { loadPollableFarms } from './farm-locations';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Refreshes weather for every mapped farm, stores a snapshot, regenerates
 * advisories and pushes both to connected clients.
 */
export async function runWeatherPoll(): Promise<{ farms: number; calls: number; advisories: number }> {
  const farms = await loadPollableFarms();
  if (farms.length === 0) return { farms: 0, calls: 0, advisories: 0 };

  const clusters = new Map<string, typeof farms>();
  for (const farm of farms) {
    const key = `${farm.latitude.toFixed(2)}:${farm.longitude.toFixed(2)}`;
    const bucket = clusters.get(key);
    if (bucket) bucket.push(farm);
    else clusters.set(key, [farm]);
  }

  let calls = 0;
  let advisoryCount = 0;

  for (const group of clusters.values()) {
    const anchor = group[0]!;
    try {
      const bundle = await weatherService.getBundle(anchor.latitude, anchor.longitude);
      calls += 1;

      for (const farm of group) {
        await weatherService.saveSnapshot(farm.farmId, bundle);

        const created = await advisoryService.generateForFarm(farm.farmerId, farm.farmId, {
          latitude: farm.latitude,
          longitude: farm.longitude,
        });
        advisoryCount += created.length;

        // Every advisory becomes a notification, so it is there to read in the
        // app whichever way it arrived. Whether it also lights up the handset
        // is the service's decision, taken on severity — this loop no longer
        // gates on it, which is what previously meant a medium advisory was
        // never stored and so could not be read anywhere at all.
        for (const advisory of created) {
          await notificationsService.send(farm.farmerId, {
            title: advisory.title,
            body: advisory.body.slice(0, 160),
            type: advisory.category,
            severity: advisory.severity,
            data: { advisoryId: advisory.id, farmId: farm.farmId },
          });
        }
      }
    } catch (error) {
      logger.error('Weather poll failed for a cluster', {
        farmId: anchor.farmId,
        error: (error as Error).message,
      });
    }

    await sleep(250); // stay well inside the free-tier rate limit
  }

  logger.info('Weather poll complete', { farms: farms.length, calls, advisories: advisoryCount });
  return { farms: farms.length, calls, advisories: advisoryCount };
}
