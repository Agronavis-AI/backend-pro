import type { ChatMessage } from './providers';

/**
 * Turns a farmer's question, their farm and the notes we found into the
 * messages a model reads.
 *
 * The farm details are written by the app (features/sahayak/farmerContext.ts),
 * so the online and the on-phone Sahayak describe the same farm in the same
 * words. This file adds what only the server has: the knowledge base, and the
 * rules for using it.
 */

export interface KnowledgePassage {
  id: number;
  source: string;
  title: string | null;
  url: string | null;
  state: string | null;
  crop: string | null;
  content: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface PromptInput {
  /** The system prompt the app built from the farmer's own records. */
  farmContext?: string;
  /** Lines the app looked up for this question, e.g. today's mandi rates. */
  facts?: string[];
  passages: KnowledgePassage[];
  history: ChatTurn[];
  question: string;
}

/** Bounds on what one request can put in front of the model. */
export const LIMITS = {
  farmContext: 6_000,
  passage: 900,
  historyTurns: 6,
  historyText: 1_500,
} as const;

const SOURCE_LABEL: Record<string, string> = {
  kcc: 'Kisan Call Centre',
  disease_library: 'Agronavis disease library',
};

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const titleCase = (s: string): string => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "Kisan Call Centre · West Bengal · rice", or the document's own title. */
export function sourceLabel(p: Pick<KnowledgePassage, 'source' | 'title' | 'state' | 'crop'>): string {
  const base = SOURCE_LABEL[p.source] ?? p.title ?? p.source;
  const where = [p.state ? titleCase(p.state) : null, p.crop].filter(Boolean);
  return where.length ? `${base} · ${where.join(' · ')}` : base;
}

const RULES = [
  'Using the reference notes:',
  '- The numbered reference notes below come from the Kisan Call Centre, state crop guides and the Agronavis disease library. Prefer them to your general knowledge when they answer the question.',
  '- When you use a note, cite it with its number in square brackets, like [2]. Cite only notes you used.',
  '- If the notes and the farm details do not cover the question, give general good practice and say it is general advice.',
  '- Name a pesticide, fungicide or dose only if a note states it. Cite that note and tell the farmer to follow the product label. Never make one up.',
  '- Never invent prices, scheme amounts, phone numbers or dates.',
  '- For anything that could harm people, animals or the crop if wrong, suggest confirming with the local Krishi Vigyan Kendra (KVK).',
  '- Keep it under about 150 words unless the farmer asks for more detail.',
];

export function buildMessages(input: PromptInput): ChatMessage[] {
  const system: string[] = [];

  system.push(
    input.farmContext?.trim()
      ? clip(input.farmContext.trim(), LIMITS.farmContext)
      : 'You are Sahayak, an agricultural assistant for Indian smallholder farmers. Answer in simple language.',
  );

  if (input.facts?.length) {
    system.push('', 'Looked up for this question:', ...input.facts.map((f) => `- ${f}`));
  }

  system.push('', ...RULES);

  if (input.passages.length > 0) {
    system.push('', 'Reference notes:');
    input.passages.forEach((p, i) => {
      system.push(`[${i + 1}] (${sourceLabel(p)}) ${clip(p.content.replace(/\s+/g, ' ').trim(), LIMITS.passage)}`);
    });
  } else {
    system.push('', 'No reference notes matched this question.');
  }

  const messages: ChatMessage[] = [{ role: 'system', content: system.join('\n') }];

  for (const turn of input.history.slice(-LIMITS.historyTurns)) {
    const text = turn.text.trim();
    if (!text) continue;
    messages.push({ role: turn.role, content: clip(text, LIMITS.historyText) });
  }

  messages.push({ role: 'user', content: input.question.trim() });
  return messages;
}

export interface CitedSource {
  label: string;
  url: string | null;
}

/**
 * The notes the answer actually cites, in the order it cites them.
 *
 * Listing every note we retrieved would put sources under an answer that never
 * used them, which is worse than no sources: it lends the answer an authority
 * it did not earn.
 */
export function citedSources(passages: KnowledgePassage[], answer: string): CitedSource[] {
  const seen = new Set<number>();
  const cited: CitedSource[] = [];
  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const index = Number(match[1]) - 1;
    const passage = passages[index];
    if (!passage || seen.has(index)) continue;
    seen.add(index);
    cited.push({ label: sourceLabel(passage), url: passage.url });
  }
  return cited;
}
