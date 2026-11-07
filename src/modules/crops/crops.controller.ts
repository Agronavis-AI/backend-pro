import type { Request, Response } from 'express';
import type { CropStatus } from '@agronavis/shared-types';
import { farmerId } from '../../middleware/auth.middleware';
import { badRequest } from '../../shared/errors';
import { created, noContent, ok } from '../../shared/http';
import { diagnose } from './diagnose.service';
import { cropsService } from './crops.service';

export const cropsController = {
  async list(req: Request, res: Response) {
    const data = await cropsService.list(
      farmerId(req),
      req.query as { fieldId?: string; status?: CropStatus },
    );
    ok(res, data, { count: data.length });
  },

  async create(req: Request, res: Response) {
    created(res, await cropsService.create(farmerId(req), req.body));
  },

  async update(req: Request, res: Response) {
    ok(res, await cropsService.update(farmerId(req), req.params.id!, req.body));
  },

  async remove(req: Request, res: Response) {
    await cropsService.remove(farmerId(req), req.params.id!);
    noContent(res);
  },

  async listScans(req: Request, res: Response) {
    const data = await cropsService.listScans(farmerId(req));
    ok(res, data, { count: data.length });
  },

  async recordScan(req: Request, res: Response) {
    created(res, await cropsService.recordScan(farmerId(req), req.body));
  },


  async listDiseases(req: Request, res: Response) {
    const data = await cropsService.listDiseases(req.query as { cropType?: string; search?: string });
    ok(res, data, { count: data.length });
  },

  async getDiseaseReference(req: Request, res: Response) {
    ok(res, await cropsService.getDiseaseReference(req.params.classKey!));
  },

  async listEligible(req: Request, res: Response) {
    const { fieldId } = req.query as unknown as { fieldId: string };
    const data = await cropsService.listEligible(farmerId(req), fieldId);
    ok(res, data, { count: data.length });
  },

  async diagnoseScan(req: Request, res: Response) {
    if (!req.file) throw badRequest('No image uploaded — send it as multipart field "image"');
    ok(res, await diagnose(req.file.buffer));
  },
};
