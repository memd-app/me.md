#!/usr/bin/env node
/**
 * me.md MCP Server
 *
 * A proper Model Context Protocol server that exposes personal knowledge
 * via the MCP protocol using StdioServerTransport. External AI tools like
 * Claude Desktop, Cursor, etc. can connect to this server.
 *
 * Usage:
 *   npx tsx server/src/mcp-server.ts --user-id <USER_ID>
 *
 * Configuration for Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "me-md": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/server/src/mcp-server.ts", "--user-id", "YOUR_USER_ID"]
 *     }
 *   }
 * }
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { z } from 'zod';

// ============================================
// Parse command-line arguments
// ============================================
function parseArgs(): { userId: string } {
  const args = process.argv.slice(2);
  let userId = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user-id' && args[i + 1]) {
      userId = args[i + 1];
      i++;
    }
  }

  if (!userId) {
    // Write errors to stderr so they don't interfere with MCP protocol on stdout
    process.stderr.write('Error: --user-id argument is required\n');
    process.stderr.write('Usage: npx tsx server/src/mcp-server.ts --user-id <USER_ID>\n');
    process.exit(1);
  }

  return { userId };
}

const { userId } = parseArgs();

// ============================================
// Database setup (shared with Express server)
// ============================================
const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname_local, '..', 'data', 'memd.db');

if (!fs.existsSync(DB_PATH)) {
  process.stderr.write(`Error: Database not found at ${DB_PATH}\n`);
  process.stderr.write('Make sure the me.md server has been started at least once to create the database.\n');
  process.exit(1);
}

const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Verify user exists
const userRow = sqlite.prepare('SELECT id, name, email, occupation, location FROM users WHERE id = ?').get(userId) as {
  id: string;
  name: string;
  email: string;
  occupation: string;
  location: string;
} | undefined;

if (!userRow) {
  process.stderr.write(`Error: User with ID '${userId}' not found in database\n`);
  process.exit(1);
}

process.stderr.write(`[me.md MCP] Starting MCP server for user: ${userRow.name} (${userRow.email})\n`);

// ============================================
// Database query helpers
// ============================================

interface InsightRow {
  id: string;
  content: string;
  confidenceScore: number;
  verifiedAt: string | null;
  topicTitle: string | null;
  topicId: string | null;
  privacyTier: string;
}

interface TopicRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  tags: string | null;
  intent: string | null;
}

interface NoteRow {
  id: string;
  title: string | null;
  selectedFormat: string | null;
  createdAt: string | null;
}

function getVerifiedExportableInsights(): InsightRow[] {
  return sqlite.prepare(`
    SELECT
      i.id, i.content, i.confidence_score as confidenceScore,
      i.verified_at as verifiedAt, i.privacy_tier as privacyTier,
      t.title as topicTitle, t.id as topicId
    FROM insights i
    LEFT JOIN topics t ON i.topic_id = t.id
    WHERE i.user_id = ?
      AND i.verification_status = 'verified'
      AND i.privacy_tier = 'exportable'
    ORDER BY i.confidence_score DESC
  `).all(userId) as InsightRow[];
}

function getUserTopics(): TopicRow[] {
  return sqlite.prepare(`
    SELECT id, title, description, status, tags, intent
    FROM topics
    WHERE user_id = ?
  `).all(userId) as TopicRow[];
}

function getTopicById(topicId: string): TopicRow | undefined {
  return sqlite.prepare(`
    SELECT id, title, description, status, tags, intent
    FROM topics
    WHERE id = ? AND user_id = ?
  `).get(topicId, userId) as TopicRow | undefined;
}

function getTopicInsights(topicId: string): InsightRow[] {
  return sqlite.prepare(`
    SELECT
      i.id, i.content, i.confidence_score as confidenceScore,
      i.verified_at as verifiedAt, i.privacy_tier as privacyTier,
      t.title as topicTitle, t.id as topicId
    FROM insights i
    LEFT JOIN topics t ON i.topic_id = t.id
    WHERE i.topic_id = ?
      AND i.user_id = ?
      AND i.verification_status = 'verified'
      AND i.privacy_tier = 'exportable'
    ORDER BY i.confidence_score DESC
  `).all(topicId, userId) as InsightRow[];
}

function getTopicNotes(topicId: string): NoteRow[] {
  return sqlite.prepare(`
    SELECT id, title, selected_format as selectedFormat, created_at as createdAt
    FROM notes
    WHERE topic_id = ? AND user_id = ?
    ORDER BY created_at DESC
  `).all(topicId, userId) as NoteRow[];
}

function searchInsights(query: string): InsightRow[] {
  const searchPattern = `%${query}%`;
  return sqlite.prepare(`
    SELECT
      i.id, i.content, i.confidence_score as confidenceScore,
      i.verified_at as verifiedAt, i.privacy_tier as privacyTier,
      t.title as topicTitle, t.id as topicId
    FROM insights i
    LEFT JOIN topics t ON i.topic_id = t.id
    WHERE i.user_id = ?
      AND i.verification_status = 'verified'
      AND i.privacy_tier = 'exportable'
      AND i.content LIKE ?
    ORDER BY i.confidence_score DESC
    LIMIT 50
  `).all(userId, searchPattern) as InsightRow[];
}

// ============================================
// Create MCP Server
// ============================================
const server = new McpServer(
  {
    name: 'me-md',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
    instructions: `me.md Personal Knowledge Server for ${userRow.name}. This server provides access to verified personal insights and knowledge gathered through AI-guided self-discovery conversations. Use the resources to read profile and topic-level knowledge. Use the tools to search across all knowledge or get a portable context summary.`,
  }
);

// ============================================
// Resources
// ============================================

// Resource: user://profile
// Serves verified profile context as structured data
server.resource(
  'profile',
  'user://profile',
  {
    description: `Verified personal profile and insights for ${userRow.name}`,
    mimeType: 'application/json',
  },
  async (uri) => {
    const verifiedInsights = getVerifiedExportableInsights();
    const userTopics = getUserTopics();

    const profileContext = {
      uri: 'user://profile',
      resourceType: 'profile',
      userName: userRow.name,
      email: userRow.email,
      occupation: userRow.occupation,
      location: userRow.location,
      generatedAt: new Date().toISOString(),
      totalVerifiedInsights: verifiedInsights.length,
      topicsExplored: userTopics.length,
      insights: verifiedInsights.map(i => ({
        id: i.id,
        content: i.content,
        topicTitle: i.topicTitle,
        confidenceScore: i.confidenceScore,
        verifiedAt: i.verifiedAt,
      })),
      topics: userTopics.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        tags: t.tags ? JSON.parse(t.tags) : [],
      })),
    };

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(profileContext, null, 2),
        },
      ],
    };
  }
);

// Resource Template: user://knowledge/{topicId}
// Serves topic-level knowledge and insights
server.resource(
  'knowledge',
  new ResourceTemplate('user://knowledge/{topicId}', { list: async () => {
    // List all topics as available resources
    const userTopics = getUserTopics();
    return {
      resources: userTopics.map(t => ({
        uri: `user://knowledge/${t.id}`,
        name: t.title,
        description: t.description || `Knowledge about ${t.title}`,
        mimeType: 'application/json',
      })),
    };
  }}),
  {
    description: 'Knowledge and verified insights for a specific topic',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const topicId = variables.topicId as string;

    const topic = getTopicById(topicId);
    if (!topic) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Topic not found' }),
          },
        ],
      };
    }

    const topicInsights = getTopicInsights(topicId);
    const topicNotes = getTopicNotes(topicId);

    const knowledgeContext = {
      uri: `user://knowledge/${topicId}`,
      resourceType: 'knowledge',
      topic: {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        status: topic.status,
        tags: topic.tags ? JSON.parse(topic.tags) : [],
        intent: topic.intent,
      },
      verifiedInsights: topicInsights.map(i => ({
        id: i.id,
        content: i.content,
        confidenceScore: i.confidenceScore,
        verifiedAt: i.verifiedAt,
      })),
      notes: topicNotes.map(n => ({
        id: n.id,
        title: n.title,
        format: n.selectedFormat,
        createdAt: n.createdAt,
      })),
      generatedAt: new Date().toISOString(),
    };

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(knowledgeContext, null, 2),
        },
      ],
    };
  }
);

// ============================================
// Tools
// ============================================

// Tool: search_knowledge
// Semantic search across verified insights
server.tool(
  'search_knowledge',
  'Search across all verified personal insights by keyword. Returns matching insights with confidence scores and topic context.',
  {
    query: z.string().describe('The search query to find relevant insights'),
  },
  async ({ query }) => {
    if (!query || !query.trim()) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'Search query is required' }),
          },
        ],
        isError: true,
      };
    }

    const results = searchInsights(query.trim());

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'search_knowledge',
            query: query.trim(),
            results: results.map(r => ({
              id: r.id,
              content: r.content,
              confidenceScore: r.confidenceScore,
              verifiedAt: r.verifiedAt,
              topicTitle: r.topicTitle,
              topicId: r.topicId,
            })),
            totalResults: results.length,
          }, null, 2),
        },
      ],
    };
  }
);

// Tool: get_context_summary
// Returns portable me.md context as markdown
server.tool(
  'get_context_summary',
  'Get a portable markdown summary of all verified personal context. Useful for providing personal context to other AI tools.',
  async () => {
    const verifiedInsights = getVerifiedExportableInsights();

    // Group insights by topic
    const insightsByTopic: Record<string, string[]> = {};
    for (const insight of verifiedInsights) {
      const topicName = insight.topicTitle || 'General';
      if (!insightsByTopic[topicName]) {
        insightsByTopic[topicName] = [];
      }
      insightsByTopic[topicName].push(insight.content);
    }

    // Generate markdown summary
    const lines: string[] = [];
    lines.push(`# ${userRow.name}'s Personal Context`);
    lines.push('');
    lines.push(`> ${userRow.occupation || 'Unknown occupation'} based in ${userRow.location || 'Unknown location'}`);
    lines.push(`> ${verifiedInsights.length} verified insights`);
    lines.push('');

    for (const [topic, topicInsights] of Object.entries(insightsByTopic)) {
      lines.push(`## ${topic}`);
      lines.push('');
      for (const insight of topicInsights) {
        lines.push(`- ${insight}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*Generated by me.md*');

    const markdown = lines.join('\n');

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            tool: 'get_context_summary',
            format: 'markdown',
            content: markdown,
            totalInsights: verifiedInsights.length,
            topics: Object.keys(insightsByTopic),
          }, null, 2),
        },
      ],
    };
  }
);

// ============================================
// Start server with stdio transport
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[me.md MCP] Server started and ready for connections\n');
}

main().catch((error) => {
  process.stderr.write(`[me.md MCP] Fatal error: ${error}\n`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  process.stderr.write('[me.md MCP] Shutting down...\n');
  sqlite.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  process.stderr.write('[me.md MCP] Shutting down...\n');
  sqlite.close();
  process.exit(0);
});
