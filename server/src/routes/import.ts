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

    const fileId = uuidv4();
    const summary = generateSummary(text.trim());

    db.insert(importedFiles).values({
      id: fileId,
      userId,
      filename: title || 'Pasted text',
      fileType: 'text',
      processedContent: JSON.stringify({
        title: title || 'Pasted text',
        summary,
        textLength: text.trim().length,
        extractedText: text.trim().substring(0, 10000),
        processedAt: new Date().toISOString(),
      }),
    }).run();

    res.json({
      message: 'Text imported successfully',
      id: fileId,
      summary,
    });
  } catch (error) {
    console.error('Import text error:', error);
    res.status(500).json({ error: 'Failed to import text' });
  }
});
