import { Router } from 'express';
import { db, sqlite } from '../config/database.js';
import { importedFiles, users, topics, insights, notes, sessions } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';
import { extractInsights, type SourceType, type ExtractionContext } from '../services/insightExtraction.js';

export const importRouter = Router();

// Simple URL content fetcher (no external dependencies)
function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const req = protocol.get(url, { timeout: 10000 }, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: Failed to fetch URL`));
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
        // Limit to ~500KB to avoid memory issues
        if (data.length > 500000) {
          res.destroy();
          resolve(data);
        }
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// Extract readable text from HTML
function extractTextFromHtml(html: string): string {
  // Remove script and style tags with their content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Limit to reasonable length
  if (text.length > 10000) {
    text = text.substring(0, 10000) + '... [truncated]';
  }
  return text;
}

// Extract page title from HTML
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].replace(/\s+/g, ' ').trim();
  }
  return 'Untitled Page';
}

// Generate a simple summary from text content
function generateSummary(text: string, maxLength: number = 500): string {
  // Take first few sentences
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  let summary = '';
  for (const sentence of sentences) {
    if (summary.length + sentence.length > maxLength) break;
    summary += sentence.trim() + '. ';
  }
  return summary.trim() || text.substring(0, maxLength);
}

// Helper: safely parse importedContext JSON from user record with proper error logging
function parseImportedContext(importedContextJson: string | null, userId: string): unknown[] {
  if (!importedContextJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(importedContextJson);
    if (!Array.isArray(parsed)) {
      console.error(`[me.md] User ${userId} importedContext is not an array, preserving as-is in wrapper array`);
      return [parsed];
    }
    return parsed;
  } catch (parseErr) {
    // IMPORTANT: Do NOT silently reset to [] - this would corrupt existing data.
    // Instead, log the error and throw to prevent the import from proceeding
    // with corrupted context data.
    console.error(`[me.md] CRITICAL: Failed to parse importedContext for user ${userId}. ` +
      `Raw value (first 200 chars): "${importedContextJson.substring(0, 200)}". ` +
      `Error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    throw new Error(`User's existing import context is corrupted and cannot be parsed. Please contact support.`);
  }
}

