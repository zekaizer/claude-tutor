# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI tutor system for elementary school students (grades 1-3). Uses Claude Code CLI (`claude -p`) as backend to leverage Max subscription without additional API costs. Conversation history is stored as markdown files.

## Current Status

- **Phase 1**: ✅ Complete (Claude Bridge, Express+WebSocket, Chat UI)
- **Phase 2**: ✅ Complete (Subject selection, History, Usage limits)

## Tech Stack

- **Backend**: Node.js + TypeScript, Express + WebSocket (ws)
- **Frontend**: Vanilla HTML/CSS/JS
- **Core**: Claude Code CLI subprocess (`claude -p --output-format stream-json --verbose`)
- **Data**: Markdown files in `~/tutor-history/`

## Key Design Decisions

- CLI approach chosen over Agent SDK to utilize Max subscription
- Session management via `--continue` flag
- Tool restrictions via `--disallowedTools` for child safety
- 200 requests/day limit (configurable in usage-limiter.ts)

## Project Structure

```
tutor-server/
├── src/
│   ├── index.ts              # Express + WebSocket server
│   ├── types/index.ts        # TypeScript types
│   ├── services/
│   │   ├── claude-bridge.ts  # CLI subprocess management
│   │   ├── history-writer.ts # Markdown history storage
│   │   └── usage-limiter.ts  # Daily request limiting
│   └── prompts/              # Subject-specific prompts
│       ├── base-tutor.md
│       ├── math-tutor.md
│       ├── science-tutor.md
│       ├── english-tutor.md
│       └── korean-tutor.md
└── public/                   # Frontend static files
```

## Build Commands

```bash
cd tutor-server

# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Type check
npx tsc --noEmit

# Build for production
npm run build

# Run production build
npm start
```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/usage` - Daily usage info
- `POST /api/reset` - Reset Claude session
- `GET /api/history/:date` - List history files
- `GET /api/history/:date/:sessionId` - Get history content

## Git Workflow

- **Branch strategy**: Simple branch approach (no worktree)
- **Branch naming**: `feature/phase1-mvp`, `feature/phase2`, etc.
- **Merge**: To main after each phase completion
- **Tags**: `v0.1.0`, `v0.2.0`, etc.
