/**
 * Where Sahayak's answers come from when the phone is online.
 *
 * Every model here is open-weight and every provider has a free tier, and both
 * providers speak the OpenAI chat format, so one request shape serves all of
 * them. They are tried in order: when one is out of free quota (429), slow,
 * down or has retired the model, the next one answers instead. A farmer should
 * never see "the AI is busy" because one company's daily limit ran out.
 *
 * The order comes from SAHAYAK_MODELS, so a model can be swapped without a
 * release — Groq retired its free Llama models in August 2026 and the list
 * will keep moving.
 *
 * This file has no imports from the rest of the API on purpose: the failover
 * rules are the part worth testing, and they can be tested without a server.
 */

export type ProviderName = 'groq' | 'cloudflare';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderTarget {
  provider: ProviderName;
  model: string;
}

export interface ProviderCredentials {
  groqApiKey?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
}

/**
 * GPT-OSS is OpenAI's open-weight model (Apache 2.0); Gemma 4 is Google's.
 * Groq first because it is fast enough that a farmer on a slow link waits on
 * the network, not on the model. Cloudflare last because its free allowance is
 * the smallest, a few hundred answers a day.
 */
export const DEFAULT_TARGETS =
  'groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,cloudflare:@cf/google/gemma-4-26b-a4b-it';

/** bge-m3: open (MIT), multilingual — a Bengali question finds an English answer. */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const EMBEDDING_DIMENSIONS = 1024;

const KNOWN: readonly ProviderName[] = ['groq', 'cloudflare'];

function hasCredentials(provider: ProviderName, creds: ProviderCredentials): boolean {
  if (provider === 'groq') return Boolean(creds.groqApiKey);
  return Boolean(creds.cloudflareAccountId && creds.cloudflareApiToken);
}

/**
 * Reads "groq:openai/gpt-oss-120b,cloudflare:@cf/google/gemma-4-26b-a4b-it".
 *
 * Splits on the first colon only, because model ids carry slashes and could
 * one day carry a colon. A provider with no key is dropped rather than tried,
 * so a half-configured server still answers from the half that works.
 */
export function parseTargets(spec: string, creds: ProviderCredentials): ProviderTarget[] {
  return spec
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon <= 0) return null;
      const provider = part.slice(0, colon).trim().toLowerCase() as ProviderName;
      const model = part.slice(colon + 1).trim();
      if (!KNOWN.includes(provider) || !model) return null;
      return { provider, model };
    })
    .filter((t): t is ProviderTarget => t !== null && hasCredentials(t.provider, creds));
}

export function endpointFor(
  target: ProviderTarget,
  creds: ProviderCredentials,
): { url: string; headers: Record<string, string> } {
  if (target.provider === 'groq') {
    return {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { Authorization: `Bearer ${creds.groqApiKey}`, 'Content-Type': 'application/json' },
    };
  }
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${creds.cloudflareAccountId}/ai/v1/chat/completions`,
    headers: { Authorization: `Bearer ${creds.cloudflareApiToken}`, 'Content-Type': 'application/json' },
  };
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export function bodyFor(
  target: ProviderTarget,
  messages: ChatMessage[],
  opts: CompletionOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: target.model,
    messages,
    max_tokens: opts.maxTokens ?? 900,
    // Low: an adviser should say the same thing twice, not improvise.
    temperature: opts.temperature ?? 0.3,
  };
  // GPT-OSS thinks before it answers. "low" keeps that short: the farmer is
  // waiting on a phone, and these questions do not need a long chain of thought.
  if (/gpt-oss/i.test(target.model)) body.reasoning_effort = 'low';
  return body;
}

/**
 * The words meant for the farmer, without any thinking the model wrote down.
 *
 * Reasoning models usually return their thoughts in a separate field, but not
 * every provider does, and a farmer reading "<think>The user is asking…" has
 * been shown the workings instead of the answer.
 */
export function cleanAnswer(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

/** Pulls the answer out of an OpenAI-shaped response, or null if there is none. */
export function readCompletion(payload: unknown): string | null {
  const choice = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') return null;
  const cleaned = cleanAnswer(content);
  return cleaned.length > 0 ? cleaned : null;
}

export class AssistantUnavailableError extends Error {
  constructor(readonly attempts: string[]) {
    super(attempts.length ? `No model answered: ${attempts.join('; ')}` : 'No model is configured');
    this.name = 'AssistantUnavailableError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CompleteOptions extends CompletionOptions {
  targets: ProviderTarget[];
  creds: ProviderCredentials;
  fetchImpl?: FetchLike;
  /** Per provider. Long enough for a slow free tier, short enough to fail over. */
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  provider: ProviderName;
  model: string;
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks each target in turn until one answers.
 *
 * Any failure moves on: a 429 is a spent free quota, a 404 or 400 is usually a
 * model the provider has retired, a 401 is a bad key for that one provider,
 * and a timeout is a slow day. None of those is a reason for the farmer to get
 * nothing while another provider is free.
 */
export async function complete(
  messages: ChatMessage[],
  opts: CompleteOptions,
): Promise<CompletionResult> {
  const fetchImpl = opts.fetchImpl ?? (fetch as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const attempts: string[] = [];

  for (const target of opts.targets) {
    const label = `${target.provider}:${target.model}`;
    try {
      const { url, headers } = endpointFor(target, opts.creds);
      const response = await postJson(fetchImpl, url, headers, bodyFor(target, messages, opts), timeoutMs);
      if (!response.ok) {
        attempts.push(`${label} → HTTP ${response.status}`);
        continue;
      }
      const text = readCompletion(await response.json());
      if (!text) {
        attempts.push(`${label} → empty answer`);
        continue;
      }
      return { text, provider: target.provider, model: target.model };
    } catch (error) {
      const name = (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message;
      attempts.push(`${label} → ${name}`);
    }
  }

  throw new AssistantUnavailableError(attempts);
}

/**
 * The question as a vector, for finding notes that mean the same thing.
 *
 * Returns null rather than throwing: without it the knowledge search falls back
 * to matching words, which is weaker but still an answer.
 */
export async function embedQuery(
  text: string,
  creds: ProviderCredentials,
  fetchImpl: FetchLike = fetch as FetchLike,
  timeoutMs = 8_000,
): Promise<number[] | null> {
  if (!creds.cloudflareAccountId || !creds.cloudflareApiToken) return null;
  try {
    const response = await postJson(
      fetchImpl,
      `https://api.cloudflare.com/client/v4/accounts/${creds.cloudflareAccountId}/ai/v1/embeddings`,
      { Authorization: `Bearer ${creds.cloudflareApiToken}`, 'Content-Type': 'application/json' },
      { model: EMBEDDING_MODEL, input: [text] },
      timeoutMs,
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { embedding?: unknown }[] };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
    return vector.every((v) => typeof v === 'number') ? (vector as number[]) : null;
  } catch {
    return null;
  }
}
