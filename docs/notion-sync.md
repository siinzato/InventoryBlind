# InventoryBlind → Notion Sync

## Goal

Keep the InventoryBlind Notion workspace aligned with meaningful code checkpoints without modifying application behavior.

## Sources

- Local repository: `C:\Users\victo\Documents\Codex\2026-08-19\bo\work\inventoryblind`
- GitHub repository: `siinzato/InventoryBlind`, branch `main`
- Notion updates data source: `9372a697-ddbc-48ab-8a0c-7a2b137d00d7`
- Notion modules data source: `e8a9dab4-2a27-44ec-a2ad-307904c08bd9`

## Behavior

1. A GitHub Action runs on pushes to `main` and can be run manually.
2. Each pushed commit is upserted by SHA in `Atualizações & Releases`.
3. Records created by GitHub are marked `Publicado` and never automatically marked as validated.
4. A scheduled Codex task checks the local worktree and GitHub every six hours, records unpublished local changes, enriches module relations, and reconciles missed commits.
5. The scheduled task reads only the delta since the last recorded SHA whenever possible.
6. Neither layer edits application code, changes module state to `Produção`, or marks an update as validated.

## Security

- The GitHub workflow reads the Notion token only from the `NOTION_TOKEN` repository secret.
- No secret or credential is committed.
- The Notion integration only needs read and insert/update content access to the InventoryBlind pages.
