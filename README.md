# me.md

An open-source experiment in verified personal context for AI. The interviewer draws your story out one conversation at a time; you verify every extracted insight before it becomes part of your profile; the result is portable context any AI tool can use. Everything runs in your browser — there are no servers and no accounts.

## How it works

1. **Interview** — pick a topic (career turning points, core values, how you decide) and talk. The interviewer follows threads, asks one question at a time, and adapts to what you say.
2. **Review** — the insights it extracts land in a queue. You verify, edit, or reject each one. Nothing enters your profile without your sign-off.
3. **Use** — your verified knowledge becomes a living profile: chat with it, export it, or sync it into your Obsidian vault.

## Features

### Talking
- **Interviews** — AI-guided sessions with a conversational host: thread-following questions, natural quick replies, voice input, pause and resume. Sessions distill into structured notes.
- **Converse** — freeform chat grounded in your verified knowledge, in two modes: *Assistant* (an assistant that knows you and cites which insights inform its answers) and *Me* (the model speaks as you, first person, strictly within what you've verified).

### Knowing
- **Review queue** — verify, edit, or reject extracted insights with keyboard-first triage. Confidence scores and source references on every card.
- **About me** — a two-register portrait synthesized from your verified insights: an analytical essay for you, an agent brief you can hand to any AI.
- **Personality** — three validated assessments: Big Five (IPIP-NEO), RIASEC interests (O*NET Interest Profiler), and a guided Schwartz values interview.
- **Notes & bookmarks** — distilled session notes and the transcript moments you starred, in one place.
- **Search** — across topics, insights, transcripts, and notes.

### Keeping
- **Vault** — your profile as Markdown or JSON, and an Obsidian export with graph links between notes. With a local vault connected, changes write through as you verify — updates in place; never deletes your files.
- **Import** — seed your knowledge base from files, pasted text, URLs, or a ChatGPT memory export.
- **MCP server** — serve your verified knowledge to Claude Desktop or Cursor (setup below).
- **Backups** — full database export and restore from Settings.

## Quick start

```bash
git clone https://github.com/memd-app/me.md && cd me.md
cd client && npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and add your Anthropic API key in Settings. The key stays in your browser's localStorage and is sent only to Anthropic's API, directly from your browser. Without a key, interviews fall back to template questions — you can try the flow before committing.

## Data safety

All data lives in your browser's IndexedDB. There is no sync, no telemetry, and no network traffic with your data except the Anthropic API calls you make with your own key. Fonts are self-hosted; the app makes no third-party requests.

Two boundaries to know:

- **Clearing browser data deletes your knowledge base.** Export backups from Settings regularly, or keep an Obsidian vault connected.
- **Storage and exports are unencrypted.** Backups contain your personal knowledge in plain form — store and share them accordingly.

## MCP server

Serve your verified knowledge to Claude Desktop or Cursor. Only insights you've verified and marked exportable are visible.

1. Export your database from Settings and save it as `~/.memd/memd.db`
2. Add to your Claude Desktop or Cursor config:

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

## Tech

React 18 + TypeScript, Vite, Tailwind CSS, sql.js (SQLite in WASM) persisted to IndexedDB, Drizzle ORM, and the Claude API called directly from the browser with your own key. File System Access API for the Obsidian write-through.

## License

[MIT](LICENSE)
