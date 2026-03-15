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
import { extractInsights, type SourceType, type ExtractionContext } from './insightExtraction'

type Db = SQLJsDatabase<typeof schema>

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
  return titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || 'Untitled Page'
}

function generateSummary(text: string, maxLength = 500): string {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10)
  let summary = ''
  for (const sentence of sentences) {
    if (summary.length + sentence.length > maxLength) break
    summary += sentence.trim() + '. '
  }
  return summary.trim() || text.substring(0, maxLength)
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

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const trimmedText = text.trim()
  const fileId = crypto.randomUUID()
  const displayTitle = title || 'Pasted text'
  const summary = generateSummary(trimmedText)

  db.insert(importedFiles).values({
    id: fileId,
    userId: LOCAL_USER_ID,
    filename: displayTitle,
    fileType: 'text',
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

  return { message: 'Text imported successfully', id: fileId, title: displayTitle, summary }
}

/**
 * Import ChatGPT memory extraction text.
 */
export function importChatGPT(db: Db, text: string, title?: string) {
  if (!text || text.trim().length === 0) throw new Error('ChatGPT response text is required')

  const trimmedText = text.trim()
  if (trimmedText.length < 20) throw new Error('The response seems too short. Please paste the full ChatGPT output.')

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  const fileId = crypto.randomUUID()
  const displayTitle = title || 'ChatGPT Memory Extraction'
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

  if (!extractedText || extractedText.trim().length === 0) {
    throw new Error('Could not extract text from file')
  }

  const fileId = crypto.randomUUID()
  const filename = file.name || 'Uploaded file'
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
 * Import LinkedIn data export (JSON format).
 * LinkedIn provides a ZIP with JSON files — this expects the parsed JSON content.
 */
export function importLinkedIn(db: Db, jsonContent: string) {
  if (!jsonContent || jsonContent.trim().length === 0) throw new Error('LinkedIn data is required')

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonContent)
  } catch {
    throw new Error('Invalid JSON. Please paste the contents of a LinkedIn data export JSON file.')
  }

  // Extract structured text from common LinkedIn export fields
  const sections: string[] = []

  // Profile data
  if (parsed.Profile || parsed.profile) {
    const profile = (parsed.Profile || parsed.profile) as Record<string, unknown>
    const fields = ['First Name', 'Last Name', 'Headline', 'Summary', 'Industry', 'Location']
    for (const field of fields) {
      const val = profile[field] || profile[field.toLowerCase()] || profile[field.replace(/ /g, '_')]
      if (val && typeof val === 'string' && val.trim()) sections.push(`${field}: ${val.trim()}`)
    }
  }

  // Positions / experience
  const positions = (parsed.Positions || parsed.positions || parsed.Position || []) as Array<Record<string, unknown>>
  if (Array.isArray(positions) && positions.length > 0) {
    sections.push('\n## Work Experience')
    for (const pos of positions.slice(0, 10)) {
      const title = pos['Title'] || pos['title'] || ''
      const company = pos['Company Name'] || pos['company'] || pos['companyName'] || ''
      const desc = pos['Description'] || pos['description'] || ''
      if (title || company) {
        sections.push(`- ${title}${company ? ` at ${company}` : ''}${desc ? `: ${desc}` : ''}`)
      }
    }
  }

  // Skills
  const skills = (parsed.Skills || parsed.skills || parsed.Skill || []) as Array<Record<string, unknown>>
  if (Array.isArray(skills) && skills.length > 0) {
    sections.push('\n## Skills')
    const skillNames = skills.map(s => (s['Name'] || s['name'] || s) as string).filter(Boolean)
    sections.push(skillNames.join(', '))
  }

  // Education
  const education = (parsed.Education || parsed.education || []) as Array<Record<string, unknown>>
  if (Array.isArray(education) && education.length > 0) {
    sections.push('\n## Education')
    for (const edu of education.slice(0, 5)) {
      const school = edu['School Name'] || edu['school'] || edu['schoolName'] || ''
      const degree = edu['Degree Name'] || edu['degree'] || edu['degreeName'] || ''
      const field = edu['Field of Study'] || edu['fieldOfStudy'] || ''
      if (school || degree) {
        sections.push(`- ${degree}${field ? ` in ${field}` : ''}${school ? ` from ${school}` : ''}`)
      }
    }
  }

  // Certifications
  const certs = (parsed.Certifications || parsed.certifications || []) as Array<Record<string, unknown>>
  if (Array.isArray(certs) && certs.length > 0) {
    sections.push('\n## Certifications')
    for (const cert of certs.slice(0, 10)) {
      const name = cert['Name'] || cert['name'] || ''
      const authority = cert['Authority'] || cert['authority'] || ''
      if (name) sections.push(`- ${name}${authority ? ` (${authority})` : ''}`)
    }
  }

  // If structured parsing didn't find much, use the raw JSON as text
  let extractedText = sections.join('\n')
  if (extractedText.trim().length < 50) {
    extractedText = JSON.stringify(parsed, null, 2).substring(0, 10000)
  }
  if (extractedText.length > 10000) extractedText = extractedText.substring(0, 10000) + '... [truncated]'

  const fileId = crypto.randomUUID()
  const displayTitle = 'LinkedIn Data Import'
  const summary = generateSummary(extractedText)

  db.insert(importedFiles).values({
    id: fileId,
    userId: LOCAL_USER_ID,
    filename: displayTitle,
    fileType: 'file',
    processedContent: JSON.stringify({
      title: displayTitle,
      summary,
      textLength: extractedText.length,
      extractedText,
      source: 'linkedin',
      processedAt: new Date().toISOString(),
    }),
  }).run()

  const existingContext = parseImportedContext(user.importedContext)
  db.update(users).set({
    importedContext: JSON.stringify([...existingContext, { type: 'linkedin', title: displayTitle, importedFileId: fileId }]),
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, LOCAL_USER_ID)).run()

  scheduleSave()

  return { message: 'LinkedIn data imported successfully', id: fileId, title: displayTitle, summary }
}

