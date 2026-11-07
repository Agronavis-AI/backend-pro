import type { Request, Response } from 'express';
import { farmerId } from '../../middleware/auth.middleware';
import { badRequest } from '../../shared/errors';
import { created, noContent, ok } from '../../shared/http';
import { communityService } from './community.service';

export const communityController = {
  async listPosts(req: Request, res: Response) {
    const { limit, offset } = req.query as unknown as { limit: number; offset: number };
    const data = await communityService.listPosts(farmerId(req), limit, offset);
    ok(res, data, { count: data.length, page: Math.floor(offset / limit) + 1, pageSize: limit });
  },

  async createPost(req: Request, res: Response) {
    const id = farmerId(req);
    const post = await communityService.createPost(id, req.body);

    // Neighbours in the same district were notified the moment a question was
    // posted. That went over the realtime server nothing connected to, so the
    // post is simply stored now and seen when the feed is next opened.
    created(res, post);
  },

  async deletePost(req: Request, res: Response) {
    await communityService.deletePost(farmerId(req), req.params.id!);
    noContent(res);
  },

  async vote(req: Request, res: Response) {
    const direction = (req.body as { direction: 'up' | 'down' }).direction;
    const upvotes = await communityService.vote(req.params.id!, direction === 'up' ? 1 : -1);
    ok(res, { upvotes });
  },

  async listReplies(req: Request, res: Response) {
    const data = await communityService.listReplies(farmerId(req), req.params.postId!);
    ok(res, data, { count: data.length });
  },

  async addReply(req: Request, res: Response) {
    created(res, await communityService.addReply(farmerId(req), req.params.postId!, req.body.content));
  },

  async deleteReply(req: Request, res: Response) {
    await communityService.deleteReply(farmerId(req), req.params.id!);
    noContent(res);
  },

  /**
   * Reports a post or a reply.
   *
   * Answers the same whether or not the thing was already reported, so a
   * farmer cannot learn anything about other people's reports by trying.
   */
  async report(req: Request, res: Response) {
    const { type, id } = req.params as { type: string; id: string };
    if (type !== 'post' && type !== 'reply') throw badRequest('Reportable items are posts and replies');

    const { reason, note } = req.body as { reason: string; note?: string };
    await communityService.report(farmerId(req), type, id, reason, note);
    noContent(res);
  },

  async block(req: Request, res: Response) {
    await communityService.block(farmerId(req), (req.params as { id: string }).id);
    noContent(res);
  },

  async listBlocked(req: Request, res: Response) {
    res.json(await communityService.listBlocked(farmerId(req)));
  },

  async unblock(req: Request, res: Response) {
    await communityService.unblock(farmerId(req), (req.params as { id: string }).id);
    noContent(res);
  },
};
