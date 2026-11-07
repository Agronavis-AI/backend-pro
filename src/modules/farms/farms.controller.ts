import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { created, noContent, ok } from '../../shared/http';
import { farmsService } from './farms.service';

export const farmsController = {
  async listFarms(req: Request, res: Response) {
    const data = await farmsService.listFarms(farmerId(req));
    ok(res, data, { count: data.length });
  },

  async getFarm(req: Request, res: Response) {
    ok(res, await farmsService.getFarm(farmerId(req), req.params.id!));
  },

  async updateFarm(req: Request, res: Response) {
    ok(res, await farmsService.updateFarm(farmerId(req), req.params.id!, req.body));
  },

  async listFields(req: Request, res: Response) {
    const data = await farmsService.listFields(farmerId(req));
    ok(res, data, { count: data.length });
  },

  async getField(req: Request, res: Response) {
    ok(res, await farmsService.getField(farmerId(req), req.params.id!));
  },

  async createField(req: Request, res: Response) {
    created(res, await farmsService.createField(farmerId(req), req.body));
  },

  async renameField(req: Request, res: Response) {
    ok(res, await farmsService.renameField(farmerId(req), req.params.id!, req.body.name));
  },

  async deleteField(req: Request, res: Response) {
    await farmsService.deleteField(farmerId(req), req.params.id!);
    noContent(res);
  },
};
