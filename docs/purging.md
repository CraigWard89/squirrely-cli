# Purging Log: Project Rework

This document tracks obsolete or old features, codebases, and configurations that are being removed during the massive project rework.

## Overview
As we refactor and streamline Squirrely, we are aggressively "purging" legacy components to reduce complexity and technical debt.

---

## Purged Features & Code

### [Date: 2026-02-26] - Initial Setup
- Started the purging log to track removals during the massive rework.
- **IDE Companion**: Removed `packages/vscode-ide-companion` and `packages/a2a-server`.
- **Policy Engine**: Removed `packages/core/src/policy` and `packages/core/src/safety`.
- **Sandbox Functionality**: Removed Docker/Podman related files (`Dockerfile`, `build_sandbox.js`, etc.) and configurations.
- **Test Purge**: All `*.test.ts` and `*.test.tsx` files have been removed from the `squirrely-cli` directory.
- **Test Related Configurations**: Removed `vitest.config.ts` files, `junit.xml`, and test-related scripts from `package.json` (partial).
- **Test-Utils**: Removed `packages/test-utils`.

---

## Pending Purge
*Items identified for removal but not yet executed.*

- **Legacy Configs**: Remaining sandbox and policy related configuration files and scripts in `package.json` and other locations are slated for removal.
