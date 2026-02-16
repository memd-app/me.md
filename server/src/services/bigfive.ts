// ============================================
// Big Five Personality Assessment Service
// ============================================
// Wraps the BigFive open-source npm packages to provide:
// - Question retrieval (120 items, grouped by domain)
// - Score calculation from user answers
// - Descriptive result text for each domain/facet
//
// Packages used:
//   @bigfive-org/questions - 120-item IPIP NEO-PI-R questionnaire
//   @alheimsins/bigfive-calculate-score - score aggregation
//   @bigfive-org/results - localized result text descriptions

// Import CJS packages - tsx handles CJS/ESM interop
// @bigfive-org/questions exports: getItems, getInfo, getChoices, getQuestions
// @alheimsins/bigfive-calculate-score exports: default function
// @bigfive-org/results exports: default function + getTemplate, getInfo, getDomain, getFacet
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const questionsLib = require('@bigfive-org/questions') as {
  getItems: (lang?: string) => any[];
  getInfo: () => any;
  getChoices: (lang?: string) => any;
  getQuestions: (lang?: string) => any[];
};

const calculateScoreFn = require('@alheimsins/bigfive-calculate-score') as (data: {
  answers: Array<{ domain: string; facet?: string; score: number | string }>;
  calculateResult?: (score: number, count: number) => string;
}) => Record<string, any>;

const resultsLib = require('@bigfive-org/results') as {
  (data: { lang: string; scores: any }): any[];
  getTemplate: (lang?: string) => any;
  getInfo: () => { languages: Array<{ id: string; text: string }> };
  getDomain: (options: { language: string; domain: string }) => any;
  getFacet: (options: { language: string; domain: string; facet: string }) => any;
};

// ============================================
// Types
// ============================================

/** A single Big Five question item */
export interface BigFiveQuestion {
  id: string;
  text: string;
  keyed: 'plus' | 'minus';
  domain: string;
  facet: number;
  num: number;
  choices: BigFiveChoice[];
}

/** A choice option for a question */
export interface BigFiveChoice {
  color: number;
  score: number;
  text: string;
}

/** A user's answer to a single question */
export interface BigFiveAnswer {
  domain: string;
  facet: string;
  score: number;
}

/** Facet-level score */
export interface FacetScore {
  score: number;
  count: number;
  result: 'high' | 'neutral' | 'low';
}

/** Domain-level score */
export interface DomainScore {
  score: number;
  count: number;
  result: 'high' | 'neutral' | 'low';
  facet: Record<string, FacetScore>;
}

/** Complete calculated scores keyed by domain */
export type BigFiveScores = Record<string, DomainScore>;

/** Facet result with descriptive text */
export interface FacetResult {
  facet: number;
  title: string;
  text: string;
  score: number;
  count: number;
  scoreText: string;
}

/** Domain result with descriptive text */
export interface DomainResult {
  domain: string;
  title: string;
  shortDescription: string;
  description: string;
  scoreText: string;
  count: number;
  score: number;
  facets: FacetResult[];
  text: string;
}

/** Questions grouped by Big Five domain */
export interface QuestionsByDomain {
  [domain: string]: {
    domain: string;
    label: string;
    questions: BigFiveQuestion[];
  };
}

// ============================================
// Domain labels
// ============================================

const DOMAIN_LABELS: Record<string, string> = {
  N: 'Neuroticism',
  E: 'Extraversion',
  O: 'Openness to Experience',
  A: 'Agreeableness',
  C: 'Conscientiousness',
};

// ============================================
// Service Functions
// ============================================

/**
 * Get all 120 Big Five questions grouped by domain.
 *
 * @param language - ISO 639-1 language code (default: 'en')
 * @returns Questions organized by domain (N, E, O, A, C)
 */
