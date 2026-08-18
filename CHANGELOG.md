# Changelog

## 2026-08-18
- Added `docs/ops-hub-v2/AUDIT-2026-08-18.md` — read-only audit of the historical
  cross-project dashboard, command center, Ops Hub, Code Dashboard, project
  manifest, and public portfolio surfaces, with each artifact classified
  preserve / migrate / archive / unlink / remove-from-public.
- Added `docs/ops-hub-v2/OPS_HUB_V2_SPEC.md` — build spec for the consolidated
  replacement: registry schema, `ops-state.json` v2 contract, nine enforced
  invariants, build order, and acceptance criteria.
- README: linked both documents.

## 2026-07-06
- Added LICENSE (explicit all-rights-reserved).

## 2026-03-26
- **Initial commit** — Notion dashboard auto-updater: reads a Notion database, groups tasks by status/priority, and rewrites a summary block on the parent page.
- Fixed script path: moved the updater from `scripts/notionDashboardUpdate.js` to `notionDashboardUpdate.js` at the repo root.
- Hardened the updater: added a PID-based lock file to prevent concurrent runs, a `--dry-run` mode, parallel block deletes for faster updates, and a configurable `DASHBOARD_DB_ID`.
