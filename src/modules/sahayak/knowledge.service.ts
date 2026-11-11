import { db } from '../../config/supabase';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { embedQuery } from './providers';
import type { KnowledgePassage } from './prompt';

/**
 * Finds the notes worth showing the model for one question.
 *
 * The knowledge base (supabase/migrations/0029_knowledge_base.sql) holds Kisan
 * Call Centre answers, state crop guides and the disease library, built by
 * ml/knowledge/build_knowledge_base.ipynb. A match is by meaning and by words
 * at once: meaning finds "my paddy leaves have brown dots" for a note about
 * brown spot of rice, words find "Tricyclazole" when that is what was typed.
 *
 * Nothing here may stop Sahayak answering. No base built yet, no embedding
 * key, a slow database: each of those returns fewer notes, never an error.
 */

/** Enough to ground an answer; more costs tokens on a free tier and dilutes it. */
const MATCH_COUNT = 5;

/** Under this many local notes, the search widens to the whole country. */
const ENOUGH_LOCAL = 3;

let missingWarned = false;

type Row = KnowledgePassage & { score: number };

async function match(
  question: string,
  embedding: number[] | null,
  state: string | null,
): Promise<Row[]> {
  // The function is newer than the generated types, so it is called by name.
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Row[] | null; error: { message: string; code?: string } | null }>)(
    'match_knowledge',
    {
      query_text: question,
      query_embedding: embedding ? JSON.stringify(embedding) : null,
      filter_state: state,
      match_count: MATCH_COUNT,
    },
  );

  if (error) {
    // 42883 / PGRST202: the function is not there — the migration has not run.
    if (!missingWarned && /match_knowledge|42883|PGRST202/.test(`${error.code} ${error.message}`)) {
      missingWarned = true;
      logger.warn('Knowledge base not set up; Sahayak is answering without reference notes');
    } else {
      logger.warn('Knowledge search failed', { error: error.message });
    }
    return [];
  }
  return data ?? [];
}

export async function searchKnowledge(question: string, state?: string | null): Promise<KnowledgePassage[]> {
  const embedding = await embedQuery(question, {
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
  });

  const local = state?.trim().toLowerCase() || null;
  const found = await match(question, embedding, local);

  // A farmer in a state the base barely covers still deserves the national notes.
  if (local && found.length < ENOUGH_LOCAL) {
    const wider = await match(question, embedding, null);
    const ids = new Set(found.map((r) => r.id));
    for (const row of wider) {
      if (found.length >= MATCH_COUNT) break;
      if (!ids.has(row.id)) found.push(row);
    }
  }

  return found.map(({ score: _score, ...passage }) => passage);
}
