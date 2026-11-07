// A module, not a script — see the note in rate-limit.test.ts.
export {};

/**
 * Greetings, and whether a push that failed is recorded as having worked.
 *
 * Both of these were silent. The welcome hung off `registerPushToken`, so on a
 * build with no FCM credentials — where no token is ever issued — no farmer
 * was ever welcomed and the notifications table stayed empty for everyone.
 * And `send()` read Expo's HTTP 200 as delivery, when Expo answers 200 and
 * puts the real outcome inside the ticket, so the one table that could have
 * shown push was broken instead said it was fine.
 */

const FARMER = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;

type Chain = Record<string, jest.Mock> & {
  __result: { data: unknown; error: unknown };
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};
let chains: Record<string, Chain>;

function makeChain(): Chain {
  const chain = {} as Chain;
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'limit', 'maybeSingle', 'single']) {
    chain[m] = jest.fn(() => chain);
  }
  // Builders are thenables: `update().eq()` is awaited directly, while
  // `select().eq().maybeSingle()` carries on. A mock whose `eq` resolved
  // could only ever serve one of those two.
  chain.__result = { data: null, error: null };
  chain.then = (resolve) => Promise.resolve(chain.__result).then(resolve);
  return chain;
}
const chainFor = (table: string): Chain => (chains[table] ??= makeChain());

