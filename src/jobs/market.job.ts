import { logger } from '../config/logger';
import { marketService } from '../modules/market/market.service';
import { loadPollableFarms } from './farm-locations';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Refreshes mandi prices for the crops farmers actually grow, one query per
 * state/commodity pair rather than per farm, and caches the result in
 * `market_prices`.
 */
export async function runMarketPoll(): Promise<{ pairs: number; updated: number }> {
  const farms = await loadPollableFarms();

  const byState = new Map<string, Set<string>>();
  for (const farm of farms) {
    if (!farm.state) continue;
    const crops = byState.get(farm.state) ?? new Set<string>();
    for (const crop of farm.primaryCrops) crops.add(crop);
    byState.set(farm.state, crops);
  }

  let pairs = 0;
  let updated = 0;

  for (const [state, crops] of byState) {
    // Cap per state so one large state cannot exhaust the upstream quota.
    for (const commodity of Array.from(crops).slice(0, 6)) {
      pairs += 1;
      try {
        const trend = await marketService.getPriceTrend(commodity, state);
        if (!trend) continue;

        const [sample] = await marketService.getLivePrices(commodity, state, 1);
        await marketService.persist(state, trend, sample);
        updated += 1;

      } catch (error) {
        logger.warn('Market poll failed', { commodity, state, error: (error as Error).message });
      }
      await sleep(600);
    }
  }

  logger.info('Market poll complete', { pairs, updated });
  return { pairs, updated };
}
