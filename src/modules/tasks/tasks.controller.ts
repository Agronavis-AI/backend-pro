import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { created, ok } from '../../shared/http';
import { tasksService } from './tasks.service';

export const tasksController = {
  async list(req: Request, res: Response) {
    const { farmId, limit } = req.query as unknown as { farmId?: string; limit: number };
    const data = await tasksService.listOpen(farmerId(req), farmId, limit);
    ok(res, data, { count: data.length });
  },

  async create(req: Request, res: Response) {
    created(res, await tasksService.create(farmerId(req), req.body));
  },

  async complete(req: Request, res: Response) {
    ok(res, await tasksService.complete(farmerId(req), req.params.id!));
  },

  async skip(req: Request, res: Response) {
    ok(res, await tasksService.skip(farmerId(req), req.params.id!));
  },
};
