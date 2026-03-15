# me.md

**Build a verified knowledge graph of yourself. Make any AI tool write, decide, and act like you.**

me.md is a local-first personal knowledge system. AI-guided interviews help you discover and verify what makes you *you* — your values, communication style, decision-making patterns, strengths, and personality. The result is a portable context file that makes ChatGPT, Claude, Cursor, and any AI tool genuinely personalized.

> All data stays in your browser. No accounts. No servers. No data leaves your machine unless you export it.

## Why

AI tools are powerful but generic. They don't know you. me.md fixes that by building verified personal context through structured self-discovery — not passive memory, but active interview sessions that surface genuine insights about who you are.

The result: a `me.md` file you can drop into any AI tool to get responses that sound like you, think like you, and prioritize like you.

## Quick Start

```bash
git clone https://github.com/memd-app/me.md.git && cd me.md
cd client && npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and enter your [Anthropic API key](https://console.anthropic.com/) in Settings.

## Features

### Self-Discovery
- **AI-guided interviews** — Claude conducts structured conversations using Socratic, Clean Language, and Appreciative Inquiry methods
- **Topics** — organize knowledge by life areas (career, values, communication, goals)
- **Interview packs** — pre-built question sets for specific use cases (email writing, management style, developer identity)
- **Big Five personality assessment** — IPIP NEO-PI-R 120-item assessment with domain and facet scoring

### Knowledge Management
- **Insight extraction** — AI identifies personal facts from your conversations
- **Human-in-the-loop verification** — confirm, edit, or reject every AI-generated insight
- **Knowledge graph** — interactive D3.js visualization of your verified facts and connections
- **Privacy tiers** — control what's exportable vs. private per-insight
- **Full-text search** across all facts, sessions, and notes

### Export & Integration
- **me.md** — portable markdown profile for any AI tool
- **ChatGPT Custom Instructions** — formatted for ChatGPT personalization
- **CLAUDE.md** — project context file for Claude Code
- **.cursorrules** — context file for Cursor AI
- **JSON export** — complete structured data export
- **Graph PNG export** — shareable visualization of your knowledge graph
- **MCP server** — connect your knowledge graph to Claude Desktop and Cursor

### Data Import
- **ChatGPT memory** — extract what ChatGPT already knows about you
- **LinkedIn data export** — import your professional profile
- **Resume / CV** — upload PDF resumes for insight extraction
- **URLs, text, files** — import from any source

## Data Safety

All data lives in your browser's IndexedDB. Export backups from Settings at any time.

**Warning:** Clearing your browser data will delete your knowledge base. Export regularly.

## MCP Server

Use your knowledge graph as live context in Claude Desktop or Cursor. See [mcp/README.md](mcp/README.md) for setup instructions.

```json
{
  "mcpServers": {
    "me-md": {
      "command": "npx",
      "args": ["tsx", "/path/to/me.md/mcp/mcp-server.ts"]
    }
  }
}
```

## Tech Stack

- React 18 + TypeScript + Vite 5 + Tailwind CSS
- sql.js (SQLite WASM in browser) + Drizzle ORM
- D3.js for knowledge graph visualization
- Claude API via Vite dev proxy

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
