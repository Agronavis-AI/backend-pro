import type { SahayakChatRequest, SahayakChatResponse } from '@agronavis/shared-types';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../shared/errors';
import { searchKnowledge } from './knowledge.service';
import { buildMessages, citedSources } from './prompt';
import {
  AssistantUnavailableError,
  complete,
  parseTargets,
  type ProviderCredentials,
} from './providers';

const credentials = (): ProviderCredentials => ({
  groqApiKey: env.GROQ_API_KEY,
  cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
  cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
});

/** Whether any model is configured at all. */
export function assistantConfigured(): boolean {
  return parseTargets(env.SAHAYAK_MODELS, credentials()).length > 0;
}

/**
 * The phone could not be answered here; it should fall back to its own model
 * or keep the question for later. 503 says "try elsewhere", not "you did
 * something wrong".
 */
const unavailable = () =>
  new AppError(503, 'Sahayak cannot answer online right now.', 'ASSISTANT_UNAVAILABLE');

export async function answerQuestion(input: SahayakChatRequest): Promise<SahayakChatResponse> {
  const creds = credentials();
  const targets = parseTargets(env.SAHAYAK_MODELS, creds);
  if (targets.length === 0) throw unavailable();

  const started = Date.now();
  const passages = await searchKnowledge(input.question, input.state);
  const messages = buildMessages({
    farmContext: input.context,
    facts: input.facts,
    passages,
    history: input.history ?? [],
    question: input.question,
  });

  try {
    const result = await complete(messages, { targets, creds });
    // What answered and how fast — never what was asked. The question is the
    // farmer's; the log is ours.
    logger.info('Sahayak answered', {
      model: `${result.provider}:${result.model}`,
      notes: passages.length,
      ms: Date.now() - started,
    });
    return {
      answer: result.text,
      sources: citedSources(passages, result.text),
      model: `${result.provider}:${result.model}`,
    };
  } catch (error) {
    if (error instanceof AssistantUnavailableError) {
      logger.warn('No model answered', { attempts: error.attempts });
      throw unavailable();
    }
    throw error;
  }
}
