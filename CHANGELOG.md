# Changelog

## 2026-07-06
- Added LICENSE (explicit all-rights-reserved).

## 2026-03-26
- **Initial commit** — Notion dashboard auto-updater: reads a Notion database, groups tasks by status/priority, and rewrites a summary block on the parent page.
- Fixed script path: moved the updater from `scripts/notionDashboardUpdate.js` to `notionDashboardUpdate.js` at the repo root.
- Hardened the updater: added a PID-based lock file to prevent concurrent runs, a `--dry-run` mode, parallel block deletes for faster updates, and a configurable `DASHBOARD_DB_ID`.
