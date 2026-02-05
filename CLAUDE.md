# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI tutor system for elementary school students (grades 1-3). Uses Claude Code CLI (`claude -p`) as backend to leverage Max subscription without additional API costs. Conversation history is stored as markdown files.

## Current Status

This project is in the **design phase**. See [docs/design.md](docs/design.md) for the complete architecture specification.

## Planned Tech Stack

- **Backend**: Node.js + TypeScript, Express or Fastify
- **Frontend**: React (optional) or vanilla HTML/CSS/JS
- **Core**: Claude Code CLI subprocess management (`claude -p --output-format stream-json`)
- **Deployment**: Docker + Docker Compose

## Key Design Decisions

- CLI approach chosen over Agent SDK to utilize Max subscription
- Session management via `--continue` flag (verified working)
- History stored as markdown files in `~/tutor-history/`
- Tool restrictions via `--disallowedTools` for safety

## Git Workflow

- **Branch strategy**: Simple branch approach (no worktree)
- **Branch naming**: `feature/phase1-mvp`, `feature/phase2`, etc.
- **Merge**: To main after each phase completion
- **Tags**: `v0.1.0`, `v0.2.0`, etc.

## Build Commands

*Commands will be added once implementation begins.*

```bash
# Placeholder - to be updated after Phase 1 implementation
npm install
npm run dev
npm run build
npm test
```
