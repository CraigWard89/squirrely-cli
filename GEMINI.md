# Gemini CLI Project Context

Gemini CLI is an open-source AI agent that brings the power of Gemini directly
into the terminal. It is designed to be a terminal-first, extensible, and
powerful tool for developers.

## Efficiency Guidelines

- **Maximize Efficiency:** Always aim to be efficient and fast. Minimize the number of turns by executing multiple tool calls in parallel and avoiding redundant operations.
- **Avoid Meaningless Tool Calls:** Do not call tools in silence or perform repetitive, low-signal operations. Every tool call should have a clear purpose and intent.
- **Strategic Planning:** Plan ahead and carefully consider your next moves before executing changes. Use `enter_plan_mode` for complex designs.
- **Update Indexes and Outlines:** Proactively improve and update the `INDEX.md`, `GEMINI.md`, and other outline files to reflect the current state and structure.
- **High-Signal Reads:** Use `context`, `before`, and `after` parameters in `grep_search` to gather enough information for an edit without needing a separate `read_files` call.
- **Tool Consolidation:** Try to keep tools as minimal and consolidated as possible to prevent unwanted token usage (e.g., combining single and multi-file read operations).

## Project Mandates

- **Workspace Exit Checker:** The agent uses an interactive "Workspace Exit Checker" (`checkWorkspaceExit`) whenever it attempts to access files outside the workspace or project temp directory. It will explicitly ask for your permission before proceeding. Hard-coded path restrictions have been removed in favor of this interactive check.
- **ReadFolder (LS):** This tool provides detailed directory listings and improved error messages for missing or inaccessible paths.
- **Massive Purge:** All `test.ts` files, `test-utils`, `policy`, `safety`, and `sandbox` components are obsolete and must be deleted whenever they are encountered as part of the project rework.
- **Obey Purging Log:** Always refer to and follow the instructions in `docs/purging.md`.

## Project Overview

- **Purpose:** Provide a seamless terminal interface for Gemini models,
  supporting code understanding, generation, automation, and integration via MCP
  (Model Context Protocol).
- **Main Technologies:**
  - **Runtime:** Node.js (>=20.0.0, recommended ~20.19.0 for development)
  - **Language:** TypeScript
  - **UI Framework:** React (using [Ink](https://github.com/vadimdemedes/ink)
    for CLI rendering)
  - **Bundling:** esbuild
  - **Linting/Formatting:** ESLint, Prettier
- **Architecture:** Monorepo structure using npm workspaces.
  - `packages/cli`: User-facing terminal UI, input processing, and display
    rendering.
  - `packages/core`: Backend logic, Gemini API orchestration, prompt
    construction, and tool execution.
  - `packages/core/src/tools/`: Built-in tools for file system, shell, and web
    operations.

## Building and Running

- **Install Dependencies:** `npm install`
- **Build Packages:** `npm run build`
- **Run in Development:** `npm run start`
- **Run in Debug Mode:** `npm run debug` (Enables Node.js inspector)
- **Bundle Project:** `npm run bundle`
- **Clean Artifacts:** `npm run clean`

## Development Conventions

- **Legacy Snippets:** `packages/core/src/prompts/snippets.legacy.ts` is a
  snapshot of an older system prompt. Avoid changing the prompting verbiage to
  preserve its historical behavior; however, structural changes to ensure
  compilation or simplify the code are permitted.
- **Contributions:** Follow the process outlined in `CONTRIBUTING.md`. Requires
  signing the Google CLA.
- **Pull Requests:** Keep PRs small, focused, and linked to an existing issue.
  Always activate the `pr-creator` skill for PR generation, even when using the
  `gh` CLI.
- **Commit Messages:** Follow the
  [Conventional Commits](https://www.conventionalcommits.org/) standard.
- **Coding Style:** Adhere to existing patterns in `packages/cli` (React/Ink)
  and `packages/core` (Backend logic).
- **Imports:** Use specific imports and avoid restricted relative imports
  between packages (enforced by ESLint).
- **License Headers:** For all new source code files (`.ts`, `.tsx`, `.js`),
  include the Apache-2.0 license header with the current year. (e.g.,
  `Copyright 2026 Google LLC`). This is enforced by ESLint.

## Documentation

- Always use the `docs-writer` skill when you are asked to write, edit, or
  review any documentation.
- Documentation is located in the `docs/` directory.
- Always keep the changelog in `docs/changelogs/` up to date and current.
- Suggest documentation updates when code changes render existing documentation
  obsolete or incomplete.
