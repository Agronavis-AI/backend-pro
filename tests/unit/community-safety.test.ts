/**
 * Reporting and blocking on the community feed.
 *
 * The thing that matters here is where the filtering happens. If a block only
 * hid posts in the app, the blocked farmer's words would still be in the
 * payload on the phone — that is concealment, not blocking, and anyone who
 * looked at the network traffic would still have them. So these tests assert
 * the *query* excludes the author, on the feed and on every reply thread, and
 * that a block cannot be lost quietly: a block list that fails to load must
 * not silently widen into "nothing is blocked" without saying so.
 */

const VIEWER = '11111111-1111-4111-8111-111111111111';
const BULLY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

type Chain = Record<string, jest.Mock> & {
  /** What awaiting the builder itself yields. */
  __result: { data: unknown; error: unknown };
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

/** A fresh Supabase query chain. Every builder method records and returns itself. */
function makeChain(): Chain {
  const chain = {} as Chain;
  for (const method of [
    'select', 'insert', 'upsert', 'delete', 'eq', 'in', 'not', 'or',
    'order', 'range', 'limit', 'maybeSingle', 'single',
  ]) {
    chain[method] = jest.fn(() => chain);
  }

  // PostgREST builders are thenables, and the service relies on it: it adds
  // the block filter *after* `order` and then awaits the builder. A mock that
  // only resolved at the terminal method would never exercise that.
  chain.__result = { data: [], error: null };
  chain.then = (resolve) => Promise.resolve(chain.__result).then(resolve);
  return chain;
}

/** Chains handed out per table, so a test can assert on the one it cares about. */
let chains: Record<string, Chain>;

function chainFor(table: string): Chain {
  chains[table] ??= makeChain();
  return chains[table];
}

jest.mock('../../src/config/env', () => ({
  env: { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' },
}));
jest.mock('../../src/config/supabase', () => ({
  db: { from: jest.fn((table: string) => chainFor(table)) },
}));
jest.mock('../../src/config/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { communityService } = require('../../src/modules/community/community.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { logger } = require('../../src/config/logger');

/**
 * What the block lookup finds. Rows carry both sides, because the lookup asks
 * for blocks in either direction.
 */
function blocksReturn(
  rows: { blocker_id: string; blocked_id: string }[],
  error: unknown = null,
) {
  chainFor('community_blocks').or.mockResolvedValueOnce({ data: rows, error });
}

/** The common case: the viewer did the blocking. */
function viewerBlocked(...ids: string[]) {
  blocksReturn(ids.map((blocked_id) => ({ blocker_id: VIEWER, blocked_id })));
}

beforeEach(() => {
  jest.clearAllMocks();
  chains = {};
});

describe('who gets hidden', () => {
  it('hides the farmers this one has blocked', async () => {
    viewerBlocked(BULLY, OTHER);

    expect(await communityService.hiddenAuthors(VIEWER)).toEqual([BULLY, OTHER]);
    expect(chainFor('community_blocks').or).toHaveBeenCalledWith(
      `blocker_id.eq.${VIEWER},blocked_id.eq.${VIEWER}`,
    );
  });

  it('hides a farmer who blocked this one, so a block works both ways', async () => {
    // Someone blocked by their harasser must not still be readable by them:
    // a one-way block leaves the half that matters least to the person who
    // asked for it.
    blocksReturn([{ blocker_id: BULLY, blocked_id: VIEWER }]);

    expect(await communityService.hiddenAuthors(VIEWER)).toEqual([BULLY]);
  });

  it('names a farmer once when the block went both ways', async () => {
    blocksReturn([
      { blocker_id: VIEWER, blocked_id: BULLY },
      { blocker_id: BULLY, blocked_id: VIEWER },
    ]);

    // A repeated id would be a repeated term in the `in ()` list. Harmless,
    // but it grows the query with every mutual block.
    expect(await communityService.hiddenAuthors(VIEWER)).toEqual([BULLY]);
  });

  it('says so loudly when it cannot be read, rather than failing the whole feed', async () => {
    blocksReturn([], { message: 'connection reset' });

    expect(await communityService.hiddenAuthors(VIEWER)).toEqual([]);
    // Degrading silently is how a block quietly stops working. It must warn.
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not read the block list',
      expect.objectContaining({ viewerId: VIEWER }),
    );
  });
});

describe('the feed excludes blocked farmers in the query', () => {
  it('filters the posts query, not the response', async () => {
    viewerBlocked(BULLY, OTHER);
    const posts = chainFor('community_posts');
    posts.range.mockResolvedValueOnce({ data: [], error: null });

    await communityService.listPosts(VIEWER);

    expect(posts.not).toHaveBeenCalledWith('author_id', 'in', `(${BULLY},${OTHER})`);
  });

  it('leaves the query alone when nobody is blocked', async () => {
    blocksReturn([]);
    const posts = chainFor('community_posts');
    posts.range.mockResolvedValueOnce({ data: [], error: null });

    await communityService.listPosts(VIEWER);

    // An empty `in ()` list is a syntax error in Postgres, so this is not
    // merely tidier — passing one through would break the whole feed.
    expect(posts.not).not.toHaveBeenCalled();
  });

  it('filters replies too, so a blocked farmer cannot answer underneath', async () => {
    viewerBlocked(BULLY);
    const replies = chainFor('community_replies');
    replies.__result = { data: [], error: null };

    await communityService.listReplies(VIEWER, 'post-1');

    expect(replies.not).toHaveBeenCalledWith('author_id', 'in', `(${BULLY})`);
  });
});

describe('reporting', () => {
  it('records who wrote the thing, so the report survives a deletion', async () => {
    chainFor('community_posts').maybeSingle.mockResolvedValueOnce({
      data: { author_id: BULLY }, error: null,
    });
    const reports = chainFor('content_reports');
    reports.upsert.mockResolvedValueOnce({ error: null });

    await communityService.report(VIEWER, 'post', 'post-1', 'abuse', 'threatened me');

    expect(reports.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reporter_id: VIEWER,
        target_type: 'post',
        target_id: 'post-1',
        author_id: BULLY,
        reason: 'abuse',
        note: 'threatened me',
      }),
      // Reporting twice is not twice as serious; without this the unique
      // constraint turns an honest second tap into an error.
      { onConflict: 'reporter_id,target_type,target_id' },
    );
  });

  it('stores no note when none was written', async () => {
    chainFor('community_replies').maybeSingle.mockResolvedValueOnce({
      data: { author_id: BULLY }, error: null,
    });
    const reports = chainFor('content_reports');
    reports.upsert.mockResolvedValueOnce({ error: null });

    await communityService.report(VIEWER, 'reply', 'reply-1', 'spam');

    expect(reports.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ target_type: 'reply', note: null }),
      expect.anything(),
    );
  });

  it('refuses to report something that is already gone', async () => {
    chainFor('community_posts').maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(communityService.report(VIEWER, 'post', 'ghost', 'spam'))
      .rejects.toThrow(/no longer here/i);
    expect(chains['content_reports']).toBeUndefined();
  });

  it('reads replies from the replies table, not the posts table', async () => {
    chainFor('community_replies').maybeSingle.mockResolvedValueOnce({
      data: { author_id: OTHER }, error: null,
    });
    chainFor('content_reports').upsert.mockResolvedValueOnce({ error: null });

    await communityService.report(VIEWER, 'reply', 'reply-9', 'off_topic');

    expect(chainFor('community_replies').eq).toHaveBeenCalledWith('id', 'reply-9');
  });
});

