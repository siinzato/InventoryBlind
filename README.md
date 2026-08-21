# ProjectAZ

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-8mv5rpy8)

## Notion release synchronization

Pushes to `main` are synchronized with the InventoryBlind **Atualizações & Releases** database by `.github/workflows/sync-notion.yml`.

Repository setup:

1. Create an internal Notion integration with read and insert/update content access.
2. Share the InventoryBlind Notion page with that integration.
3. Add its token as the GitHub Actions repository secret `NOTION_TOKEN`.

The workflow never marks an update as validated and does not change product code. Run its focused tests with `npm run test:notion-sync`.