export function getQuestions(language: string = 'en'): QuestionsByDomain {
  const items: BigFiveQuestion[] = questionsLib.getItems(language);

  // Group questions by domain
  const grouped: QuestionsByDomain = {};

  for (const item of items) {
    if (!grouped[item.domain]) {
      grouped[item.domain] = {
        domain: item.domain,
        label: DOMAIN_LABELS[item.domain] || item.domain,
        questions: [],
      };
    }
    grouped[item.domain].questions.push(item);
  }

  return grouped;
}

/**
 * Get all 120 questions as a flat array (not grouped).
 *
 * @param language - ISO 639-1 language code (default: 'en')
 * @returns Array of all questions in order
 */
export function getQuestionsList(language: string = 'en'): BigFiveQuestion[] {
  return questionsLib.getItems(language);
}

/**
 * Get test metadata (name, number of questions, available languages, etc.)
 */
export function getTestInfo(): {
  name: string;
  id: string;
  shortId: string;
  time: number;
  questions: number;
  note: string;
  languages: Array<{ id: string; text: string }>;
} {
  return questionsLib.getInfo();
}

/**
 * Calculate Big Five domain and facet scores from user answers.
 *
 * Each answer must have:
 *   - domain: one of 'N', 'E', 'O', 'A', 'C'
 *   - facet: facet number as string (e.g., '1', '2', ..., '6')
 *   - score: numeric score (1-5)
 *
 * @param answers - Array of answer objects
 * @returns Calculated scores per domain and facet
 */
export function calculateScore(answers: BigFiveAnswer[]): BigFiveScores {
  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    throw new Error('Answers must be a non-empty array');
  }

  // Validate answer format
  for (const answer of answers) {
    if (!answer.domain || !answer.score) {
      throw new Error('Each answer must have domain and score properties');
    }
    if (typeof answer.score !== 'number' || answer.score < 1 || answer.score > 5) {
      throw new Error(`Invalid score value: ${answer.score}. Must be between 1 and 5.`);
    }
  }

  const result = calculateScoreFn({
    answers: answers.map((a) => ({
      domain: a.domain,
      facet: a.facet,
      score: a.score,
    })),
  });

  return result as BigFiveScores;
}

/**
 * Get descriptive result text for calculated scores.
 *
 * Takes calculated scores (from calculateScore) and returns
 * human-readable descriptions of each domain and facet result.
 *
 * @param scores - Calculated scores from calculateScore()
 * @param language - ISO 639-1 language code (default: 'en')
 * @returns Array of domain results with descriptions
 */
export function getResultText(
  scores: BigFiveScores,
  language: string = 'en'
): DomainResult[] {
  if (!scores || typeof scores !== 'object') {
    throw new Error('Scores must be a valid scores object from calculateScore()');
  }

  const results = resultsLib({
    lang: language,
    scores,
  });

  return results as DomainResult[];
}

/**
 * Get the result template for a specific language.
 * Useful for custom result rendering.
 *
 * @param language - ISO 639-1 language code (default: 'en')
 */
export function getTemplate(language: string = 'en') {
  return resultsLib.getTemplate(language);
}

/**
 * Get available languages for result text.
 */
export function getAvailableLanguages(): Array<{ id: string; text: string }> {
  const info = resultsLib.getInfo();
  return info.languages || [];
}

/**
 * Convenience function: calculate scores and get result text in one call.
 *
 * @param answers - Array of answer objects
 * @param language - ISO 639-1 language code (default: 'en')
 * @returns Object with raw scores and descriptive results
 */
export function processTest(
  answers: BigFiveAnswer[],
  language: string = 'en'
): {
  scores: BigFiveScores;
  results: DomainResult[];
} {
  const scores = calculateScore(answers);
  const results = getResultText(scores, language);
  return { scores, results };
}

// Default export as a service object for convenience
const bigFiveService = {
  getQuestions,
  getQuestionsList,
  getTestInfo,
  calculateScore,
  getResultText,
  getTemplate,
  getAvailableLanguages,
  processTest,
};

export default bigFiveService;