describe('blocking and unblocking', () => {
  it('stores the block', async () => {
    const blocks = chainFor('community_blocks');
    blocks.upsert.mockResolvedValueOnce({ error: null });

    await communityService.block(VIEWER, BULLY);

    expect(blocks.upsert).toHaveBeenCalledWith(
      { blocker_id: VIEWER, blocked_id: BULLY },
      { onConflict: 'blocker_id,blocked_id' },
    );
  });

  it('is idempotent, so a double tap is not an error', async () => {
    const blocks = chainFor('community_blocks');
    blocks.upsert.mockResolvedValue({ error: null });

    await communityService.block(VIEWER, BULLY);
    await communityService.block(VIEWER, BULLY);

    expect(blocks.upsert).toHaveBeenCalledTimes(2);
  });

  it('refuses a self-block before it reaches the database', async () => {
    await expect(communityService.block(VIEWER, VIEWER)).rejects.toThrow(/yourself/i);
    expect(chains['community_blocks']).toBeUndefined();
  });

  it('lifts only this farmer\'s own block', async () => {
    const blocks = chainFor('community_blocks');
    blocks.eq.mockReturnValue(blocks);
    blocks.eq.mockResolvedValueOnce({ error: null });
    // The second `eq` resolves the chain; the first returns it.
    blocks.eq
      .mockReset()
      .mockReturnValueOnce(blocks)
      .mockResolvedValueOnce({ error: null });

    await communityService.unblock(VIEWER, BULLY);

    expect(blocks.delete).toHaveBeenCalled();
    expect(blocks.eq).toHaveBeenNthCalledWith(1, 'blocker_id', VIEWER);
    expect(blocks.eq).toHaveBeenNthCalledWith(2, 'blocked_id', BULLY);
  });
});

describe('the list a farmer can lift a block from', () => {
  it('returns the blocked farmers, newest first', async () => {
    const blocks = chainFor('community_blocks');
    blocks.order.mockResolvedValueOnce({
      data: [
        { blocked: { id: BULLY, full_name: 'Ramesh', avatar_url: null, state: 'Assam', district: 'Jorhat' } },
      ],
      error: null,
    });

    const list = await communityService.listBlocked(VIEWER);

    expect(list).toEqual([
      { id: BULLY, fullName: 'Ramesh', avatarUrl: null, state: 'Assam', district: 'Jorhat' },
    ]);
    expect(blocks.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('drops a row whose farmer has since deleted their account', async () => {
    const blocks = chainFor('community_blocks');
    blocks.order.mockResolvedValueOnce({ data: [{ blocked: null }], error: null });

    expect(await communityService.listBlocked(VIEWER)).toEqual([]);
  });
});
