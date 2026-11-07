// A module, not a script. These files reach the runtime through require()
// rather than import, so without this TypeScript treats them as global
// scripts and their top-level consts collide across files — `chain` is
// declared in three of them. Jest never noticed; the CI typecheck did.
export {};

/**
 * Two-factor used to exist only in the app: the screen appeared after sign-in
 * and the API answered perfectly well to a session that never saw it. These
 * assert the gate, including the ways it must *not* lock someone out.
 */
jest.mock('../../src/config/env', () => ({ env: {} }));

const chain = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(),
  upsert: jest.fn().mockResolvedValue({ error: null }),
};
jest.mock('../../src/config/supabase', () => ({ db: { from: jest.fn(() => chain) } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require('../../src/middleware/two-factor.middleware');

const run = async (user: unknown) => {
  const next = jest.fn();
  await gate.requireTwoFactor({ user } as never, {} as never, next);
  return next;
};

const farmer = (over: Record<string, unknown> = {}) => ({
  id: `f-${Math.random()}`, amr: [], sessionId: 's-1', ...over,
});

const enabled = (on: boolean) => chain.maybeSingle.mockResolvedValue({
  data: { two_factor_enabled: on }, error: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
});

describe('the gate', () => {
  it('lets a farmer without two-factor straight through', async () => {
    enabled(false);
    const next = await run(farmer());
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses a session that has not verified', async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { two_factor_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const next = await run(farmer());
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('lets a verified session through', async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { two_factor_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { verified_at: new Date().toISOString() }, error: null });

    const next = await run(farmer());
    expect(next).toHaveBeenCalledWith();
  });

  it('expires an old verification rather than trusting it for ever', async () => {
    const ancient = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
    chain.maybeSingle
      .mockResolvedValueOnce({ data: { two_factor_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { verified_at: ancient }, error: null });

    const next = await run(farmer());
    expect(next.mock.calls[0][0].code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('accepts a session Supabase itself elevated', async () => {
    enabled(true);
    // Signed in through Supabase MFA: already a verified second factor.
    const next = await run(farmer({ amr: ['password', 'mfa'] }));
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses a token carrying no session at all', async () => {
    enabled(true);
    const next = await run(farmer({ sessionId: null }));
    expect(next.mock.calls[0][0].code).toBe('TWO_FACTOR_REQUIRED');
  });

  // ── The ways it must not lock people out ──────────────────────────────
  it('lets the request through when the database cannot be read', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { message: 'down' } });

    // Failing closed here would lock every farmer out of an app they are
    // already signed into, over a fault that has nothing to do with them.
    const next = await run(farmer());
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores an unauthenticated request and leaves that to requireAuth', async () => {
    const next = await run(undefined);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('recording a verification', () => {
  it('writes the session against the farmer', async () => {
    await gate.markSessionVerified('s-9', 'farmer-9');
    const row = chain.upsert.mock.calls[0][0];
    expect(row).toMatchObject({ session_id: 's-9', farmer_id: 'farmer-9' });
  });

  it('does nothing for a token with no session', async () => {
    await gate.markSessionVerified(null, 'farmer-9');
    expect(chain.upsert).not.toHaveBeenCalled();
  });
});
