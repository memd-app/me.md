import { Router } from 'express';
import { db } from '../config/database.js';
import { importedFiles, users } from '../models/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';

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

        // Store in imported_files
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

        results.push({
          id: fileId,
          url,
          status: 'success',
          title,
          summary,
        });
      } catch (err) {
        results.push({
          url,
          id: '',
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to process URL',
        });
      }
    }

    // Update user's imported_context with a reference to the imported URLs
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      let existingContext: Array<{ type: string; url: string; title: string; importedFileId: string }> = [];
      try {
        if (user.importedContext) {
          existingContext = JSON.parse(user.importedContext);
        }
      } catch {
        existingContext = [];
      }

      const newContext = [
        ...existingContext,
        ...results
          .filter((r) => r.status === 'success')
          .map((r) => ({
            type: 'url',
            url: r.url,
            title: r.title || 'Untitled',
            importedFileId: r.id,
          })),
      ];

      db.update(users)
        .set({
          importedContext: JSON.stringify(newContext),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId))
        .run();
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

    const trimmedText = text.trim();
    const fileId = uuidv4();
    const displayTitle = title || 'Pasted text';
    const summary = generateSummary(trimmedText);

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

    // Update user's imported_context with reference to the imported text
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    if (user) {
      let existingContext: Array<{ type: string; title: string; importedFileId: string }> = [];
      try {
        if (user.importedContext) {
          existingContext = JSON.parse(user.importedContext);
        }
      } catch {
        existingContext = [];
      }

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
    }

    res.json({
      message: 'Text imported successfully',
      id: fileId,
      title: displayTitle,
      summary,
    });
  } catch (error) {
    console.error('Import text error:', error);
    res.status(500).json({ error: 'Failed to import text' });
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

        // Update user's imported_context
        const user = db.select().from(users).where(eq(users.id, userId)).get();
        if (user) {
          let existingContext: Array<{ type: string; title: string; importedFileId: string }> = [];
          try {
            if (user.importedContext) {
              existingContext = JSON.parse(user.importedContext);
            }
          } catch {
            existingContext = [];
          }

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
        }

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
        res.status(500).json({ error: 'Failed to process uploaded file' });
      }
    });
  } catch (error) {
    console.error('Import file error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});
