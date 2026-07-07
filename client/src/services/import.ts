/**
 * Import Service
 * ===============
 * Ported from server/src/routes/import.ts
 * Handles importing content from files, text, URLs, and ChatGPT exports.
 * File reading uses FileReader API (replaces multer/Node.js).
 * URL fetching uses fetch API (replaces http/https modules).
 */

import { eq, and } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type * as schema from '@/db/schema'
import {
  importedFiles,
  users,
  topics,
  insights,
  notes,
  sessions,
} from '@/db/schema'
import { scheduleSave } from '@/db/persistence'
import { LOCAL_USER_ID } from '@/contexts/UserContext'
import { extractInsights, admitInsights, type SourceType, type ExtractionContext, type AdmittedInsight, type DroppedCandidate } from './insightExtraction'
import { cleanText, cleanTitle, stripFrontmatter } from './textCleaning'
import { stableHash } from './obsidianExport'
import { applyInsightEvidenceAttachments, fetchExistingInsightRefs, logAdmissionDrops } from './admissionPersistence'
import { enqueueVaultPendingWrites } from './vaultWriteThrough'
import { getAssessmentSummary } from './profile'

type Db = SQLJsDatabase<typeof schema>
export const MAX_INSIGHTS_PER_NOTE = 8

// ============================================
// HTML/text helpers
// ============================================

function extractTextFromHtml(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > 10000) text = text.substring(0, 10000) + '... [truncated]'
  return text
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return cleanTitle(titleMatch?.[1] ?? '', 'Untitled page')
}

function generateSummary(text: string, maxLength = 500): string {
  const clean = cleanText(text)
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10)
  let summary = ''
  for (const sentence of sentences) {
    if (summary.length + sentence.length > maxLength) break
    summary += sentence.trim() + ' '
  }
  return summary.trim() || clean.substring(0, maxLength)
}

function parseImportedContext(importedContextJson: string | null): unknown[] {
  if (!importedContextJson) return []
  try {
    const parsed = JSON.parse(importedContextJson)
    if (!Array.isArray(parsed)) return [parsed]
    return parsed
  } catch (parseErr) {
    console.error('[me.md] Failed to parse importedContext:', parseErr)
    throw new Error('Existing import context is corrupted and cannot be parsed.')
  }
}

// ============================================
// Public API
// ============================================

/**
 * Import URLs and fetch their content.
 */
