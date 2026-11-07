// A module, not a script — see the note in rate-limit.test.ts.
export {};

/**
 * The website's public forms.
 *
 * These are the only routes here nobody signs in to reach, which makes them
 * the ones worth pinning: the honeypot has to stay silent, a dropped deletion
 * request is a compliance failure rather than a bug, and an application must
 * never be reported as received when the row was not written.
 */

jest.mock('../../src/config/env', () => ({
  env: {
    NODE_ENV: 'test',
    RATE_LIMIT_WINDOW_MS: 900_000,
    RATE_LIMIT_MAX: 10_000,
    webFormsEnabled: true,
    CONTACT_TO: 'contact@agronavis.in',
    CONTACT_FROM: 'Agronavis <no-reply@agronavis.in>',
    SITE_URL: 'https://www.agronavis.in',
    SEND_AUTOREPLY: false,
  },
}));
jest.mock('../../src/config/supabase', () => ({ db: { from: jest.fn(), storage: { from: jest.fn() } } }));
jest.mock('../../src/config/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Five posts per ten minutes is the real limit and the right one; it just
// means the sixth assertion in this file would be a 429 rather than a bug.
jest.mock('../../src/middleware/rate-limit.middleware', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { publicFormLimiter: pass, readLimiter: pass };
});

const sendSubmission = jest.fn().mockResolvedValue({ ok: true, id: 'mail-1' });
jest.mock('../../src/modules/web/email', () => ({
  sendSubmission: (...args: unknown[]) => sendSubmission(...args),
  canSendMail: () => true,
}));

const service = {
  listOpenings: jest.fn(),
  saveApplication: jest.fn(),
  saveDeletionRequest: jest.fn(),
};
jest.mock('../../src/modules/web/web.service', () => service);

/* eslint-disable @typescript-eslint/no-require-imports */
const express = require('express');
const request = require('supertest');
const { webRoutes } = require('../../src/modules/web/web.routes');
const { errorMiddleware } = require('../../src/middleware/error.middleware');
/* eslint-enable @typescript-eslint/no-require-imports */

const app = express();
app.use(express.json());
app.use('/api', webRoutes);
app.use(errorMiddleware);

const validContact = {
  name: 'Ramesh Kumar',
  email: 'ramesh@example.com',
  message: 'My wheat is showing yellow patches across the north half of the field.',
};

beforeEach(() => {
  jest.clearAllMocks();
  sendSubmission.mockResolvedValue({ ok: true, id: 'mail-1' });
});

describe('the honeypot', () => {
  it('answers a bot with success so it never learns the field is a trap', async () => {
    const res = await request(app)
      .post('/api/contact')
      .send({ ...validContact, company_website: 'https://spam.example' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    // The giveaway would be sending nothing while claiming success loudly.
    expect(sendSubmission).not.toHaveBeenCalled();
  });

  it('lets a real submission through', async () => {
    await request(app).post('/api/contact').send(validContact).expect(200);
    expect(sendSubmission).toHaveBeenCalledTimes(1);
  });
});

describe('validation speaks to the form', () => {
  it('names the field that is wrong', async () => {
    const res = await request(app)
      .post('/api/contact')
      .send({ ...validContact, email: 'not-an-email' })
      .expect(400);

    // The website places each message beside its own input.
    expect(res.body.ok).toBe(false);
    expect(res.body.fields.email).toBeTruthy();
  });

  it('rejects a message too short to act on', async () => {
    const res = await request(app)
      .post('/api/contact')
      .send({ ...validContact, message: 'help' })
      .expect(400);

    expect(res.body.fields.message).toBeTruthy();
  });

  it('tells someone where to write when the mail provider rejects it', async () => {
    sendSubmission.mockResolvedValue({ ok: false, error: 'resend down' });

    const res = await request(app).post('/api/contact').send(validContact).expect(502);

    expect(res.body.error).toContain('contact@agronavis.in');
  });
});

describe('openings', () => {
  it('serves what the database has', async () => {
    service.listOpenings.mockResolvedValue([
      { title: 'Backend Engineer', team: 'Platform', location: 'Remote', commitment: 'Internship', duration: '1 to 2 months', stipend_min: 2500, stipend_max: 4000, summary: null },
    ]);

    const res = await request(app).get('/api/openings').expect(200);

    expect(res.body.source).toBe('database');
    expect(res.body.openings).toHaveLength(1);
  });

  it('falls back to the built-in list rather than failing the careers page', async () => {
    service.listOpenings.mockRejectedValue(new Error('database down'));

    const res = await request(app).get('/api/openings').expect(200);

    // A slightly stale role list beats a page that will not render.
    expect(res.body.source).toBe('fallback');
    expect(res.body.openings.length).toBeGreaterThan(0);
  });
});

describe('account deletion', () => {
  const validDeletion = { email: 'ramesh@example.com', scope: 'account' };

  it('records the request and hands back a reference', async () => {
    service.saveDeletionRequest.mockResolvedValue('req-123');

    const res = await request(app).post('/api/account-deletion').send(validDeletion).expect(200);

    expect(res.body).toEqual({ ok: true, reference: 'req-123' });
  });

  it('refuses rather than losing a request it could not record', async () => {
    service.saveDeletionRequest.mockRejectedValue(new Error('insert failed'));

    const res = await request(app).post('/api/account-deletion').send(validDeletion).expect(502);

    // Silently dropping this is a compliance failure, not a bug.
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('contact@agronavis.in');
  });

  it('still answers the person when only the email fails', async () => {
    service.saveDeletionRequest.mockResolvedValue('req-124');
    sendSubmission.mockResolvedValue({ ok: false, error: 'resend down' });

    const res = await request(app).post('/api/account-deletion').send(validDeletion).expect(200);

    // The row is the record of truth; the notification is not.
    expect(res.body.reference).toBe('req-124');
  });
});

describe('a job application', () => {
  const validApplication = {
    name: 'Asha Devi',
    email: 'asha@example.com',
    role: 'Backend Engineer',
    message: 'I would start by writing tests for the ingest pipeline.',
  };

  it('is accepted without a CV', async () => {
    service.saveApplication.mockResolvedValue({ id: 'app-1', resumeUrl: null });

    await request(app).post('/api/careers').send(validApplication).expect(200);

    expect(service.saveApplication).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Asha Devi', role: 'Backend Engineer' }),
      undefined,
    );
  });

  it("uses the applicant's own wording when they picked Something else", async () => {
    service.saveApplication.mockResolvedValue({ id: 'app-2', resumeUrl: null });

    await request(app)
      .post('/api/careers')
      .send({ ...validApplication, role: 'Something else', role_other: 'Agronomy research' })
      .expect(200);

    expect(service.saveApplication).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'Agronomy research' }),
      undefined,
    );
  });

  it('is never reported as received when the row was not written', async () => {
    service.saveApplication.mockRejectedValue(new Error('insert failed'));

    const res = await request(app).post('/api/careers').send(validApplication).expect(502);

    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('with your CV attached');
  });

  it('rejects a link that is not a link', async () => {
    const res = await request(app)
      .post('/api/careers')
      .send({ ...validApplication, github_url: 'github.com/asha' })
      .expect(400);

    expect(res.body.fields.github_url).toBeTruthy();
  });
});
