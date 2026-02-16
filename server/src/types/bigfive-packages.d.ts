// Type declarations for BigFive personality assessment packages

declare module '@alheimsins/bigfive-calculate-score' {
  interface FacetScore {
    score: number;
    count: number;
    result: 'high' | 'neutral' | 'low';
  }

  interface DomainScore {
    score: number;
    count: number;
    result: 'high' | 'neutral' | 'low';
    facet: Record<string, FacetScore>;
  }

  interface CalculateScoreInput {
    answers: Array<{
      domain: string;
      facet?: string;
      score: number | string;
    }>;
    calculateResult?: (score: number, count: number) => string;
  }

  function calculateScore(data: CalculateScoreInput): Record<string, DomainScore>;
  export = calculateScore;
}