// POST /api/import/urls - Submit URLs for processing
importRouter.post('/urls', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'At least one URL is required' });
    }

    // Validate URLs
    const validUrls: string[] = [];
    const errors: string[] = [];
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push(`Invalid protocol for ${url}: only http and https are supported`);
        } else {
          validUrls.push(url);
        }
      } catch {
        errors.push(`Invalid URL: ${url}`);
      }
    }

    if (validUrls.length === 0) {
      return res.status(400).json({ error: 'No valid URLs provided', errors });
    }

    // Verify user exists BEFORE processing any URLs (fail early)
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Process each URL
    const results: Array<{
      id: string;
      url: string;
      status: 'success' | 'error';
      title?: string;
      summary?: string;
      error?: string;
    }> = [];

    for (const url of validUrls) {
      try {
        const html = await fetchUrl(url);
        const title = extractTitle(html);
        const text = extractTextFromHtml(html);
        const summary = generateSummary(text);

        const fileId = uuidv4();

        // Use a transaction to atomically insert the file and update user context
        const insertAndUpdateContext = sqlite.transaction(() => {
          // Insert the imported file
          db.insert(importedFiles).values({
            id: fileId,
            userId,
            filename: url,
            fileType: 'url',
            processedContent: JSON.stringify({
              url,
              title,
              summary,
              textLength: text.length,
              extractedText: text,
              processedAt: new Date().toISOString(),
            }),
          }).run();

          // Re-fetch user inside transaction for consistent read
          const currentUser = db.select().from(users).where(eq(users.id, userId)).get();
          if (!currentUser) {
            throw new Error('User not found during transaction');
          }

          const existingContext = parseImportedContext(currentUser.importedContext, userId);

          const newContext = [
            ...existingContext,
            {
              type: 'url',
              url,
              title: title || 'Untitled',
              importedFileId: fileId,
            },
          ];

          db.update(users)
            .set({
              importedContext: JSON.stringify(newContext),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(users.id, userId))
            .run();
        });

        insertAndUpdateContext();

        results.push({
          id: fileId,
          url,
          status: 'success',
          title,
          summary,
        });
      } catch (err) {
        console.error(`[me.md] Failed to import URL "${url}":`, err);
        results.push({
          url,
          id: '',
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to process URL',
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    res.json({
      message: `Processed ${successCount} URL(s) successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      results,
      successCount,
      errorCount,
    });
  } catch (error) {
    console.error('Import URLs error:', error);
    res.status(500).json({ error: 'Failed to process URLs' });
  }
});

// GET /api/import/status - Get import processing status for the user
importRouter.get('/status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const imports = db.select().from(importedFiles).where(eq(importedFiles.userId, userId)).all();

    const processed = imports.map((imp) => {
      let content = null;
      try {
        if (imp.processedContent) {
          content = JSON.parse(imp.processedContent);
        }
      } catch {
        content = null;
      }

      return {
        id: imp.id,
        filename: imp.filename,
        fileType: imp.fileType,
        processedContent: content,
        createdAt: imp.createdAt,
      };
    });

    res.json({
      imports: processed,
      count: processed.length,
    });
  } catch (error) {
    console.error('Import status error:', error);
    res.status(500).json({ error: 'Failed to get import status' });
  }
});

// POST /api/import/text - Import plain text context
importRouter.post('/text', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { text, title } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text content is required' });
    }

    // Verify user exists BEFORE inserting (fail early)
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const trimmedText = text.trim();
    const fileId = uuidv4();
    const displayTitle = title || 'Pasted text';
    const summary = generateSummary(trimmedText);

    // Use a transaction to atomically insert file and update user context
    const insertAndUpdateContext = sqlite.transaction(() => {
      db.insert(importedFiles).values({
        id: fileId,
        userId,
        filename: displayTitle,
        fileType: 'text',
        processedContent: JSON.stringify({
          title: displayTitle,
          summary,
          textLength: trimmedText.length,
          extractedText: trimmedText.substring(0, 10000),
          processedAt: new Date().toISOString(),
        }),
      }).run();

      // Re-fetch user inside transaction for consistent read
      const currentUser = db.select().from(users).where(eq(users.id, userId)).get();
      if (!currentUser) {
        throw new Error('User not found during transaction');
      }

      const existingContext = parseImportedContext(currentUser.importedContext, userId);

      const newContext = [
        ...existingContext,
        {
          type: 'text',
          title: displayTitle,
          importedFileId: fileId,
        },
      ];

      db.update(users)
        .set({
          importedContext: JSON.stringify(newContext),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId))
        .run();
    });

    insertAndUpdateContext();

    res.json({
      message: 'Text imported successfully',
      id: fileId,
      title: displayTitle,
      summary,
    });
  } catch (error) {
    console.error('Import text error:', error);
    const message = error instanceof Error ? error.message : 'Failed to import text';
    // If this was a context corruption error, return 500 with the specific message
    if (message.includes('corrupted')) {
      return res.status(500).json({ error: message });
    }
    res.status(500).json({ error: 'Failed to import text' });
  }
});

// POST /api/import/chatgpt - Import ChatGPT memory extraction output
importRouter.post('/chatgpt', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { text, title } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'ChatGPT response text is required' });
    }

    const trimmedText = text.trim();

    if (trimmedText.length < 20) {
      return res.status(400).json({ error: 'The response seems too short. Please paste the full ChatGPT output.' });
    }

    // Verify user exists BEFORE inserting (fail early)
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const fileId = uuidv4();
    const displayTitle = title || 'ChatGPT Memory Extraction';
    const summary = generateSummary(trimmedText);

    // Parse sections from the ChatGPT output for structured storage
    const sections: Record<string, string> = {};
    const sectionRegex = /\*\*([^*]+)\*\*[:\s]*([\s\S]*?)(?=\*\*[^*]+\*\*|$)/g;
    let match;
    while ((match = sectionRegex.exec(trimmedText)) !== null) {
      const sectionName = match[1].trim();
      const sectionContent = match[2].trim();
      if (sectionContent.length > 0) {
        sections[sectionName] = sectionContent;
      }
    }

    // Use a transaction to atomically insert file and update user context
    const insertAndUpdateContext = sqlite.transaction(() => {
      db.insert(importedFiles).values({
        id: fileId,
        userId,
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
      }).run();

      // Re-fetch user inside transaction for consistent read
      const currentUser = db.select().from(users).where(eq(users.id, userId)).get();
      if (!currentUser) {
        throw new Error('User not found during transaction');
      }

      const existingContext = parseImportedContext(currentUser.importedContext, userId);

      const newContext = [
        ...existingContext,
        {
          type: 'chatgpt',
          title: displayTitle,
          importedFileId: fileId,
        },
      ];

      db.update(users)
        .set({
          importedContext: JSON.stringify(newContext),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId))
        .run();
    });

    insertAndUpdateContext();

    res.json({
      message: 'ChatGPT context imported successfully',
      id: fileId,
      title: displayTitle,
      summary,
      sectionCount: Object.keys(sections).length,
    });
  } catch (error) {
    console.error('Import ChatGPT error:', error);
    const message = error instanceof Error ? error.message : 'Failed to import ChatGPT context';
    if (message.includes('corrupted')) {
      return res.status(500).json({ error: message });
    }
    res.status(500).json({ error: 'Failed to import ChatGPT context' });
  }
});

// POST /api/import/file - Upload and import a file
importRouter.post('/file', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check content-type for multipart
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'File upload requires multipart/form-data' });
    }

    // Verify user exists BEFORE processing file upload (fail early)
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use dynamic import for multer to handle file upload
    const multer = (await import('multer')).default;
    const storage = multer.memoryStorage();
    const upload = multer({
      storage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
      },
      fileFilter: (_req, file, cb) => {
        // Accept text files, PDFs, markdown, JSON
        const allowedMimes = [
          'text/plain',
          'text/markdown',
          'text/csv',
          'application/json',
          'application/pdf',
        ];
        const allowedExts = ['.txt', '.md', '.csv', '.json', '.pdf'];
        const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('Unsupported file type. Accepted: .txt, .md, .csv, .json, .pdf'));
        }
      },
    });

    // Process single file upload
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
        return res.status(400).json({ error: err.message || 'File upload failed' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      try {
        let extractedText = '';
        const filename = file.originalname || 'Uploaded file';

        // Extract text based on file type
        if (file.mimetype === 'application/pdf') {
          // For PDF, extract what we can from the raw buffer as text
          // Simple PDF text extraction - get readable ASCII text from buffer
          const rawText = file.buffer.toString('utf8');
          // Extract text between stream markers in PDF
          const textParts: string[] = [];
          const streamRegex = /stream\s*\n([\s\S]*?)\nendstream/g;
          let match;
          while ((match = streamRegex.exec(rawText)) !== null) {
            const part = match[1].replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
            if (part.length > 10) {
              textParts.push(part);
            }
          }
          extractedText = textParts.join(' ').trim();
          if (!extractedText || extractedText.length < 20) {
            // Fallback: extract any readable text from the PDF
            extractedText = rawText.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
          }
        } else {
          // For text-based files, just decode the buffer
          extractedText = file.buffer.toString('utf8');
        }

        // Truncate if too long
        if (extractedText.length > 10000) {
          extractedText = extractedText.substring(0, 10000) + '... [truncated]';
        }

        if (!extractedText || extractedText.trim().length === 0) {
          return res.status(400).json({ error: 'Could not extract text from file' });
        }

        const fileId = uuidv4();
        const summary = generateSummary(extractedText);

        // Use a transaction to atomically insert file and update user context
        const insertAndUpdateContext = sqlite.transaction(() => {
          db.insert(importedFiles).values({
            id: fileId,
            userId,
            filename,
            fileType: 'file',
            processedContent: JSON.stringify({
              title: filename,
              summary,
              textLength: extractedText.length,
              extractedText,
              originalSize: file.size,
              mimeType: file.mimetype,
              processedAt: new Date().toISOString(),
            }),
          }).run();

          // Re-fetch user inside transaction for consistent read
          const currentUser = db.select().from(users).where(eq(users.id, userId)).get();
          if (!currentUser) {
            throw new Error('User not found during transaction');
          }

          const existingContext = parseImportedContext(currentUser.importedContext, userId);

          const newContext = [
            ...existingContext,
            {
              type: 'file',
              title: filename,
              importedFileId: fileId,
            },
          ];

          db.update(users)
            .set({
              importedContext: JSON.stringify(newContext),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(users.id, userId))
            .run();
        });

        insertAndUpdateContext();

        res.json({
          message: 'File imported successfully',
          id: fileId,
          filename,
          title: filename,
          summary,
          size: file.size,
        });
      } catch (innerErr) {
        console.error('File processing error:', innerErr);
        const message = innerErr instanceof Error ? innerErr.message : 'Failed to process uploaded file';
        if (message.includes('corrupted')) {
          return res.status(500).json({ error: message });
        }
        res.status(500).json({ error: 'Failed to process uploaded file' });
      }
    });
  } catch (error) {
    console.error('Import file error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// ============================================
// Import Processing Pipeline
// ============================================

// Score an extracted statement to determine if it's insight-worthy
function scoreExtractedInsight(statement: string): number {
  let score = 40; // base score for import-derived insights (lower than session-derived)

  const lowerStatement = statement.toLowerCase();

  // Strong personal statements
  if (/\b(i am|i believe|i value|i always|i never|i think|i feel|my|i prefer|i tend to)\b/i.test(lowerStatement)) {
    score += 15;
  }

  // Reasoning/understanding markers
  if (/\b(because|reason|learned|realized|understand|important|matters)\b/i.test(lowerStatement)) {
    score += 10;
  }

  // Core trait indicators
  if (/\b(core|fundamental|deeply|who i am|trait|personality|character|principle|philosophy)\b/i.test(lowerStatement)) {
    score += 10;
  }

  // Preference indicators
  if (/\b(prefer|like|enjoy|love|dislike|hate|comfortable|style|approach)\b/i.test(lowerStatement)) {
    score += 8;
  }

  // Length bonus
  if (statement.length > 60) {
    score += 5;
  }

  return Math.min(score, 90);
}

// Extract insights from ChatGPT Memory import (structured sections)
function extractInsightsFromChatgpt(
  content: { sections?: Record<string, string>; extractedText?: string },
): Array<{ content: string; confidenceScore: number; suggestedCategory: string }> {
  const results: Array<{ content: string; confidenceScore: number; suggestedCategory: string }> = [];

  // Map ChatGPT sections to me.md categories
  const sectionCategoryMap: Record<string, string> = {
    'Personal Background': 'identity',
    'Communication Style': 'perspectives',
    'Values & Beliefs': 'identity',
    'Interests & Hobbies': 'experiences',
    'Professional Life': 'skills',
    'Decision-Making Style': 'perspectives',
    'Strengths & Weaknesses': 'skills',
    'Goals & Aspirations': 'goals',
    'Preferences': 'perspectives',
    'Personality Traits': 'identity',
  };

  if (content.sections && Object.keys(content.sections).length > 0) {
    // Process each section
    for (const [sectionName, sectionContent] of Object.entries(content.sections)) {
      const category = sectionCategoryMap[sectionName] || 'identity';

      // Split section into individual statements
      const statements = sectionContent
        .split(/[.!?\n]+/)
        .map(s => s.replace(/^[-*•]\s*/, '').trim())
        .filter(s => s.length > 20 && s.length < 500);

      for (const statement of statements) {
        const score = scoreExtractedInsight(statement);
        if (score >= 45) {
          results.push({
            content: statement,
            confidenceScore: score,
            suggestedCategory: category,
          });
        }
      }
    }
  } else if (content.extractedText) {
    // Fallback: process as plain text
    const statements = content.extractedText
      .split(/[.!?\n]+/)
      .map(s => s.replace(/^[-*•]\s*/, '').trim())
      .filter(s => s.length > 20 && s.length < 500);

    for (const statement of statements) {
      const score = scoreExtractedInsight(statement);
      if (score >= 50) {
        results.push({
          content: statement,
          confidenceScore: score,
          suggestedCategory: 'identity',
        });
      }
    }
  }

  // Deduplicate by content
  const unique = results.filter((item, index, self) =>
    index === self.findIndex(t => t.content.toLowerCase() === item.content.toLowerCase())
  );

  return unique.slice(0, 30); // Limit to 30 insights per import
}

// Extract insights from URL import
function extractInsightsFromUrl(
  content: { extractedText?: string; title?: string },
): Array<{ content: string; confidenceScore: number; suggestedCategory: string }> {
  const results: Array<{ content: string; confidenceScore: number; suggestedCategory: string }> = [];

  if (!content.extractedText) return results;

  // Split into sentences
  const statements = content.extractedText
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 25 && s.length < 500);

  // Extract statements that contain personal pronouns or self-describing language
  for (const statement of statements) {
    const score = scoreExtractedInsight(statement);
    // Higher threshold for URLs since content may not be personal
    if (score >= 55) {
      // Try to categorize by content
      let category = 'identity';
      const lower = statement.toLowerCase();
      if (/\b(skill|expert|experience|professional|work|career|project)\b/.test(lower)) category = 'skills';
      else if (/\b(goal|aspir|dream|plan|future|want to)\b/.test(lower)) category = 'goals';
      else if (/\b(learn|grew|journey|story|memory|remember)\b/.test(lower)) category = 'experiences';
      else if (/\b(think|believe|approach|perspective|opinion|view)\b/.test(lower)) category = 'perspectives';

      results.push({
        content: statement,
        confidenceScore: score,
        suggestedCategory: category,
      });
    }
  }

  const unique = results.filter((item, index, self) =>
    index === self.findIndex(t => t.content.toLowerCase() === item.content.toLowerCase())
  );

  return unique.slice(0, 20);
}

// Extract insights from plain text or file import
function extractInsightsFromText(
  content: { extractedText?: string; title?: string },
): Array<{ content: string; confidenceScore: number; suggestedCategory: string }> {
  const results: Array<{ content: string; confidenceScore: number; suggestedCategory: string }> = [];

  if (!content.extractedText) return results;

  const statements = content.extractedText
    .split(/[.!?\n]+/)
    .map(s => s.replace(/^[-*•]\s*/, '').trim())
    .filter(s => s.length > 20 && s.length < 500);

  for (const statement of statements) {
    const score = scoreExtractedInsight(statement);
    if (score >= 48) {
      let category = 'identity';
      const lower = statement.toLowerCase();
      if (/\b(skill|expert|experience|professional|work|career|project)\b/.test(lower)) category = 'skills';
      else if (/\b(goal|aspir|dream|plan|future|want to)\b/.test(lower)) category = 'goals';
      else if (/\b(learn|grew|journey|story|memory|remember)\b/.test(lower)) category = 'experiences';
      else if (/\b(think|believe|approach|perspective|opinion|view)\b/.test(lower)) category = 'perspectives';

      results.push({
        content: statement,
        confidenceScore: score,
        suggestedCategory: category,
      });
    }
  }

  const unique = results.filter((item, index, self) =>
    index === self.findIndex(t => t.content.toLowerCase() === item.content.toLowerCase())
  );

  return unique.slice(0, 25);
}

// POST /api/import/:id/process - Process an imported file and extract insights
importRouter.post('/:id/process', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Verify user exists (fail early)
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const importId = req.params.id;

    // Get the imported file
    const importedFile = db.select().from(importedFiles).where(
      and(eq(importedFiles.id, importId), eq(importedFiles.userId, userId))
    ).get();

    if (!importedFile) {
      return res.status(404).json({ error: 'Imported file not found' });
    }

    // Parse processed content
    let processedContent: Record<string, unknown> = {};
    try {
      if (importedFile.processedContent) {
        processedContent = JSON.parse(importedFile.processedContent);
      }
    } catch (parseErr) {
      console.error(`[me.md] Failed to parse processedContent for import ${importId}:`, parseErr);
      return res.status(400).json({ error: 'Could not parse import content. The stored data may be corrupted.' });
    }

    // Map file type to unified extraction source type
    const sourceTypeMap: Record<string, SourceType> = {
      chatgpt: 'import_chatgpt',
      url: 'import_url',
      text: 'import_text',
      file: 'import_file',
    };

    const sourceType = sourceTypeMap[importedFile.fileType];
    if (!sourceType) {
      return res.status(400).json({ error: `Unsupported file type: ${importedFile.fileType}` });
    }

    // Build content string from processedContent
    let contentText = '';
    const pc = processedContent as { extractedText?: string; sections?: Record<string, string>; title?: string };
    if (pc.sections && Object.keys(pc.sections).length > 0) {
      // Format structured sections (ChatGPT exports)
      contentText = Object.entries(pc.sections)
        .map(([section, content]) => `## ${section}\n${content}`)
        .join('\n\n');
    } else if (pc.extractedText) {
      contentText = pc.extractedText;
    }

    if (!contentText || contentText.trim().length === 0) {
      return res.json({
        message: 'No personal insights could be extracted from this content',
        importId,
        insightsExtracted: 0,
        insights: [],
        topicCreated: null,
      });
    }

    // Gather existing verified insights for deduplication
    const existingVerified = db.select({
      content: insights.content,
      confidenceScore: insights.confidenceScore,
    }).from(insights).where(
      and(eq(insights.userId, userId), eq(insights.verificationStatus, 'verified'))
    ).all().map(i => ({
      content: i.content,
      confidenceScore: i.confidenceScore ?? 50,
    }));

    // Extract insights using the unified extraction service
    const extractionCtx: ExtractionContext = {
      content: contentText,
      sourceType,
      topicTitle: pc.title || importedFile.filename || undefined,
      existingVerifiedInsights: existingVerified,
    };

    const unifiedInsights = await extractInsights(extractionCtx);

    // Map to the format expected downstream (with suggestedCategory)
    const extractedInsights = unifiedInsights.map(i => ({
      content: i.content,
      confidenceScore: i.confidenceScore,
      suggestedCategory: i.category,
    }));

    if (extractedInsights.length === 0) {
      return res.json({
        message: 'No personal insights could be extracted from this content',
        importId,
        insightsExtracted: 0,
        insights: [],
        topicCreated: null,
      });
    }

    // Create a topic for this import to group the insights
    const topicTitle = `Import: ${importedFile.filename || 'Untitled'}`.substring(0, 200);
    const topicId = uuidv4();

    // Map category to preset category
    const categoryCounts: Record<string, number> = {};
    for (const ins of extractedInsights) {
      categoryCounts[ins.suggestedCategory] = (categoryCounts[ins.suggestedCategory] || 0) + 1;
    }
    const dominantCategory = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'identity';

    const sessionId = uuidv4();
    const noteId = uuidv4();
    const noteTitle = `Import Notes: ${importedFile.filename || 'Untitled'}`;
    const noteSummary = `Insights extracted from ${importedFile.fileType} import "${importedFile.filename || 'Untitled'}". ` +
      `${extractedInsights.length} insights were identified and added to the verification queue.`;

    // Use a transaction to atomically create all related records
    const savedInsights: Array<{
      id: string;
      content: string;
      confidenceScore: number;
      verificationStatus: string;
      suggestedCategory: string;
    }> = [];

    const processImportTransaction = sqlite.transaction(() => {
      // 1. Create topic
      db.insert(topics).values({
        id: topicId,
        userId,
        title: topicTitle,
        description: `Insights automatically extracted from imported ${importedFile.fileType} content: "${importedFile.filename || 'Untitled'}"`,
        tags: JSON.stringify(['imported', importedFile.fileType]),
        status: 'extracted',
        priority: 'medium',
        intent: 'document',
        isPreset: false,
        presetCategory: dominantCategory as 'identity' | 'skills' | 'experiences' | 'perspectives' | 'goals',
      }).run();

      // 2. Create placeholder session
      db.insert(sessions).values({
        id: sessionId,
        topicId,
        userId,
        status: 'completed',
        isMiniSession: false,
        completedAt: new Date().toISOString(),
      }).run();

      // 3. Create note
      db.insert(notes).values({
        id: noteId,
        sessionId,
        topicId,
        userId,
        title: noteTitle,
        contentFullAnalysis: noteSummary,
        contentBriefSummary: noteSummary,
        selectedFormat: 'brief_summary',
      }).run();

      // 4. Create all insights
      for (const extracted of extractedInsights) {
        const insightId = uuidv4();
        db.insert(insights).values({
          id: insightId,
          noteId,
          topicId,
          userId,
          content: extracted.content,
          confidenceScore: extracted.confidenceScore,
          verificationStatus: 'unverified',
          sourceSessionId: sessionId,
        }).run();

        savedInsights.push({
          id: insightId,
          content: extracted.content,
          confidenceScore: extracted.confidenceScore,
          verificationStatus: 'unverified',
          suggestedCategory: extracted.suggestedCategory,
        });
      }

      // 5. Update the imported file's processedContent to mark it as processed
      const updatedContent = {
        ...processedContent,
        processingStatus: 'processed',
        processedInsightCount: savedInsights.length,
        processedTopicId: topicId,
        processedNoteId: noteId,
        processedAt: new Date().toISOString(),
      };

      db.update(importedFiles).set({
        processedContent: JSON.stringify(updatedContent),
      }).where(eq(importedFiles.id, importId)).run();
    });

    processImportTransaction();

    console.log(`[me.md] Processed import "${importedFile.filename}" (${importedFile.fileType}): extracted ${savedInsights.length} insights for verification`);

    res.json({
      message: `Successfully extracted ${savedInsights.length} insight(s) from imported content`,
      importId,
      insightsExtracted: savedInsights.length,
      insights: savedInsights,
      topicCreated: {
        id: topicId,
        title: topicTitle,
      },
      noteCreated: {
        id: noteId,
        title: noteTitle,
      },
    });
  } catch (error) {
    console.error('Process import error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process imported content';
    res.status(500).json({ error: message.includes('corrupted') ? message : 'Failed to process imported content' });
  }
});

// GET /api/import/:id/insights - Get insights extracted from an import
importRouter.get('/:id/insights', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const importId = req.params.id;

    // Get the imported file
    const importedFile = db.select().from(importedFiles).where(
      and(eq(importedFiles.id, importId), eq(importedFiles.userId, userId))
    ).get();

    if (!importedFile) {
      return res.status(404).json({ error: 'Imported file not found' });
    }

    // Parse processed content to find the topic
    let processedContent: Record<string, unknown> = {};
    try {
      if (importedFile.processedContent) {
        processedContent = JSON.parse(importedFile.processedContent);
      }
    } catch (parseErr) {
      console.error(`[me.md] Failed to parse processedContent for import ${importId}:`, parseErr);
      processedContent = {};
    }

    const topicId = processedContent.processedTopicId as string | undefined;
    const isProcessed = processedContent.processingStatus === 'processed';

    if (!isProcessed || !topicId) {
      return res.json({
        importId,
        isProcessed: false,
        insights: [],
        count: 0,
      });
    }

    // Get insights associated with this topic
    const importInsights = db.select().from(insights)
      .where(and(eq(insights.topicId, topicId), eq(insights.userId, userId)))
      .all();

    res.json({
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
    });
  } catch (error) {
    console.error('Get import insights error:', error);
    res.status(500).json({ error: 'Failed to get import insights' });
  }
});
