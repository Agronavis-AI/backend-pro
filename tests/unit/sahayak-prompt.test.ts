import { buildMessages, citedSources, LIMITS, sourceLabel, type KnowledgePassage } from '../../src/modules/sahayak/prompt';

const note = (over: Partial<KnowledgePassage> = {}): KnowledgePassage => ({
  id: 1,
  source: 'kcc',
  title: null,
  url: null,
  state: 'west bengal',
  crop: 'rice',
  content: 'Q: Brown spots on paddy leaves. A: Brown spot; spray as recommended and apply potash.',
  ...over,
});

describe('buildMessages', () => {
  it("puts the farm, the rules and numbered notes in the system message, the question last", () => {
    const messages = buildMessages({
      farmContext: 'You are Sahayak.\nThis farm:\n- Location: Bardhaman',
      passages: [note(), note({ id: 2, source: 'pop', title: 'Boro rice package of practices', state: null })],
      history: [],
      question: 'What should I do about brown spots?',
    });
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Location: Bardhaman');
    expect(messages[0]!.content).toContain('[1] (Kisan Call Centre · West Bengal · rice)');
    expect(messages[0]!.content).toContain('[2] (Boro rice package of practices · rice)');
    expect(messages[0]!.content).toContain('Never make one up');
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'What should I do about brown spots?' });
  });

  it('says plainly when nothing matched, so the model does not pretend to cite', () => {
    const [system] = buildMessages({ passages: [], history: [], question: 'Hi' });
    expect(system!.content).toContain('No reference notes matched');
    expect(system!.content).toContain('You are Sahayak');
  });

  it('keeps only recent turns and clips long ones', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `turn ${i} ${'x'.repeat(i === 9 ? 5_000 : 1)}`,
    }));
    const messages = buildMessages({ passages: [], history, question: 'q' });
    // system + 6 turns + question
    expect(messages).toHaveLength(1 + LIMITS.historyTurns + 1);
    expect(messages[1]!.content.startsWith('turn 4')).toBe(true);
    expect(messages[LIMITS.historyTurns]!.content.length).toBeLessThanOrEqual(LIMITS.historyText);
  });

  it('bounds an oversized farm context', () => {
    const [system] = buildMessages({ farmContext: 'y'.repeat(50_000), passages: [], history: [], question: 'q' });
    expect(system!.content.length).toBeLessThan(LIMITS.farmContext + 3_000);
  });

  it('includes looked-up facts such as mandi rates', () => {
    const [system] = buildMessages({ facts: ['Paddy at Burdwan: ₹2,300/q'], passages: [], history: [], question: 'q' });
    expect(system!.content).toContain('- Paddy at Burdwan: ₹2,300/q');
  });
});

describe('citedSources', () => {
  const notes = [note({ url: 'https://example.org/a' }), note({ id: 2, source: 'disease_library', state: null })];

  it('lists only what the answer cited, once, in citation order', () => {
    expect(citedSources(notes, 'Apply potash [2]. It is brown spot [1][2].')).toEqual([
      { label: 'Agronavis disease library · rice', url: null },
      { label: 'Kisan Call Centre · West Bengal · rice', url: 'https://example.org/a' },
    ]);
  });

  it('ignores numbers that are not notes', () => {
    expect(citedSources(notes, 'Use 2 kg [7] and wait [0].')).toEqual([]);
  });
});

describe('sourceLabel', () => {
  it('falls back to the title for documents', () => {
    expect(sourceLabel({ source: 'pop', title: 'Potato guide', state: null, crop: null })).toBe('Potato guide');
  });
});
