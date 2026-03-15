# Contributing to me.md

Thanks for your interest in contributing! me.md is a local-only personal knowledge system — all data stays in your browser.

## Development Setup

```bash
git clone <repo-url> && cd me.md
cd client && npm install
npm run dev
```

The app runs at [http://localhost:5173](http://localhost:5173). You'll need an [Anthropic API key](https://console.anthropic.com/) — enter it in Settings.

### MCP Server (optional)

```bash
cd mcp && npm install
npm start
```

## Architecture

- **No backend server.** All logic runs in the browser. Vite only proxies AI calls.
- **sql.js (SQLite WASM)** for data, persisted to IndexedDB via `client/src/db/persistence.ts`.
- **Drizzle ORM** for queries. Raw SQL is acceptable for schema creation (`CREATE TABLE IF NOT EXISTS`).
- **API key in localStorage** (`memd_api_key`). Never in source code or database.
- **Single user.** No multi-tenant code.

## Code Style

- ES modules (`import`/`export`), never CommonJS
- 2-space indentation
- Function components with hooks, no class components
- `async`/`await`, not `.then()` chains
- Named exports; default exports only for page components
- TypeScript strict mode

## Project Structure

```
client/src/
├── components/      # UI components by feature
├── contexts/        # React contexts (User, Database, Theme, Toast)
├── db/              # sql.js init, Drizzle schema, IndexedDB persistence
├── pages/           # Route-level page components
├── services/        # Business logic: AI prompts, CRUD, import/export
├── hooks/           # Custom React hooks
├── types/           # TypeScript type definitions
├── styles/          # Tailwind CSS
└── utils/           # Helpers
mcp/                 # Standalone MCP server for Claude Desktop/Cursor
```

## Making Changes

1. Fork the repo and create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Run `npm run build` to verify TypeScript compiles
4. Open a PR with a description of what changed and why

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Add context in the PR description for non-obvious changes
- Screenshots for UI changes are appreciated
- Don't bundle unrelated refactors with feature work

## Common Gotchas

- **CORS:** Anthropic API blocks direct browser calls. All AI requests go through the Vite proxy at `/anthropic/v1/messages`.
- **sql.js WASM:** Must load from `public/sql-wasm.wasm` before any DB operations.
- **IndexedDB:** Clearing browser data = data loss. Always test with exported backups.
- **Drizzle driver:** Use `drizzle-orm/sql-js`, not `drizzle-orm/better-sqlite3`.

## Reporting Issues

- Use GitHub Issues for bugs and feature requests
- Include browser version and steps to reproduce for bugs
- Check existing issues before opening duplicates

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
