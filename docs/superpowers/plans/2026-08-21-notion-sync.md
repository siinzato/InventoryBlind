# InventoryBlind Notion Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize InventoryBlind GitHub commits and meaningful local deltas into the existing Notion product databases.

**Architecture:** A dependency-free Node.js script upserts GitHub commits into the Notion updates data source by SHA. A GitHub Actions workflow invokes it on pushes to `main`; a six-hour Codex heartbeat handles local-only changes and reconciliation through the connected GitHub and Notion tools.

**Tech Stack:** Node.js 22, native `fetch`, `node:test`, GitHub Actions, Notion API 2025-09-03, Codex scheduled tasks.

**Spec:** `docs/notion-sync.md`

## Global Constraints

- Do not modify InventoryBlind application behavior.
- Do not commit credentials.
- Do not mark records as validated or modules as production automatically.
- Prefer commit/diff deltas over full-repository scans.
- Preserve all unrelated local changes.

---

### Task 1: Notion payload and classification logic

**Files:**
- Create: `scripts/notion-sync.node-test.mjs`
- Create: `scripts/notion-sync.mjs`

**Interfaces:**
- Consumes: GitHub push event JSON and normalized commit metadata.
- Produces: `classifyCommitType(message, files)`, `buildProperties(commit)`, and `commitsFromEvent(event)`.

- [x] **Step 1: Write failing unit tests** for commit classification, event normalization, property construction, and SHA-based upsert behavior using `node:test`.
- [x] **Step 2: Run `node --test scripts/notion-sync.node-test.mjs`** and confirm it fails because `scripts/notion-sync.mjs` does not exist.
- [x] **Step 3: Implement the dependency-free synchronizer** with injected `fetch` and changed-file resolution so tests do not contact external services.
- [x] **Step 4: Run `node --test scripts/notion-sync.node-test.mjs`** and confirm all tests pass.

### Task 2: GitHub Actions integration

**Files:**
- Create: `.github/workflows/sync-notion.yml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `NOTION_TOKEN` GitHub repository secret and the push event payload.
- Produces: one idempotent Notion update per pushed commit.

- [x] **Step 1: Add the workflow** for pushes to `main` plus `workflow_dispatch`, with read-only repository permissions and concurrency control.
- [x] **Step 2: Add `test:notion-sync`** to `package.json` and document the one required secret in `README.md`.
- [x] **Step 3: Run unit tests, lint, typecheck, and build.**

### Task 3: Scheduled local reconciliation

**Files:**
- No repository files.

**Interfaces:**
- Consumes: the local repository path, connected GitHub repository, and existing Notion data sources.
- Produces: local-unpublished update records, missed published records, and module relations.

- [x] **Step 1: Create a six-hour Codex heartbeat** attached to the current task with exact source paths and safety rules.
- [x] **Step 2: Verify the saved automation state** and record its identifier.

### Task 4: Publish for review

**Files:**
- All files from Tasks 1 and 2.

**Interfaces:**
- Consumes: verified branch changes.
- Produces: a draft pull request targeting `main`.

- [x] **Step 1: Inspect the final diff and confirm only synchronization files changed.**
- [x] **Step 2: Commit explicit paths and push `codex/notion-sync`.**
- [x] **Step 3: Open a draft pull request and report the remaining `NOTION_TOKEN` setup step.**