jest.mock('axios');
jest.mock('../../src/config/env', () => ({ env: { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' } }));
jest.mock('../../src/config/supabase', () => ({ db: { from: jest.fn((t: string) => chainFor(t)) } }));
jest.mock('../../src/config/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const axios = require('axios');
const { notificationsService } = require('../../src/modules/notifications/notifications.service');
/* eslint-enable @typescript-eslint/no-require-imports */

/** The farmer the greeting reads, and when they were last seen. */
function farmerSeen(lastSeenAt: string | undefined, fullName = 'Ramesh Kumar') {
  chainFor('farmers').maybeSingle.mockResolvedValueOnce({
    data: { full_name: fullName, profile_settings: lastSeenAt ? { lastSeenAt } : {} },
    error: null,
  });
}

/** What `send()` wrote, if it wrote anything. */
function sent(): { title: string; body: string; type: string } | undefined {
  const call = chainFor('notifications').insert.mock.calls[0];
  return call?.[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  chains = {};
  axios.post = jest.fn().mockResolvedValue({ data: { data: { status: 'ok' } } });
});

function allowInsert() {
  chainFor('notifications').maybeSingle.mockResolvedValue({
    data: { id: 'n1', farmer_id: FARMER, title: 't', body: 'b', type: 'welcome', severity: 'low', data: {}, read: false, created_at: new Date().toISOString() },
    error: null,
  });
}

describe('greeting a farmer on the way in', () => {
  it('welcomes someone who has never been seen, by their first name', async () => {
    farmerSeen(undefined);
    allowInsert();

    await notificationsService.greet(FARMER);

    expect(sent()?.title).toBe('Welcome to Agronavis, Ramesh');
    expect(sent()?.type).toBe('welcome');
  });

  it('manages without a name rather than greeting an empty space', async () => {
    farmerSeen(undefined, '');
    allowInsert();

    await notificationsService.greet(FARMER);

    expect(sent()?.title).toBe('Welcome to Agronavis');
  });

  it('says nothing to someone who was here yesterday', async () => {
    farmerSeen(new Date(Date.now() - DAY).toISOString());
    allowInsert();

    await notificationsService.greet(FARMER);

    // A greeting on every launch is not a greeting, it is noise.
    expect(sent()).toBeUndefined();
  });

  it('welcomes back someone returning after an absence, and says how long', async () => {
    farmerSeen(new Date(Date.now() - 9 * DAY).toISOString());
    allowInsert();

    await notificationsService.greet(FARMER);

    expect(sent()?.title).toBe('Welcome back, Ramesh');
    expect(sent()?.body).toContain('9 days');
  });

  it('stamps the visit even when the greeting itself fails', async () => {
    farmerSeen(undefined);
    chainFor('notifications').maybeSingle.mockResolvedValue({ data: null, error: { message: 'down' } });

    await notificationsService.greet(FARMER);

    // Otherwise a farmer is greeted again on every single launch.
    const stamped = chainFor('farmers').update.mock.calls[0]?.[0];
    expect(stamped.profile_settings.lastSeenAt).toBeTruthy();
  });

  it('does nothing for a farmer who is not there', async () => {
    chainFor('farmers').maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(notificationsService.greet(FARMER)).resolves.toBeUndefined();
    expect(sent()).toBeUndefined();
  });
});

describe('what Expo actually said', () => {
  function pushable() {
    chainFor('notifications').maybeSingle.mockResolvedValue({
      data: { id: 'n1', farmer_id: FARMER, title: 't', body: 'b', type: 'general', severity: 'critical', data: {}, read: false, created_at: new Date().toISOString() },
      error: null,
    });
    chainFor('farmers').maybeSingle.mockResolvedValue({
      data: { expo_push_token: 'ExponentPushToken[abc]', profile_settings: {} },
      error: null,
    });
  }

  /** The delivery written back onto the row. */
  const recorded = () =>
    chainFor('notifications').update.mock.calls.at(-1)?.[0] as
      | { delivery: string; delivery_error: string | null }
      | undefined;

  it('records a delivered push as sent', async () => {
    pushable();
    await notificationsService.send(FARMER, { title: 't', body: 'b', severity: 'critical' });

    expect(recorded()?.delivery).toBe('sent');
  });

  it('records a rejected ticket as failed, not sent', async () => {
    pushable();
    axios.post = jest.fn().mockResolvedValue({
      data: { data: { status: 'error', message: 'bad token', details: { error: 'DeviceNotRegistered' } } },
    });

    await notificationsService.send(FARMER, { title: 't', body: 'b', severity: 'critical' });

    expect(recorded()?.delivery).toBe('failed');
    expect(recorded()?.delivery_error).toBe('DeviceNotRegistered');
  });

  it('forgets a token the device no longer has', async () => {
    pushable();
    axios.post = jest.fn().mockResolvedValue({
      data: { data: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
    });

    await notificationsService.send(FARMER, { title: 't', body: 'b', severity: 'critical' });

    // Otherwise every future push to this farmer fails the same way forever.
    expect(chainFor('farmers').update).toHaveBeenCalledWith({ expo_push_token: null });
  });

  it('keeps the token when the rejection is not about the device', async () => {
    pushable();
    axios.post = jest.fn().mockResolvedValue({
      data: { data: { status: 'error', details: { error: 'MessageRateExceeded' } } },
    });

    await notificationsService.send(FARMER, { title: 't', body: 'b', severity: 'critical' });

    expect(chainFor('farmers').update).not.toHaveBeenCalled();
    expect(recorded()?.delivery).toBe('failed');
  });
});

describe('marking alerts read', () => {
  /**
   * `read` is a generated column. Postgres rejects any write to it with
   * "column \"read\" can only be updated to DEFAULT", so marking an alert
   * read answered 500 every time and the unread badge never cleared. The
   * timestamp is the fact; the boolean is the database's shorthand for it.
   */
  it('writes read_at, never read', async () => {
    chainFor('notifications').maybeSingle.mockResolvedValue({
      data: { id: 'n1', farmer_id: FARMER, title: 't', body: 'b', type: 'general', severity: 'low', data: {}, read: true, read_at: new Date().toISOString(), created_at: new Date().toISOString() },
      error: null,
    });

    await notificationsService.markRead(FARMER, 'n1');

    const patch = chainFor('notifications').update.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty('read');
    expect(typeof patch.read_at).toBe('string');
  });

  it('marks all read by timestamp, touching only the unread ones', async () => {
    chainFor('notifications').select.mockResolvedValueOnce({ data: [{ id: 'a' }, { id: 'b' }], error: null });

    const updated = await notificationsService.markAllRead(FARMER);

    const patch = chainFor('notifications').update.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty('read');
    expect(typeof patch.read_at).toBe('string');
    // Re-reading the screen must not keep moving the timestamp on alerts
    // that were read days ago.
    expect(chainFor('notifications').is).toHaveBeenCalledWith('read_at', null);
    expect(updated).toBe(2);
  });
});
