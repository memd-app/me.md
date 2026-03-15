# me.md MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes your me.md knowledge graph to AI tools like Claude Desktop and Cursor.

## How It Works

The MCP server reads your exported me.md database (`~/.memd/memd.db`) and provides your verified personal insights as context to any MCP-compatible AI tool. This means Claude, Cursor, and other tools can write, decide, and respond as if they know you — because they do.

## Setup

### 1. Export Your Database

In me.md, go to **Settings > Export for MCP**. This saves your database to `~/.memd/memd.db`.

### 2. Install Dependencies

```bash
cd mcp
npm install
```

### 3. Configure Your AI Tool

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "me-md": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/me.md/mcp/mcp-server.ts"]
    }
  }
}
```

#### Cursor

Add to your Cursor MCP settings (Settings > MCP):

```json
{
  "me-md": {
    "command": "npx",
    "args": ["tsx", "/absolute/path/to/me.md/mcp/mcp-server.ts"]
  }
}
```

#### Custom Database Path

If your database is not at the default `~/.memd/memd.db`:

```json
{
  "me-md": {
    "command": "npx",
    "args": ["tsx", "/path/to/mcp-server.ts", "--db-path", "/path/to/memd.db"]
  }
}
```

## What's Exposed

### Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Profile | `user://profile` | Your complete verified profile with insights and personality data |
| Knowledge | `user://knowledge/{topicId}` | Topic-level insights and notes |
| Personality | `user://personality` | Big Five personality assessment data |

### Tools

| Tool | Description |
|------|-------------|
| `search_knowledge` | Keyword search across all verified insights |
| `get_context_summary` | Portable markdown summary of your entire knowledge graph |

## Privacy

- The server runs **locally** — your data never leaves your machine
- Only insights marked as **"exportable"** are included
- The database is opened **read-only** — the MCP server cannot modify your data
- Re-export from me.md anytime to update the MCP server's data

## Running Manually

```bash
npx tsx mcp-server.ts
npx tsx mcp-server.ts --db-path /custom/path/memd.db
```

The server communicates via stdio (MCP standard) — it's not an HTTP server.