export async function importUrls(db: Db, urls: string[]) {
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    throw new Error('At least one URL is required')
  }

  const validUrls: string[] = []
  const errors: string[] = []
  for (const url of urls) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`Invalid protocol for ${url}`)
      } else {
        validUrls.push(url)
      }
    } catch {
      errors.push(`Invalid URL: ${url}`)
    }
  }

  if (validUrls.length === 0) throw new Error('No valid URLs provided')

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const results: Array<{
    id: string
    url: string
    status: 'success' | 'error'
    title?: string
    summary?: string
    error?: string
  }> = []

  for (const url of validUrls) {
    try {
      // Use fetch API (browser) with a CORS proxy may be needed for some URLs
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const html = await response.text()

      const title = extractTitle(html)
      const text = extractTextFromHtml(html)
      const summary = generateSummary(text)
      const fileId = crypto.randomUUID()

      db.insert(importedFiles).values({
        id: fileId,
        userId: LOCAL_USER_ID,
        filename: url,
        fileType: 'url',
        processedContent: JSON.stringify({
          url, title, summary,
          textLength: text.length,
          extractedText: text,
          processedAt: new Date().toISOString(),
        }),
      }).run()

      // Update user imported context
      const currentUser = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()!
      const existingContext = parseImportedContext(currentUser.importedContext)
      db.update(users).set({
        importedContext: JSON.stringify([...existingContext, { type: 'url', url, title: title || 'Untitled', importedFileId: fileId }]),
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, LOCAL_USER_ID)).run()

      results.push({ id: fileId, url, status: 'success', title, summary })
    } catch (err) {
      results.push({ url, id: '', status: 'error', error: err instanceof Error ? err.message : 'Failed to process URL' })
    }
  }

  scheduleSave()

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length

  return {
    message: `Processed ${successCount} URL(s) successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
    results,
    successCount,
    errorCount,
  }
}

/**
 * Import plain text content.
 */
export function importText(db: Db, text: string, title?: string) {
  if (!text || text.trim().length === 0) throw new Error('Text content is required')
  const body = stripFrontmatter(text)

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const trimmedText = body.trim()
  const fileId = crypto.randomUUID()
  const displayTitle = cleanTitle(title || 'Pasted text', 'Pasted text')
  const summary = generateSummary(trimmedText)
  const contentHash = stableHash(trimmedText)

  db.insert(importedFiles).values({
    id: fileId,
    userId: LOCAL_USER_ID,
    filename: displayTitle,
    fileType: 'text',
    contentHash,
    processedContent: JSON.stringify({
      title: displayTitle,
      summary,
      textLength: trimmedText.length,
      extractedText: trimmedText.substring(0, 10000),
      processedAt: new Date().toISOString(),
    }),
  }).run()

  const existingContext = parseImportedContext(user.importedContext)
  db.update(users).set({
    importedContext: JSON.stringify([...existingContext, { type: 'text', title: displayTitle, importedFileId: fileId }]),
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, LOCAL_USER_ID)).run()

  scheduleSave()

  return { message: 'Text imported successfully', id: fileId, title: displayTitle, summary, contentHash }
}

export function findProcessedImportByHash(db: Db, contentHash: string): { importId: string; topicId?: string } | null {
  const rows = db.select({
    id: importedFiles.id,
    processedContent: importedFiles.processedContent,
  }).from(importedFiles)
    .where(and(eq(importedFiles.userId, LOCAL_USER_ID), eq(importedFiles.contentHash, contentHash)))
    .all()

  for (const row of rows) {
    try {
      const processedContent = row.processedContent ? JSON.parse(row.processedContent) : null
      if (!processedContent || processedContent.processingStatus !== 'processed') continue
      return {
        importId: row.id,
        topicId: typeof processedContent.processedTopicId === 'string' ? processedContent.processedTopicId : undefined,
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Import ChatGPT memory extraction text.
 */
export function importChatGPT(db: Db, text: string, title?: string) {
  if (!text || text.trim().length === 0) throw new Error('ChatGPT response text is required')

  const body = stripFrontmatter(text)
  const trimmedText = body.trim()
  if (trimmedText.length < 20) throw new Error('The response seems too short. Please paste the full ChatGPT output.')

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const fileId = crypto.randomUUID()
  const displayTitle = cleanTitle(title || 'ChatGPT Memory Extraction', 'ChatGPT memory extraction')
  const summary = generateSummary(trimmedText)

  // Parse sections from ChatGPT output
  const sections: Record<string, string> = {}
  const sectionRegex = /\*\*([^*]+)\*\*[:\s]*([\s\S]*?)(?=\*\*[^*]+\*\*|$)/g
  let match
  while ((match = sectionRegex.exec(trimmedText)) !== null) {
    const sectionName = match[1].trim()
    const sectionContent = match[2].trim()
    if (sectionContent.length > 0) sections[sectionName] = sectionContent
  }

  db.insert(importedFiles).values({
    id: fileId,
    userId: LOCAL_USER_ID,
    filename: displayTitle,
    fileType: 'chatgpt',
    processedContent: JSON.stringify({
      title: displayTitle,
      summary,
      textLength: trimmedText.length,
      extractedText: trimmedText.substring(0, 10000),
      sections: Object.keys(sections).length > 0 ? sections : null,
      sectionCount: Object.keys(sections).length,
      source: 'chatgpt_memory',
      processedAt: new Date().toISOString(),
    }),
  }).run()

  const existingContext = parseImportedContext(user.importedContext)
  db.update(users).set({
    importedContext: JSON.stringify([...existingContext, { type: 'chatgpt', title: displayTitle, importedFileId: fileId }]),
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, LOCAL_USER_ID)).run()

  scheduleSave()

  return {
    message: 'ChatGPT context imported successfully',
    id: fileId,
    title: displayTitle,
    summary,
    sectionCount: Object.keys(sections).length,
  }
}

/**
 * Import a file (read via FileReader API in browser).
 * Accepts a File object from an <input type="file">.
 */
export async function importFile(db: Db, file: File) {
  if (!file) throw new Error('No file provided')

  const allowedExts = ['.txt', '.md', '.csv', '.json', '.pdf']
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  if (!allowedExts.includes(ext)) {
    throw new Error('Unsupported file type. Accepted: .txt, .md, .csv, .json, .pdf')
  }

  if (file.size > 5 * 1024 * 1024) throw new Error('File too large. Maximum size is 5MB.')

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  let extractedText = ''

  if (file.type === 'application/pdf' || ext === '.pdf') {
    // Simple PDF text extraction — extract readable ASCII
    const buffer = await file.arrayBuffer()
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    const textParts: string[] = []
    const streamRegex = /stream\s*\n([\s\S]*?)\nendstream/g
    let match
    while ((match = streamRegex.exec(rawText)) !== null) {
      const part = match[1].replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim()
      if (part.length > 10) textParts.push(part)
    }
    extractedText = textParts.join(' ').trim()
    if (!extractedText || extractedText.length < 20) {
      extractedText = rawText.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim()
    }
  } else {
    extractedText = await file.text()
  }

  if (extractedText.length > 10000) {
    extractedText = extractedText.substring(0, 10000) + '... [truncated]'
  }
  extractedText = stripFrontmatter(extractedText)

  if (!extractedText || extractedText.trim().length === 0) {
    throw new Error('Could not extract text from file')
  }

  const fileId = crypto.randomUUID()
  const filename = cleanTitle(file.name || 'Uploaded file', 'Uploaded file')
  const summary = generateSummary(extractedText)

  db.insert(importedFiles).values({
    id: fileId,
    userId: LOCAL_USER_ID,
    filename,
    fileType: 'file',
    processedContent: JSON.stringify({
      title: filename,
      summary,
      textLength: extractedText.length,
      extractedText,
      originalSize: file.size,
      mimeType: file.type,
      processedAt: new Date().toISOString(),
    }),
  }).run()

  const existingContext = parseImportedContext(user.importedContext)
  db.update(users).set({
    importedContext: JSON.stringify([...existingContext, { type: 'file', title: filename, importedFileId: fileId }]),
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, LOCAL_USER_ID)).run()

  scheduleSave()

  return { message: 'File imported successfully', id: fileId, filename, title: filename, summary, size: file.size }
}

/**
 * Get import processing status for the user.
 */
export function getImportStatus(db: Db) {
  const imports = db.select().from(importedFiles).where(eq(importedFiles.userId, LOCAL_USER_ID)).all()

  const processed = imports.map(imp => {
    let content = null
    try { if (imp.processedContent) content = JSON.parse(imp.processedContent) } catch { /* empty */ }
    return {
      id: imp.id,
      filename: imp.filename,
      fileType: imp.fileType,
      processedContent: content,
      createdAt: imp.createdAt,
    }
  })

  return { imports: processed, count: processed.length }
}

/**
 * Process an imported file and extract insights using AI.
 */
export async function processImport(
  db: Db,
  importId: string,
  options?: { topicId?: string; topicTitle?: string },
) {
  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const importedFile = db.select().from(importedFiles).where(
    and(eq(importedFiles.id, importId), eq(importedFiles.userId, LOCAL_USER_ID))
  ).get()

  if (!importedFile) throw new Error('Imported file not found')

  let processedContent: Record<string, unknown> = {}
  try {
    if (importedFile.processedContent) processedContent = JSON.parse(importedFile.processedContent)
  } catch {
    throw new Error('Could not parse import content.')
  }

  const sourceTypeMap: Record<string, SourceType> = {
    chatgpt: 'import_chatgpt',
    url: 'import_url',
    text: 'import_text',
    file: 'import_file',
  }

  const sourceType = sourceTypeMap[importedFile.fileType || '']
  if (!sourceType) throw new Error(`Unsupported file type: ${importedFile.fileType}`)

  // Build content text
  let contentText = ''
  const pc = processedContent as { extractedText?: string; sections?: Record<string, string>; title?: string }
  if (pc.sections && Object.keys(pc.sections).length > 0) {
    contentText = Object.entries(pc.sections).map(([section, content]) => `## ${section}\n${content}`).join('\n\n')
  } else if (pc.extractedText) {
    contentText = pc.extractedText
  }
  const cleanName = cleanTitle(pc.title || importedFile.filename || '', 'Untitled import')

  if (!contentText || contentText.trim().length === 0) {
    return {
      message: 'No personal insights could be extracted from this content',
      importId,
      insightsExtracted: 0,
      insights: [],
      topicCreated: null,
    }
  }

  const existing = fetchExistingInsightRefs(db)
  const existingVerified = existing
    .filter(ref => ref.verificationStatus === 'verified')
    .map(ref => ({ content: ref.content, confidenceScore: 50 }))

  const extractionCtx: ExtractionContext = {
    content: contentText,
    sourceType,
    topicTitle: cleanName,
    existingVerifiedInsights: existingVerified,
    assessmentSummary: getAssessmentSummary(db) ?? undefined,
  }

  const unifiedInsights = await extractInsights(extractionCtx)
  const admission = admitInsights(unifiedInsights, existing, `import:${importId}`)
  const { admitted, capDrops } = capAdmittedInsights(admission.admit)
  applyInsightEvidenceAttachments(db, admission.attach)
  logAdmissionDrops([...admission.drop, ...capDrops])

  const extractedInsights = admitted.map(i => ({
    content: i.content,
    confidenceScore: i.confidenceScore,
    suggestedCategory: i.category,
    extractionMethod: i.extractionMethod,
    priorAlignment: i.priorAlignment ?? 'novel',
    kind: i.kind ?? null,
    evidenceCount: i.evidenceCount,
    evidenceSources: i.evidenceSources,
  }))

  if (unifiedInsights.length === 0) {
    // Mark processed so the content hash makes an identical re-import skip as 'unchanged'.
    db.update(importedFiles).set({
      processedContent: JSON.stringify({
        ...processedContent,
        processingStatus: 'processed',
        processedInsightCount: 0,
        processedAt: new Date().toISOString(),
      }),
    }).where(eq(importedFiles.id, importId)).run()
    scheduleSave()

    return {
      message: 'No personal insights could be extracted from this content',
      importId,
      insightsExtracted: 0,
      insights: [],
      topicCreated: null,
    }
  }

  if (extractedInsights.length === 0) {
    db.update(importedFiles).set({
      processedContent: JSON.stringify({
        ...processedContent,
        processingStatus: 'processed',
        processedInsightCount: 0,
        processedAt: new Date().toISOString(),
      }),
    }).where(eq(importedFiles.id, importId)).run()

    scheduleSave()

    return {
      message: 'No new personal insights could be extracted from this content',
      importId,
      insightsExtracted: 0,
      insights: [],
      topicCreated: null,
    }
  }

  // Create topic, session, note, and insights
  let topicTitle = options?.topicTitle || cleanName.substring(0, 200)
  let topicId = options?.topicId || crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const noteId = crypto.randomUUID()

  const categoryCounts: Record<string, number> = {}
  for (const ins of extractedInsights) {
    categoryCounts[ins.suggestedCategory] = (categoryCounts[ins.suggestedCategory] || 0) + 1
  }
  const dominantCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'identity'

  const noteTitle = cleanName
  const noteSummary = `${extractedInsights.length} insight${extractedInsights.length === 1 ? '' : 's'} drawn from “${cleanName}”.`

  const savedInsights: Array<{
    id: string; content: string; confidenceScore: number; verificationStatus: string; suggestedCategory: string
  }> = []

  // Create all records
  if (options?.topicId) {
    const existingTopic = db.select({ title: topics.title }).from(topics)
      .where(and(eq(topics.id, options.topicId), eq(topics.userId, LOCAL_USER_ID)))
      .get()
    topicTitle = options.topicTitle || existingTopic?.title || topicTitle
    topicId = options.topicId
  } else {
    db.insert(topics).values({
      id: topicId,
      userId: LOCAL_USER_ID,
      title: topicTitle,
      description: `Insights extracted from imported ${importedFile.fileType} content: "${importedFile.filename || 'Untitled'}"`,
      tags: JSON.stringify(['imported', importedFile.fileType]),
      status: 'extracted',
      priority: 'medium',
      intent: 'document',
      isPreset: false,
      presetCategory: dominantCategory as any,
    }).run()
  }

  db.insert(sessions).values({
    id: sessionId,
    topicId,
    userId: LOCAL_USER_ID,
    status: 'completed',
    isMiniSession: false,
    completedAt: new Date().toISOString(),
  }).run()

  db.insert(notes).values({
    id: noteId,
    sessionId,
    topicId,
    userId: LOCAL_USER_ID,
    title: noteTitle,
    contentFullAnalysis: noteSummary,
    contentBriefSummary: noteSummary,
    selectedFormat: 'brief_summary',
  }).run()

  for (const extracted of extractedInsights) {
    const insightId = crypto.randomUUID()
    db.insert(insights).values({
      id: insightId,
      noteId,
      topicId,
      userId: LOCAL_USER_ID,
      content: extracted.content,
      confidenceScore: extracted.confidenceScore,
      extractionMethod: extracted.extractionMethod || 'ai',
      verificationStatus: 'unverified',
      sourceSessionId: sessionId,
      evidenceCount: extracted.evidenceCount,
      evidenceSources: extracted.evidenceSources.length > 0 ? JSON.stringify(extracted.evidenceSources) : null,
      priorAlignment: extracted.priorAlignment ?? 'novel',
      kind: extracted.kind ?? null,
    }).run()

    savedInsights.push({
      id: insightId,
      content: extracted.content,
      confidenceScore: extracted.confidenceScore,
      verificationStatus: 'unverified',
      suggestedCategory: extracted.suggestedCategory,
    })
  }
  enqueueVaultPendingWrites(db, savedInsights.map(insight => insight.id))

  // Mark import as processed
  db.update(importedFiles).set({
    processedContent: JSON.stringify({
      ...processedContent,
      processingStatus: 'processed',
      processedInsightCount: savedInsights.length,
      processedTopicId: topicId,
      processedNoteId: noteId,
      processedAt: new Date().toISOString(),
    }),
  }).where(eq(importedFiles.id, importId)).run()

  scheduleSave()

  return {
    message: `Successfully extracted ${savedInsights.length} insight(s) from imported content`,
    importId,
    insightsExtracted: savedInsights.length,
    insights: savedInsights,
    topicCreated: { id: topicId, title: topicTitle },
    noteCreated: { id: noteId, title: noteTitle },
  }
}

