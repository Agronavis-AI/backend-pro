// A module, not a script — see the note in rate-limit.test.ts.
export {};

/**
 * The HTTP surface of reporting and blocking.
 *
 * The service tests prove the queries are right; these prove a farmer's tap
 * can actually reach them, and that the wrong request is turned away with a
 * 400 rather than reaching Postgres, where a malformed uuid comes back as a
 * 500 and reads to the farmer as "the app is broken".
 */

const VIEWER = '11111111-1111-4111-8111-111111111111';
const BULLY = '22222222-2222-4222-8222-222222222222';

jest.mock('../../src/config/env', () => ({
  env: { NODE_ENV: 'test', RATE_LIMIT_WINDOW_MS: 900_000, RATE_LIMIT_MAX: 10_000 },
}));
jest.mock('../../src/config/supabase', () => ({ db: { from: jest.fn() } }));
jest.mock('../../src/config/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Signed in, and past the 2FA gate: this file is about the community routes,
// not about the middleware two other test files already cover.
jest.mock('../../src/middleware/auth.middleware', () => ({
  requireAuth: (req: { farmer?: { id: string } }, _res: unknown, next: () => void) => {
    req.farmer = { id: VIEWER };
    next();
  },
  farmerId: () => VIEWER,
}));
jest.mock('../../src/middleware/two-factor.middleware', () => ({
  requireTwoFactor: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const service = {
  report: jest.fn().mockResolvedValue(undefined),
  block: jest.fn().mockResolvedValue(undefined),
  unblock: jest.fn().mockResolvedValue(undefined),
  listBlocked: jest.fn().mockResolvedValue([]),
};
jest.mock('../../src/modules/community/community.service', () => ({ communityService: service }));

/* eslint-disable @typescript-eslint/no-require-imports */
const express = require('express');
const request = require('supertest');
const { communityRoutes } = require('../../src/modules/community/community.routes');
const { errorMiddleware } = require('../../src/middleware/error.middleware');
/* eslint-enable @typescript-eslint/no-require-imports */

const app = express();
app.use(express.json());
app.use('/community', communityRoutes);
app.use(errorMiddleware);

beforeEach(() => jest.clearAllMocks());

describe('POST /community/:type/:id/report', () => {
  it('reports a post', async () => {
    await request(app)
      .post(`/community/post/${BULLY}/report`)
      .send({ reason: 'abuse' })
      .expect(204);

    expect(service.report).toHaveBeenCalledWith(VIEWER, 'post', BULLY, 'abuse', undefined);
  });

  it('reports a reply, and passes the note along', async () => {
    await request(app)
      .post(`/community/reply/${BULLY}/report`)
      .send({ reason: 'other', note: 'selling fake seed' })
      .expect(204);

    expect(service.report).toHaveBeenCalledWith(VIEWER, 'reply', BULLY, 'other', 'selling fake seed');
  });

  it('turns away a reason that is not on the list', async () => {
    await request(app)
      .post(`/community/post/${BULLY}/report`)
      .send({ reason: 'because i felt like it' })
      .expect(400);

    expect(service.report).not.toHaveBeenCalled();
  });

  it('turns away a missing reason', async () => {
    await request(app).post(`/community/post/${BULLY}/report`).send({}).expect(400);
    expect(service.report).not.toHaveBeenCalled();
  });

  it('turns away a malformed id before it reaches the database', async () => {
    await request(app)
      .post('/community/post/not-a-uuid/report')
      .send({ reason: 'spam' })
      .expect(400);

    expect(service.report).not.toHaveBeenCalled();
  });

  it('does not answer for a target type nobody can report', async () => {
    // The route itself only matches post and reply, so this never reaches a
    // handler — which is the point: there is no third kind of reportable
    // thing to guess at.
    await request(app)
      .post(`/community/farmer/${BULLY}/report`)
      .send({ reason: 'spam' })
      .expect(404);
  });

  it('caps the note, so the queue cannot be flooded with an essay', async () => {
    await request(app)
      .post(`/community/post/${BULLY}/report`)
      .send({ reason: 'spam', note: 'x'.repeat(501) })
      .expect(400);
  });
});

describe('blocking over HTTP', () => {
  it('blocks', async () => {
    await request(app).post(`/community/block/${BULLY}`).expect(204);
    expect(service.block).toHaveBeenCalledWith(VIEWER, BULLY);
  });

  it('unblocks', async () => {
    await request(app).delete(`/community/block/${BULLY}`).expect(204);
    expect(service.unblock).toHaveBeenCalledWith(VIEWER, BULLY);
  });

  it('rejects a block id that is not a farmer id', async () => {
    await request(app).post('/community/block/someone').expect(400);
    expect(service.block).not.toHaveBeenCalled();
  });

  it('lists who is blocked', async () => {
    service.listBlocked.mockResolvedValueOnce([
      { id: BULLY, fullName: 'Ramesh', avatarUrl: null, state: 'Assam', district: 'Jorhat' },
    ]);

    const res = await request(app).get('/community/blocks').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].fullName).toBe('Ramesh');
  });

  it('does not collide with the block list route', async () => {
    // `/blocks` is a GET and `/block/:id` a POST, but a careless router would
    // read "blocks" as an id.
    await request(app).get('/community/blocks').expect(200);
    expect(service.unblock).not.toHaveBeenCalled();
  });
});
