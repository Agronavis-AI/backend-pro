import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter, upstreamLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { catalogueController, marketController } from './market.controller';
import {
  dashboardSchema,
  districtListSchema,
  livePricesSchema,
  mandiSearchSchema,
  marketListSchema,
  trendSchema,
} from './market.schema';

export const marketRoutes = Router();

marketRoutes.use(requireAuth);
marketRoutes.use(standardLimiter);
marketRoutes.use(requireTwoFactor);
// Reaches NASA, OpenWeatherMap or Agmarknet. Their quotas and their patience
// are finite, and a retry storm here gets our key throttled for everyone.
marketRoutes.use(upstreamLimiter);

marketRoutes.get('/mandi', validate(mandiSearchSchema, 'query'), handler(marketController.searchMandi));
marketRoutes.get('/prices', validate(livePricesSchema, 'query'), handler(marketController.getLivePrices));
marketRoutes.get('/trend', validate(trendSchema, 'query'), handler(marketController.getTrend));
marketRoutes.get('/dashboard', validate(dashboardSchema, 'query'), handler(marketController.getDashboard));

// Catalogue — Agmarknet reference data, mirrored nightly and served as small
// lists so the filter UI can fill one dropdown at a time.
marketRoutes.get('/catalogue/states', handler(catalogueController.listStates));
marketRoutes.get('/catalogue/districts', validate(districtListSchema, 'query'), handler(catalogueController.listDistricts));
marketRoutes.get('/catalogue/markets', validate(marketListSchema, 'query'), handler(catalogueController.listMarkets));
marketRoutes.get('/catalogue/commodities', handler(catalogueController.listCommodities));
