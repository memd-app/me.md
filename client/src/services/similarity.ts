export const JW_WEIGHT = 0.5
export const TOKEN_WEIGHT = 0.5

export const DUPLICATE_THRESHOLD = 0.92
export const NEAR_DUP_THRESHOLD = 0.80

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'been', 'they', 'will', 'would', 'could',
  'should', 'what', 'when', 'where', 'which', 'their', 'about', 'more', 'some',
  'very', 'just', 'also', 'than', 'them', 'into', 'most', 'only', 'your', 'like',
  'then', 'make', 'over', 'such', 'much', 'know', 'think', 'really', 'things',
  'because', 'something', 'i', 'a', 'an', 'the', 'to', 'of', 'in', 'at', 'my',
  'me', 'is', 'it', 'and', 'or', 'but', 'for', 'on', 'as', 'be', 'am', 'are',
  'was', 'were', 'by', 'we', 'you', 'he', 'she', 'his', 'her', 'our', 'us',
])

/** Jaro-Winkler char similarity, 0..1. Ported verbatim from me.md-kg dedup.ts. */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix bonus
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Lowercase, strip punctuation to spaces, collapse whitespace, drop stopwords. Self-contained. */
export function normalizeInsight(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(token => token.length > 0 && !STOPWORDS.has(token))
    .join(' ')
}

/** Jaccard over the unique content-word sets of a and b, 0..1. Empty sets => 0. */
export function tokenSetRatio(a: string, b: string): number {
  const aTokens = new Set(normalizeInsight(a).split(' ').filter(Boolean))
  const bTokens = new Set(normalizeInsight(b).split(' ').filter(Boolean))
  if (aTokens.size === 0 || bTokens.size === 0) return 0

  let intersection = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1
  }

  return intersection / new Set([...aTokens, ...bTokens]).size
}

/** Combined normalized score used by the gate. Identical-after-normalize => 1.0. */
export function combinedScore(a: string, b: string): number {
  const na = normalizeInsight(a)
  const nb = normalizeInsight(b)
  if (na === nb) return 1

  // Known limitation: Jaro-Winkler is a char metric; deep paraphrases score low.
  // This gate is for re-import/re-distill/re-assessment duplicates, not semantic dedup.
  return JW_WEIGHT * jaroWinkler(na, nb) + TOKEN_WEIGHT * tokenSetRatio(a, b)
}
