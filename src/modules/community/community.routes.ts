import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireTwoFactor } from '../../middleware/two-factor.middleware';
import { standardLimiter } from '../../middleware/rate-limit.middleware';
import { validate } from '../../middleware/validate.middleware';
import { handler } from '../../shared/http';
import { communityController } from './community.controller';
import {
  createPostSchema,
  idParamSchema,
  listPostsSchema,
  postParamSchema,
  replySchema,
  reportSchema,
  reportTargetSchema,
  voteSchema,
} from './community.schema';

export const communityRoutes = Router();

communityRoutes.use(requireAuth);
communityRoutes.use(standardLimiter);
communityRoutes.use(requireTwoFactor);

communityRoutes.get('/posts', validate(listPostsSchema, 'query'), handler(communityController.listPosts));
communityRoutes.post('/posts', validate(createPostSchema), handler(communityController.createPost));
communityRoutes.delete('/posts/:id', validate(idParamSchema, 'params'), handler(communityController.deletePost));

// Reporting and blocking. Google Play requires both of an app whose users
// can see each other's writing, and a feed nobody can moderate is a feed
// people leave.
communityRoutes.post(
  '/:type(post|reply)/:id/report',
  validate(reportTargetSchema, 'params'),
  validate(reportSchema),
  handler(communityController.report),
);
communityRoutes.get('/blocks', handler(communityController.listBlocked));
communityRoutes.post('/block/:id', validate(idParamSchema, 'params'), handler(communityController.block));
communityRoutes.delete('/block/:id', validate(idParamSchema, 'params'), handler(communityController.unblock));
communityRoutes.post(
  '/posts/:id/vote',
  validate(idParamSchema, 'params'),
  validate(voteSchema),
  handler(communityController.vote),
);

communityRoutes.get(
  '/posts/:postId/replies',
  validate(postParamSchema, 'params'),
  handler(communityController.listReplies),
);
communityRoutes.post(
  '/posts/:postId/replies',
  validate(postParamSchema, 'params'),
  validate(replySchema),
  handler(communityController.addReply),
);
communityRoutes.delete(
  '/replies/:id',
  validate(idParamSchema, 'params'),
  handler(communityController.deleteReply),
);
