import {
  AssistantUnavailableError,
  bodyFor,
  cleanAnswer,
  complete,
  embedQuery,
  parseTargets,
  readCompletion,
  type ChatMessage,
} from '../../src/modules/sahayak/providers';

const both = { groqApiKey: 'g', cloudflareAccountId: 'acc', cloudflareApiToken: 't' };
const messages: ChatMessage[] = [{ role: 'user', content: 'When should I irrigate boro rice?' }];

const reply = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const answer = (content: string) => ({ choices: [{ message: { content } }] });

describe('parseTargets', () => {
  it('keeps the order and splits on the first colon only', () => {
    expect(parseTargets('groq:openai/gpt-oss-120b, cloudflare:@cf/google/gemma-4-26b-a4b-it', both)).toEqual([
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' },
    ]);
  });

  it('drops a provider that has no key, so a half-configured server still answers', () => {
    expect(parseTargets('groq:a,cloudflare:b', { groqApiKey: 'g' })).toEqual([{ provider: 'groq', model: 'a' }]);
    expect(parseTargets('groq:a,cloudflare:b', { cloudflareAccountId: 'x' })).toEqual([]);
  });

  it('ignores unknown providers and malformed entries', () => {
    expect(parseTargets('openai:gpt-5,groq:,:x,groq', both)).toEqual([]);
  });
});

describe('bodyFor', () => {
  it('keeps GPT-OSS thinking short', () => {
    expect(bodyFor({ provider: 'groq', model: 'openai/gpt-oss-120b' }, messages).reasoning_effort).toBe('low');
    expect(bodyFor({ provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' }, messages))
      .not.toHaveProperty('reasoning_effort');
  });
});

describe('cleanAnswer / readCompletion', () => {
  it('never shows the farmer the model thinking aloud', () => {
    expect(cleanAnswer('<think>They mean AWD.</think>Drain the field for 3 days.')).toBe('Drain the field for 3 days.');
    expect(cleanAnswer('stray reasoning</think> Answer')).toBe('Answer');
  });

  it('treats an empty or malformed reply as no answer', () => {
    expect(readCompletion(answer('   '))).toBeNull();
    expect(readCompletion({})).toBeNull();
    expect(readCompletion(answer('Yes.'))).toBe('Yes.');
  });
});

describe('complete', () => {
  const targets = parseTargets('groq:openai/gpt-oss-120b,cloudflare:@cf/google/gemma-4-26b-a4b-it', both);

  it('answers from the first provider that works', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return reply(200, answer('Irrigate after the water disappears.'));
    };
    const result = await complete(messages, { targets, creds: both, fetchImpl });
    expect(result).toEqual({ text: 'Irrigate after the water disappears.', provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(calls).toHaveLength(1);
  });

  it('moves on when the free quota is spent', async () => {
    const fetchImpl = async (url: string) =>
      url.includes('groq') ? reply(429, { error: 'rate limited' }) : reply(200, answer('From Gemma.'));
    const result = await complete(messages, { targets, creds: both, fetchImpl });
    expect(result.provider).toBe('cloudflare');
    expect(result.text).toBe('From Gemma.');
  });

  it('moves on from a network failure and from an empty answer', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      if (n === 1) throw new Error('socket hang up');
      return reply(200, answer(''));
    };
    await expect(complete(messages, { targets, creds: both, fetchImpl })).rejects.toBeInstanceOf(
      AssistantUnavailableError,
    );
  });

  it('says which providers failed and why', async () => {
    const fetchImpl = async () => reply(404, {});
    try {
      await complete(messages, { targets, creds: both, fetchImpl });
      throw new Error('should not answer');
    } catch (error) {
      expect((error as AssistantUnavailableError).attempts).toEqual([
        'groq:openai/gpt-oss-120b → HTTP 404',
        'cloudflare:@cf/google/gemma-4-26b-a4b-it → HTTP 404',
      ]);
    }
  });

  it('fails cleanly with no providers configured', async () => {
    await expect(complete(messages, { targets: [], creds: {} })).rejects.toBeInstanceOf(AssistantUnavailableError);
  });
});

describe('embedQuery', () => {
  const vector = Array.from({ length: 1024 }, (_, i) => i / 1024);

  it('returns the bge-m3 vector', async () => {
    const fetchImpl = async () => reply(200, { data: [{ embedding: vector }] });
    expect(await embedQuery('ধানের পাতায় দাগ', both, fetchImpl)).toHaveLength(1024);
  });

  it('returns null instead of throwing, so the search can fall back to words', async () => {
    expect(await embedQuery('q', {}, async () => reply(200, {}))).toBeNull();
    expect(await embedQuery('q', both, async () => reply(500, {}))).toBeNull();
    expect(await embedQuery('q', both, async () => reply(200, { data: [{ embedding: [1, 2, 3] }] }))).toBeNull();
    expect(
      await embedQuery('q', both, async () => {
        throw new Error('offline');
      }),
    ).toBeNull();
  });
});
