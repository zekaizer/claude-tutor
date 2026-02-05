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
- Session management via `--resume` flag
- History stored as markdown files in `~/tutor-history/`
- Tool restrictions via `--allowedTools none` for safety

## Build Commands

*Commands will be added once implementation begins.*

```bash
# Placeholder - to be updated after Phase 1 implementation
npm install
npm run dev
npm run build
npm test
```
