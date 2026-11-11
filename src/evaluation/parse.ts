/**
 * Answer normalisation shared by the UI, the Node evaluation harness and (mirrored 1:1) the Python
 * tooling in research/egoversa_research/parsing.py. Both implementations are tested against the same
 * vectors in tests/fixtures/parse_cases.json.
 *
 * The parser is deliberately strict: a reply counts only if it names exactly one admissible option.
 * Anything else is `null` ("unparseable") and is scored as wrong, never guessed.
 */

export const UNKNOWN = 'unknown';

/** Phrases a model may use to abstain; all map to the canonical label "unknown". */
const UNKNOWN_PATTERNS = [
  /\bunknown\b/,
  /\bcan(?:not|'t|’t| not) (?:be )?(?:tell|determined?|say|see|know)\b/,
  /\bnot (?:enough|sufficient) information\b/,
  /\bimpossible to (?:tell|say|determine|know)\b/,
  /\bunclear\b/,
  /\bnot visible\b/,
];

/** Extra surface forms per canonical label. */
const SYNONYMS: Record<string, RegExp[]> = {
  front: [/\bin front\b/, /\bfront\b/],
  behind: [/\bbehind\b/, /\bback\b/],
  toward: [/\btowards?\b/],
  away: [/\baway\b/],
  first: [/\bfirst\b/, /\bimage 1\b/, /\b1st\b/],
  second: [/\bsecond\b/, /\bimage 2\b/, /\b2nd\b/],
  closer: [/\bcloser\b/, /\bnearer\b/],
  farther: [/\bfarther\b/, /\bfurther\b/],
};

/** Remove reasoning blocks and markup some chat templates emit around the final answer. */
export function stripReasoning(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\|[^|>]*\|>/g, ' ')
    .trim();
}

export function normalizeAnswer(raw: string, options: readonly string[]): string | null {
  const text = stripReasoning(raw).toLowerCase();
  if (!text) return null;
  const hits = new Set<string>();
  for (const opt of options) {
    if (opt === UNKNOWN) {
      if (UNKNOWN_PATTERNS.some((re) => re.test(text))) hits.add(opt);
      continue;
    }
    // A negated option ("not visible") is not a vote for that option.
    const res = SYNONYMS[opt] ?? [new RegExp(`(?<!not )\\b${opt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)];
    if (res.some((re) => re.test(text))) hits.add(opt);
  }
  // An explicit abstention overrides option words that merely restate the question
  // ("I cannot tell whether it is left or right").
  if (hits.has(UNKNOWN)) return UNKNOWN;
  return hits.size === 1 ? [...hits][0] : null;
}
