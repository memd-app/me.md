# me.md

AI-guided personal knowledge system. Build a verified knowledge graph of yourself through interview-style sessions with Claude. All data stays local in your browser.

## Quick Start

```bash
git clone <repo> && cd me.md
cd client && npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) and enter your Anthropic API key in Settings.

## Features

- **Topics & interviews** — organize knowledge by life areas and explore them through guided conversations
- **AI-powered sessions** — Claude conducts interviews, asks follow-ups, and synthesizes what it learns
- **Insight extraction & verification** — AI-generated facts are surfaced for you to confirm, edit, or reject
- **Knowledge graph visualization** — interactive D3.js graph of your verified facts and their connections
- **Big Five personality assessment** — AI-driven personality profiling based on your interviews
- **Session notes with 4 formats** — structured summaries in multiple styles for every session
- **AI sandbox comparison** — test prompts with and without your knowledge graph as context
- **Full-text search** — search across all your facts, sessions, and notes
- **Data import** — bring in content from files, URLs, and ChatGPT exports
- **Database export/import** — full backup and restore of your entire knowledge base

## Data Safety

All data lives in your browser's IndexedDB. You can export backups from the Settings page at any time.

**Warning:** Clearing your browser data will permanently delete your knowledge base. Export regularly.

## MCP Server

Use your knowledge graph as context in Claude Desktop or Cursor:

1. Export your database from Settings
2. Save it as `~/.memd/memd.db`
3. Add to your Claude Desktop or Cursor config:

```json
{
  "mcpServers": {
    "memd": {
      "command": "npx",
      "args": ["tsx", "/path/to/me.md/mcp/mcp-server.ts"]
    }
  }
}
```

## Tech Stack

- React 18 + TypeScript
- Vite 5
- Tailwind CSS
- sql.js (SQLite compiled to WASM, runs in browser)
- Drizzle ORM
- D3.js
- Claude API (via Vite dev proxy)

## License

[MIT](LICENSE)
