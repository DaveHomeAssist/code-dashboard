# Code Dashboard

A scheduled script that keeps a personal "Code Dashboard" page in Notion in sync — it reads a Notion database of dev tasks and rewrites a summary block on the parent page every 15 minutes via GitHub Actions.

## What it does

`notionDashboardUpdate.js` queries a Notion database (rows = tasks/tickets), groups them by **Status** (In Progress / Blocked / Logged / Closed) and sorts each group by **Priority** (High / Med / Low), then replaces the content between `<!-- DASHBOARD_SUMMARY:START -->` and `<!-- DASHBOARD_SUMMARY:END -->` markers on the Notion page with a freshly rendered summary — including a "Follow-Up Needed" callout and an open/closed item count. It's designed to be idempotent and safe to run on a schedule.

## What's here

| Path | What it is |
|---|---|
| `notionDashboardUpdate.js` | The updater script: fetches the Notion DB, renders the summary, and patches the page in place |
| `.github/workflows/dashboard-update.yml` | GitHub Actions workflow that runs the script every 15 minutes (and on manual dispatch) |
| `package.json` | Project metadata; requires Node >= 18 (uses native `fetch`) |

## How it works

- **Concurrency-safe**: uses a PID-based lock file (`/tmp/notion-dashboard-update.lock` by default) so overlapping scheduled runs skip instead of racing each other.
- **Dry-run mode**: `--dry-run` renders a sample summary to stdout without touching Notion or requiring `NOTION_TOKEN`.
- **Configurable via environment variables**:
  - `NOTION_TOKEN` (required for real runs)
  - `NOTION_API_BASE` (default `https://api.notion.com`)
  - `NOTION_VERSION` (default `2022-06-28`)
  - `DASHBOARD_PAGE_ID` (default set in-script)
  - `DASHBOARD_DB_ID` (default set in-script)

## Running it

```bash
node notionDashboardUpdate.js            # live update (requires NOTION_TOKEN)
node notionDashboardUpdate.js --dry-run  # print a sample summary, no API calls
```

> Note: the `dashboard:update` / `dashboard:dry-run` scripts in `package.json` currently point at `scripts/notionDashboardUpdate.js`, but the script lives at the repo root — run it directly with `node notionDashboardUpdate.js` as shown above (this is also how the GitHub Actions workflow invokes it) until the npm scripts are updated to match.

In production, the script runs unattended via the `Update Notion Dashboard` GitHub Actions workflow, which needs a `NOTION_TOKEN` secret configured on the repo.

## Related documents

This repo drives the Notion Code Dashboard page, which makes it one artifact in a
longer lineage of cross-project dashboards. That lineage was audited on
2026-08-18:

| Document | What it covers |
|---|---|
| [`docs/ops-hub-v2/AUDIT-2026-08-18.md`](docs/ops-hub-v2/AUDIT-2026-08-18.md) | Read-only audit of every historical dashboard, command center, manifest, and public portfolio surface, with each artifact classified preserve / migrate / archive / unlink / remove-from-public |
| [`docs/ops-hub-v2/OPS_HUB_V2_SPEC.md`](docs/ops-hub-v2/OPS_HUB_V2_SPEC.md) | Build spec for the consolidated replacement: registry schema, state contract, enforced invariants, and acceptance criteria |

Both are public-safe by construction and cite only already-public evidence. The
Ops Hub v2 implementation itself belongs in a private repo — see §11 of the spec.

## License

All rights reserved — see [LICENSE](LICENSE).
