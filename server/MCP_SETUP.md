# me.md MCP Server Setup Guide

## Overview

me.md exposes your verified personal knowledge through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), allowing external AI tools like Claude Desktop, Cursor, and other MCP-compatible clients to access your personal context.

The MCP server runs as a **separate process** using stdio transport. MCP clients spawn the server process and communicate with it over stdin/stdout.

## Prerequisites

- Node.js 20+
- The me.md server must have been started at least once to create the database
- Your user ID (found in the me.md web app settings or database)

## Configuration

### Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "me-md": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/me.md/server/src/mcp-server.ts",
        "--user-id",
        "YOUR_USER_ID"
      ]
    }
  }
}
```

Replace:
- `/absolute/path/to/me.md/` with the actual path to your me.md installation
- `YOUR_USER_ID` with your me.md user ID

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json` in your workspace or global config):

```json
{
  "mcpServers": {
    "me-md": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/me.md/server/src/mcp-server.ts",
        "--user-id",
        "YOUR_USER_ID"
      ]
    }
  }
}
```

### Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "me-md": {
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/me.md/server/src/mcp-server.ts",
        "--user-id",
        "YOUR_USER_ID"
      ]
    }
  }
}
```

## Available Resources

### `user://profile`
Returns your complete verified profile context including:
- Basic profile information (name, email, occupation, location)
- All verified exportable insights with confidence scores
- Topics explored with status and tags

### `user://knowledge/{topicId}`
Returns topic-specific knowledge including:
- Topic details (title, description, status, tags, intent)
- Verified insights for that topic
- Associated notes

## Available Tools

### `search_knowledge`
Search across all verified personal insights by keyword.

**Parameters:**
- `query` (string, required): The search query to find relevant insights

**Returns:** Matching insights with confidence scores and topic context.

### `get_context_summary`
Get a portable markdown summary of all verified personal context. Useful for providing personal context to other AI tools.

**Parameters:** None

**Returns:** Markdown-formatted summary of your verified insights organized by topic.

## Security Notes

- The MCP server opens the database in **read-only mode** - it cannot modify your data
- Only **verified** insights with **exportable** privacy tier are exposed
- Insights marked as `never_export` are never included in MCP responses
- The server requires a valid `--user-id` to start, limiting access to a single user's data
- MCP access permissions configured in the web UI control which agents can access your data via the REST API; the stdio MCP server currently serves data for the specified user directly

## Troubleshooting

### Server won't start
- Ensure the database exists at `server/data/memd.db` (start the web app first)
- Verify the user ID is correct
- Check that `tsx` is available: `npx tsx --version`

### No data showing
- Verify you have verified insights with "exportable" privacy tier
- Check that topics exist for the specified user

### Logs
The MCP server writes diagnostic logs to stderr (not visible to MCP clients but available in terminal):
```
[me.md MCP] Starting MCP server for user: John Doe (john@example.com)
[me.md MCP] Server started and ready for connections
```
