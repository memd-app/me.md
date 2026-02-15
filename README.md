# me.md

**Your Verified Personal Context for AI**

me.md is a personal knowledge system that helps users build, verify, and manage a comprehensive understanding of themselves through AI-guided conversations — designed to be consumed by AI agents as portable, verified personal context.

## What It Does

1. **Create** — AI-guided interviews using proven questioning methodologies (Socratic, Clean Language, Appreciative Inquiry) to actively extract personal knowledge
2. **Verify** — Human-in-the-loop verification of every insight with approve/reject/edit actions
3. **Manage** — A living knowledge graph and exportable personal context (me.md file) that makes any AI tool write, decide, and act like you

## Tech Stack

- **Frontend:** React + TypeScript, Tailwind CSS, D3.js (knowledge graph), Vite
- **Backend:** Node.js + Express, TypeScript
- **Database:** SQLite with Drizzle ORM
- **Auth:** Firebase Authentication (Google Sign-In + Email/Password)
- **AI:** Anthropic Claude Sonnet 4.5 via API
- **MCP:** Model Context Protocol server for sharing verified context with AI agents

## Getting Started

### Prerequisites

- Node.js 20+
- Firebase project with Auth configured
- Anthropic API key

### Setup

1. Clone the repository
2. Copy `.env.example` to `server/.env` and fill in your API keys
3. Run the init script:

```bash
chmod +x init.sh
./init.sh
```

This will:
- Install all dependencies (root, client, server)
- Set up the SQLite database with schema
- Start both frontend and backend dev servers

### Access

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000
- **Health Check:** http://localhost:3000/api/health

## Project Structure

```
me.md-autoforge/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components by feature area
│   │   │   ├── auth/       # Login, register, password reset
│   │   │   ├── chat/       # Interview session chat interface
│   │   │   ├── dashboard/  # Dashboard stats and activity
│   │   │   ├── graph/      # D3.js knowledge graph
│   │   │   ├── layout/     # Sidebar, header, app layout
│   │   │   ├── onboarding/ # Onboarding wizard steps
│   │   │   ├── profile/    # Auto-generated profile summary
│   │   │   ├── sandbox/    # Context testing sandbox
│   │   │   ├── search/     # Global search interface
│   │   │   ├── settings/   # User settings and preferences
│   │   │   ├── topics/     # Topic management
│   │   │   ├── verification/ # Insight verification queue
│   │   │   ├── bookmarks/  # Saved aha moments
│   │   │   ├── export/     # Export options
│   │   │   ├── notes/      # Distilled session notes
│   │   │   └── common/     # Shared/reusable components
│   │   ├── contexts/       # React Context providers
│   │   ├── hooks/          # Custom React hooks
│   │   ├── pages/          # Page-level components
│   │   ├── services/       # API client services
│   │   ├── styles/         # Global CSS and Tailwind config
│   │   ├── types/          # TypeScript type definitions
│   │   └── utils/          # Utility functions
│   ├── index.html
│   ├── tailwind.config.js
│   └── vite.config.ts
├── server/                 # Node.js/Express backend
│   ├── src/
│   │   ├── routes/         # Express route definitions
│   │   ├── controllers/    # Request handlers
│   │   ├── middleware/     # Auth, validation, error handling
│   │   ├── services/       # Business logic
│   │   ├── models/         # Drizzle ORM schema
│   │   ├── config/         # Database, Firebase config
│   │   └── utils/          # Utility functions
│   ├── drizzle/            # Database migrations
│   └── data/               # SQLite database files (gitignored)
├── shared/                 # Shared types between client and server
│   └── types/
├── init.sh                 # Development setup script
└── package.json            # Root package with dev scripts
```

## Key Features

- **AI Interview Engine:** Multi-methodology questioning with streaming responses
- **Quick Replies:** 3 personalized first-person suggestions per AI response
- **Session Bookmarks:** Star "aha moments" during interviews
- **Multi-Format Distillation:** Full Analysis, Brief Summary, Decision Framework, JSON
- **Cross-Topic Intelligence:** AI detects and links related insights across topics
- **Verification System:** Swipe-card interface with confidence scores and agreement scales
- **Conflict Detection:** Automatic detection of contradictory insights
- **Knowledge Graph:** Interactive D3.js force-directed visualization
- **Re-Verification:** Time-based re-checks for situational, preference, and core traits
- **MCP Server:** Share verified context with any MCP-compatible AI agent
- **Context Sandbox:** Test prompts with vs without your context side-by-side
- **Dark/Light Mode:** Full theme support with persisted preference
- **Responsive Design:** Desktop, tablet, and mobile optimized

## Development

```bash
# Start development (both frontend + backend)
./init.sh

# Or start individually
npm run dev:server   # Backend on port 3000
npm run dev:client   # Frontend on port 5173

# Database migrations
npm run db:generate  # Generate migration from schema changes
npm run db:migrate   # Apply migrations
```
