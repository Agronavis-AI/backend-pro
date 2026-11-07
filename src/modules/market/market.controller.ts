import type { Request, Response } from 'express';
import { ok } from '../../shared/http';
import { catalogueService } from './catalogue.service';
import { marketService } from './market.service';

export const marketController = {
  async searchMandi(req: Request, res: Response) {
    const query = req.query as unknown as {
      state: string;
      district?: string;
      commodity?: string;
      limit: number;
    };
    const result = await marketService.searchMandi(query);
    ok(res, result, { count: result.rows.length });
  },

  async getLivePrices(req: Request, res: Response) {
    const { commodity, state, limit } = req.query as unknown as {
      commodity: string;
      state: string;
      limit: number;
    };
    const data = await marketService.getLivePrices(commodity, state, limit);
    ok(res, data, { count: data.length });
  },

  async getTrend(req: Request, res: Response) {
    const { commodity, state } = req.query as unknown as { commodity: string; state: string };
    const trend = await marketService.getPriceTrend(commodity, state);
    ok(res, trend);
  },

  async getDashboard(req: Request, res: Response) {
    const { state, crops } = req.query as unknown as { state: string; crops: string[] };
    const data = await marketService.getDashboardPrices(state, crops);
    ok(res, data, { count: data.length });
  },
};

export const catalogueController = {
  async listStates(_req: Request, res: Response) {
    const data = await catalogueService.listStates();
    ok(res, data, { count: data.length });
  },

  async listDistricts(req: Request, res: Response) {
    const { stateId } = req.query as unknown as { stateId: number };
    const data = await catalogueService.listDistricts(stateId);
    ok(res, data, { count: data.length });
  },

  async listMarkets(req: Request, res: Response) {
    const { stateId, districtId } = req.query as unknown as { stateId: number; districtId?: number };
    const data = await catalogueService.listMarkets(stateId, districtId);
    ok(res, data, { count: data.length });
  },

  async listCommodities(_req: Request, res: Response) {
    const data = await catalogueService.listCommodities();
    ok(res, data, { count: data.length });
  },
};
