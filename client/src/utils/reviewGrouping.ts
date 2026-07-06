export type InsightOrigin = 'import' | 'session' | 'mixed';

/** The minimal shape the grouping helper needs (a structural subset of the page's Insight). */
export interface GroupableInsight {
  id: string;
  topicId: string | null;
  topicTitle: string | null;
  sourceSessionId: string | null;
  content: string;
}

export interface InsightGroup {
  key: string;
  name: string;
  origin: InsightOrigin;
  count: number;
  insightIds: string[];
  preview: string[];
}

export const NO_TOPIC_KEY = '__none__';
export const PREVIEW_LIMIT = 3;
export const PREVIEW_CHARS = 90;

export function groupKeyOf(insight: GroupableInsight): string {
  return insight.topicId ?? NO_TOPIC_KEY;
}

export function truncatePreview(content: string, max = PREVIEW_CHARS): string {
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

export function groupPendingInsights(insights: GroupableInsight[]): InsightGroup[] {
  const groups = new Map<string, InsightGroup>();

  for (const insight of insights) {
    const key = groupKeyOf(insight);
    const origin: InsightOrigin = insight.sourceSessionId ? 'session' : 'import';
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        name: insight.topicTitle?.trim() || 'No topic',
        origin,
        count: 1,
        insightIds: [insight.id],
        preview: [truncatePreview(insight.content)],
      });
      continue;
    }

    existing.insightIds.push(insight.id);
    existing.count = existing.insightIds.length;
    if (existing.preview.length < PREVIEW_LIMIT) {
      existing.preview.push(truncatePreview(insight.content));
    }
    if (existing.origin !== origin) {
      existing.origin = 'mixed';
    }
  }

  return Array.from(groups.values());
}