function capAdmittedInsights(admitted: AdmittedInsight[]): { admitted: AdmittedInsight[]; capDrops: DroppedCandidate[] } {
  const sorted = [...admitted].sort((a, b) => b.confidenceScore - a.confidenceScore)
  const kept = sorted.slice(0, MAX_INSIGHTS_PER_NOTE)
  const overflow = sorted.slice(MAX_INSIGHTS_PER_NOTE)
  return {
    admitted: kept,
    capDrops: overflow.map(item => ({
      content: item.content,
      reason: 'cap',
      score: 0,
    })),
  }
}

/**
 * Get insights extracted from a specific import.
 */
export function getImportInsights(db: Db, importId: string) {
  const importedFile = db.select().from(importedFiles).where(
    and(eq(importedFiles.id, importId), eq(importedFiles.userId, LOCAL_USER_ID))
  ).get()

  if (!importedFile) throw new Error('Imported file not found')

  let processedContent: Record<string, unknown> = {}
  try { if (importedFile.processedContent) processedContent = JSON.parse(importedFile.processedContent) } catch { /* empty */ }

  const topicId = processedContent.processedTopicId as string | undefined
  const isProcessed = processedContent.processingStatus === 'processed'

  if (!isProcessed || !topicId) {
    return { importId, isProcessed: false, insights: [], count: 0 }
  }

  const importInsights = db.select().from(insights)
    .where(and(eq(insights.topicId, topicId), eq(insights.userId, LOCAL_USER_ID)))
    .all()

  return {
    importId,
    isProcessed: true,
    topicId,
    insights: importInsights,
    count: importInsights.length,
    verificationStats: {
      unverified: importInsights.filter(i => i.verificationStatus === 'unverified').length,
      verified: importInsights.filter(i => i.verificationStatus === 'verified').length,
      rejected: importInsights.filter(i => i.verificationStatus === 'rejected').length,
    },
  }
}
