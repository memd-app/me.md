import { and, eq, or } from 'drizzle-orm'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { insights } from '@/db/schema'
import { callAnthropic, isApiKeyConfigured } from './anthropic'
import {
  KIND_TO_CATEGORY,
  MIN_SELF_RELEVANCE,
  PERSONHOOD_KIND_LINES,
  SELF_RELEVANCE_CALIBRATION_LINES,
  selfReferenceGate,
} from './insightExtraction'
import { rejectInsight } from './insights'
import { extractJson } from './textCleaning'
import { enqueueVaultWrite } from './vaultWriteThrough'

type Db = any

export interface QueueReevaluateOptions {
  onProgress(done: number, total: number): void
  isCancelled(): boolean
}

export interface QueueReevaluateResult {
  evaluated: number
  filtered: number
  kept: number
  usedAi: boolean
}

interface PendingInsight {
  id: string
  content: string
}

type Decision = 'keep' | 'filter'

const AI_BATCH_SIZE = 40
const REJECT_CHUNK_SIZE = 20
const REJECTION_REASON = 'auto-filtered: personhood re-evaluation'

const allowedKinds = Object.keys(KIND_TO_CATEGORY)

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function fetchPendingInsights(db: Db): PendingInsight[] {
  return db.select({
    id: insights.id,
    content: insights.content,
  }).from(insights)
    .where(
      and(
        eq(insights.userId, LOCAL_USER_ID),
        or(
          eq(insights.verificationStatus, 'unverified'),
          eq(insights.verificationStatus, 're_verification_pending'),
        ),
      ),
    )
    .all()
}

function buildSystemPrompt(): string {
  return `You re-evaluate existing pending me.md insights against the personhood filter.
An insight must be durable self-knowledge about who this person is, not a system, project,
tool, event, or logistics fact.

Allowed kinds:
${PERSONHOOD_KIND_LINES.join('\n')}

self_relevance calibration:
${SELF_RELEVANCE_CALIBRATION_LINES.join('\n')}

Return only a JSON array of objects: [{"index":number,"kind":string,"self_relevance":number}].
Use the 1-based index from the numbered list. Do not include prose.`
}

function buildUserPrompt(batch: PendingInsight[]): string {
  return `<task>
For each numbered candidate insight, decide whether it passes the personhood filter.
Valid kinds are: ${allowedKinds.map(kind => `"${kind}"`).join(', ')}.
Items with self_relevance below ${MIN_SELF_RELEVANCE} will be moved to Rejected.
If a candidate is about systems, automations, events, repos, pipelines, or tools rather than
the person, score it below ${MIN_SELF_RELEVANCE}.
</task>

<candidates>
${batch.map((item, index) => `${index + 1}. ${item.content.replace(/\s+/g, ' ').trim()}`).join('\n')}
</candidates>`
}

function isValidKind(kind: unknown): kind is keyof typeof KIND_TO_CATEGORY {
  return typeof kind === 'string' && kind in KIND_TO_CATEGORY
}

function parseAiDecisions(responseText: string, batchSize: number): Map<number, Decision> {
  let parsed: unknown
  try {
    parsed = extractJson<unknown>(responseText)
  } catch {
    return new Map()
  }

  if (!Array.isArray(parsed)) return new Map()

  const decisions = new Map<number, Decision>()
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const obj = item as Record<string, unknown>
    const index = obj.index
    const kind = obj.kind
    const relevance = obj.self_relevance

    if (
      typeof index !== 'number'
      || !Number.isInteger(index)
      || index < 1
      || index > batchSize
      || !isValidKind(kind)
      || typeof relevance !== 'number'
      || !Number.isFinite(relevance)
    ) {
      continue
    }

    decisions.set(index - 1, relevance >= MIN_SELF_RELEVANCE ? 'keep' : 'filter')
  }

  return decisions
}

async function evaluateWithAi(
  pending: PendingInsight[],
  opts: QueueReevaluateOptions,
  state: QueueReevaluateResult & { done: number },
): Promise<PendingInsight[]> {
  const toFilter: PendingInsight[] = []

  for (const batch of chunk(pending, AI_BATCH_SIZE)) {
    if (opts.isCancelled()) break

    let decisions: Map<number, Decision>
    try {
      const responseText = await callAnthropic({
        messages: [{ role: 'user', content: buildUserPrompt(batch) }],
        system: buildSystemPrompt(),
        maxTokens: 2048,
      })
      decisions = parseAiDecisions(responseText, batch.length)
    } catch (error) {
      console.warn('[me.md:queue-reevaluate] AI batch could not be evaluated', error)
      state.done += batch.length
      opts.onProgress(state.done, pending.length)
      await tick()
      continue
    }

    for (let i = 0; i < batch.length; i += 1) {
      const decision = decisions.get(i) ?? 'keep'
      if (decision === 'filter') {
        toFilter.push(batch[i])
        continue
      }

      state.kept += 1
      state.evaluated += 1
      state.done += 1
    }
    opts.onProgress(state.done, pending.length)
    await tick()
  }

  return toFilter
}

async function evaluateOffline(
  pending: PendingInsight[],
  opts: QueueReevaluateOptions,
  state: QueueReevaluateResult & { done: number },
): Promise<PendingInsight[]> {
  const toFilter: PendingInsight[] = []

  for (const item of pending) {
    if (opts.isCancelled()) break

    if (selfReferenceGate(item.content) === 'system') {
      toFilter.push(item)
      continue
    }

    state.kept += 1
    state.evaluated += 1
    state.done += 1
  }

  opts.onProgress(state.done, pending.length)
  await tick()
  return toFilter
}

async function rejectFiltered(
  db: Db,
  toFilter: PendingInsight[],
  total: number,
  opts: QueueReevaluateOptions,
  state: QueueReevaluateResult & { done: number },
): Promise<void> {
  for (const rejectChunk of chunk(toFilter, REJECT_CHUNK_SIZE)) {
    if (opts.isCancelled()) break

    for (const item of rejectChunk) {
      try {
        rejectInsight(db, item.id, REJECTION_REASON)
        enqueueVaultWrite(db, item.id, 'reject')
        state.filtered += 1
        state.evaluated += 1
      } catch (error) {
        console.warn('[me.md:queue-reevaluate] Failed to reject filtered insight', item.id, error)
      }
      state.done += 1
    }

    opts.onProgress(state.done, total)
    await tick()
  }
}

export async function reevaluatePendingInsights(
  db: Db,
  opts: QueueReevaluateOptions,
): Promise<QueueReevaluateResult> {
  const pending = fetchPendingInsights(db)
  const usedAi = isApiKeyConfigured()
  const state: QueueReevaluateResult & { done: number } = {
    evaluated: 0,
    filtered: 0,
    kept: 0,
    usedAi,
    done: 0,
  }

  opts.onProgress(0, pending.length)
  if (pending.length === 0 || opts.isCancelled()) {
    const { done: _done, ...result } = state
    return result
  }

  const toFilter = usedAi
    ? await evaluateWithAi(pending, opts, state)
    : await evaluateOffline(pending, opts, state)

  await rejectFiltered(db, toFilter, pending.length, opts, state)

  const { done: _done, ...result } = state
  return result
}