/**
 * Import a PDF resume.
 * Extracts text from the PDF and stores it for AI processing.
 */
export async function importResume(db: Db, file: File) {
  if (!file) throw new Error('No file provided')
  if (file.size > 5 * 1024 * 1024) throw new Error('File too large. Maximum size is 5MB.')

  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  if (ext !== '.pdf' && file.type !== 'application/pdf') {
    throw new Error('Please upload a PDF file')
  }

  const user = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get()
  if (!user) throw new Error('User not found')

  // Extract text from PDF
  const buffer = await file.arrayBuffer()
  const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const textParts: string[] = []
  const streamRegex = /stream\s*\n([\s\S]*?)\nendstream/g
  let match
  while ((match = streamRegex.exec(rawText)) !== null) {
    const part = match[1].replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim()
    if (part.length > 10) textParts.push(part)
  }
  let extractedText = textParts.join(' ').trim()
  if (!extractedText || extractedText.length < 20) {
    extractedText = rawText.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (extractedText.length > 10000) extractedText = extractedText.substring(0, 10000) + '... [truncated]'

  if (!extractedText || extractedText.trim().length < 10) {
    throw new Error('Could not extract text from PDF. The file may be image-based or encrypted.')
  }

  const fileId = crypto.randomUUID()
  const displayTitle = `Resume: ${file.name}`
  const summary = generateSummary(extractedText)

  db.insert(importedFiles).values({
    id: fileId,
    userId: LOCAL_USER_ID,
    filename: displayTitle,
    fileType: 'file',
    processedContent: JSON.stringify({
      title: displayTitle,
      summary,
      textLength: extractedText.length,
      extractedText,
      source: 'resume',
      originalSize: file.size,
      mimeType: file.type,
      processedAt: new Date().toISOString(),
    }),
  }).run()

  const existingContext = parseImportedContext(user.importedContext)
  db.update(users).set({
    importedContext: JSON.stringify([...existingContext, { type: 'resume', title: displayTitle, importedFileId: fileId }]),
    updatedAt: new Date().toISOString(),
  }).where(eq(users.id, LOCAL_USER_ID)).run()

  scheduleSave()

  return { message: 'Resume imported successfully', id: fileId, title: displayTitle, summary, size: file.size }
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
export async function processImport(db: Db, importId: string) {
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

  if (!contentText || contentText.trim().length === 0) {
    return {
      message: 'No personal insights could be extracted from this content',
      importId,
      insightsExtracted: 0,
      insights: [],
      topicCreated: null,
    }
  }

  // Gather existing verified insights for deduplication
  const existingVerified = db.select({ content: insights.content, confidenceScore: insights.confidenceScore })
    .from(insights)
    .where(and(eq(insights.userId, LOCAL_USER_ID), eq(insights.verificationStatus, 'verified')))
    .all()
    .map(i => ({ content: i.content, confidenceScore: i.confidenceScore ?? 50 }))

  const extractionCtx: ExtractionContext = {
    content: contentText,
    sourceType,
    topicTitle: pc.title || importedFile.filename || undefined,
    existingVerifiedInsights: existingVerified,
  }

  const unifiedInsights = await extractInsights(extractionCtx)

  const extractedInsights = unifiedInsights.map(i => ({
    content: i.content,
    confidenceScore: i.confidenceScore,
    suggestedCategory: i.category,
    extractionMethod: i.extractionMethod,
  }))

  if (extractedInsights.length === 0) {
    return {
      message: 'No personal insights could be extracted from this content',
      importId,
      insightsExtracted: 0,
      insights: [],
      topicCreated: null,
    }
  }

  // Create topic, session, note, and insights
  const topicTitle = `Import: ${importedFile.filename || 'Untitled'}`.substring(0, 200)
  const topicId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const noteId = crypto.randomUUID()

  const categoryCounts: Record<string, number> = {}
  for (const ins of extractedInsights) {
    categoryCounts[ins.suggestedCategory] = (categoryCounts[ins.suggestedCategory] || 0) + 1
  }
  const dominantCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'identity'

  const noteTitle = `Import Notes: ${importedFile.filename || 'Untitled'}`
  const noteSummary = `Insights extracted from ${importedFile.fileType} import "${importedFile.filename || 'Untitled'}". ${extractedInsights.length} insights identified.`

  const savedInsights: Array<{
    id: string; content: string; confidenceScore: number; verificationStatus: string; suggestedCategory: string
  }> = []

  // Create all records
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
    }).run()

    savedInsights.push({
      id: insightId,
      content: extracted.content,
      confidenceScore: extracted.confidenceScore,
      verificationStatus: 'unverified',
      suggestedCategory: extracted.suggestedCategory,
    })
  }

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
