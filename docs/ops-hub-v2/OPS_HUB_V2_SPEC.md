# Ops Hub v2 — Build Spec

**Status:** Draft for approval · **Date:** 2026-08-18
**Companion:** [Cross-Project Dashboard Surface Audit](./AUDIT-2026-08-18.md)

## 1. Product definition

Ops Hub v2 is the **private, registry-driven operating view** over Dave's
software, web, AI, and systems work. It answers five questions and nothing else:

1. What exists?
2. What is active?
3. What is broken or stale?
4. What needs Dave next?
5. What is safe to publish publicly?

## 2. Non-goals

Ops Hub v2 is **not** a public portfolio, a project management system, a
replacement for the workspace project hubs, a replacement for GitHub/Vercel/
Cloudflare consoles, a secrets store, or a public mirror of internal state.

Explicitly deferred from the seed build: multi-service live integrations,
mutations/write-back, and public/admin dual-mode rendering. The audit found that
every prior generation failed by widening before the contract underneath was
solid. v2 earns scope by first proving the contract.

## 3. The one rule

> **The dashboard is a renderer, never an authority.**

Five previous generations were built as surfaces and each drifted into being
treated as truth. v2 inverts this: registries and state contracts own truth, and
every rendered fact carries its source.

| Truth | Owning source |
|---|---|
| Project identity | Workspace projects database |
| Verified status | Status-check runs database |
| Tasks and open loops | Action items database |
| Build/deploy evidence | Development logs database |
| Session narrative | Conversation notes database |
| Internal ops state | Private registry + per-project `ops-state.json` |
| Public project listing | Sanitized public manifest |

If two sources disagree, v2 renders **both with a conflict badge**. It never
silently picks a winner.

## 4. Architecture

```
workspace databases ─┐
GitHub / deploy      ├─→  Ops Registry (private, canonical)
per-project state ───┘              │
                                    ├─→  Private Ops Hub  (full internal detail)
                                    │
                                    └─→  export-public-manifest  (allowlist, fails closed)
                                                    │
                                                    ├─→  Public portfolio hub
                                                    └─→  sitemap.xml
```

The public hub is generated **from the sanitized export**, never from the private
registry. There is no code path from internal state to a public surface that does
not pass through the allowlist.

## 5. Invariants

These are the reason v2 exists. Each is a **CI check that fails the build**, not
a review-time convention. Every one maps to a finding in the audit.

| # | Invariant | Audit finding |
|---|---|---|
| **I-1** | `visibility != "public"` ⟹ the built page carries `<meta name="robots" content="noindex,nofollow">` | F-001, root cause |
| **I-2** | No internal surface is reachable from any public build output | F-001 |
| **I-3** | The public manifest is derived from an **allowlist**. An unlisted field is dropped, never passed through | F-002 |
| **I-4** | `sitemap.xml` is generated from the public manifest. Hand edits fail the build | F-003 |
| **I-5** | Every public project has a real `<a href>` in the **served** HTML, before JavaScript | F-004 |
| **I-6** | Exactly one canonical registry file, path-resolved from the repo root | F-005 |
| **I-7** | Every rendered fact carries `source` + `verifiedAt`. Unsourced facts cannot render green | F-006 |
| **I-8** | Every entry declares `indexPolicy` with a reason. There is no default | F-007 |
| **I-9** | Ambiguous privacy flags **fail the export**. Never publish-by-default | F-002 |

**I-9 is the load-bearing one.** Every prior generation defaulted to publish and
relied on review to catch mistakes. Review did not catch them.

### I-1 belongs in the generator

The audit found the command center is regenerated and republished by recurring
automation. A directive added to published output is reverted on the next pass.
**Every invariant is enforced at generation time.** Verifying the output is a
regression test, not the fix.

## 6. Repository layout

Private repository — `ops-hub`. Not this one; see §11.

```
ops-hub/
├── registry/
│   ├── ops-registry.json            # canonical, single file (I-6)
│   ├── ops-registry.schema.json
│   ├── public-export.allowlist.json # field allowlist (I-3)
│   └── visibility-policy.md
├── schemas/
│   ├── ops-state.schema.json
│   └── audit-finding.schema.json
├── adapters/                        # notion/ github/ pages/ local-state/
├── scripts/
│   ├── validate-registry.mjs
│   ├── collect-state.mjs
│   ├── build-hub.mjs
│   ├── export-public-manifest.mjs
│   └── audit-public-safety.mjs      # enforces I-1, I-2, I-5
├── dist/
│   ├── ops-hub.html                 # private
│   ├── ops-snapshot.json
│   ├── source-health.json
│   └── public-project-manifest.json # sanitized (I-3)
└── docs/
```

## 7. Registry schema

One row per project. `visibility`, `indexPolicy`, and `privacy` are **required** —
there is no inferred default (I-8, I-9).

```jsonc
{
  "schemaVersion": 2,
  "id": "garden-os",
  "name": "Garden OS",
  "domain": "software",

  "visibility": "public",        // public | unlisted | private | archived
  "lifecycle": "active",         // active | maintenance | paused | candidate | retired
  "tier": 1,

  "indexPolicy": {               // REQUIRED — no default (I-8)
    "directive": "index,follow", // index,follow | noindex,nofollow
    "reason": "Public flagship project page",
    "decidedAt": "2026-08-18"
  },

  "canonicalRecord": "<workspace project page>",
  "repo": { "provider": "github", "owner": "…", "name": "garden-os", "visibility": "public" },
  "urls": { "public": "https://…/garden-os/", "admin": null, "dashboard": null },

  "state": {
    "statePath": "projects/garden-os/ops-state.json",  // repo-relative (I-6)
    "staleAfterMinutes": 1440,
    "required": true
  },

  "publicExport": {              // the ONLY fields that may reach a public surface (I-3)
    "allowed": true,
    "title": "Garden OS",
    "description": "Public-safe description",
    "tags": ["game", "simulation"],
    "canonicalUrl": "https://…/garden-os/"
  },

  "privacy": {
    "containsInternalData": false,
    "containsClientData": false,
    "publicSafe": true,
    "reviewedAt": "2026-08-18"    // absent or stale ⟹ export fails (I-9)
  }
}
```

**Why `publicExport` is a nested object rather than flat fields:** the exporter
copies that subtree and nothing else. Adding a field to the top level can never
accidentally publish it — the failure mode behind F-002, made structurally
impossible.

## 8. `ops-state.json` schema v2

Per-project, machine-written. The durable primitive — a project's dashboard HTML
is an optional drilldown, its state file is not.

```jsonc
{
  "schemaVersion": 2,
  "project": { "id": "garden-os", "visibility": "public", "lifecycle": "active" },

  "status": {
    "light": "yellow",                    // green | yellow | red | gray
    "label": "Needs deploy verification",
    "confidence": "likely",               // confirmed | likely | unknown
    "verifiedAt": "2026-08-18T09:00:00-04:00",
    "source": "status-check-runs"         // required (I-7)
  },

  "freshness": {
    "updatedAt": "2026-08-18T09:00:00-04:00",
    "staleAfterMinutes": 1440,
    "state": "fresh"                      // fresh | aging | stale | missing | unknown
  },

  "kpis":   [ { "label": "Live URL", "value": "200", "status": "ok",
                "confidence": "confirmed", "source": "curl", "verifiedAt": "…" } ],
  "issues": [ { "id": "seo-static-content", "severity": "P1", "status": "open",
                "title": "…", "source": "…", "recommendedAction": "…" } ],
  "links":  [ { "label": "Public site", "url": "https://…", "visibility": "public" } ],
  "facts":  [ { "key": "public_indexable", "value": true,
                "confidence": "confirmed", "source": "curl", "verifiedAt": "…" } ],

  "privacy": { "containsInternalData": false, "publicSafe": true },
  "metadata": { "generator": "scripts/collect-state.mjs", "generatedAt": "…" }
}
```

### Confidence and freshness rules

- A fact with `confidence: "unknown"` **may render**, but its tile cannot be green
  (I-7). Uncertainty is displayed, not hidden.
- Past `staleAfterMinutes`, status degrades to `aging`, then `stale`. A stale
  green renders as gray — **an old success is not a current one**.
- A missing state file renders as `missing`, distinct from `red`.
  **Absence of data is not evidence of failure**, and v2 must never conflate them:
  conflating them is what trains an operator to ignore the dashboard.

## 9. UI zones

Five zones, in priority order. Zone 1 is the reason the product exists.

**Zone 1 — Safety rail.** Public/private boundary violations, invariant failures,
failed state collection, overdue P0/P1. Empty when healthy; nothing else may
occupy this space. Seeded with the audit's open items.

**Zone 2 — Top 3.** Maximum three cards. Each shows source, confidence, and one
next action. No hand-written prose — a card that cannot cite a source cannot appear.

**Zone 3 — Project grid.** Grouped: active production · active development ·
watchlist · archive candidates · internal systems · public surfaces. Each tile:
status light, verified timestamp, next action, open P0/P1 count, public-safety
badge, freshness badge.

**Zone 4 — Audit and drift lane.** Inherits the Cross-Project Scan taxonomy:
Security · Drift · Operability · Public exposure · Registry mismatch · Stale state.

**Zone 5 — Source health footer.** Always visible: registry freshness, per-source
freshness, last state collection, last public export, invariant check results,
stale-state count, unmapped-project count.

Zone 5 is permanent and non-collapsible. Every prior generation degraded by
looking authoritative while its inputs went stale; the footer makes staleness
impossible to miss.

## 10. Public/private field policy

**Never exported, at any visibility:** local paths · run identifiers · internal
audit state · client names · task queues · blocker text · session notes · secrets
inventory state · device/host names · private record URLs · raw `ops-state.json`.

**Exportable, only via `publicExport`:** name · public description · public URL ·
public repo URL · sanitized tags · category · lifecycle label · screenshot/OG
image · demo link.

The exporter is an **allowlist copy**, not a denylist filter (I-3). A field that
is not named is not exported, including fields that do not exist yet.

> [!NOTE]
> The current public manifest carries `localPath` and `runCommand` on all 79 rows.
> Both are empty today. Under I-3 they are not exported at all, so the channel
> closes rather than staying empty-by-luck.

## 11. Where this lives

Ops Hub v2 belongs in a **private** repository.

`DaveHomeAssist/code-dashboard` — this repo — is public, and is itself an artifact
in the audited lineage (it drives the Notion Code Dashboard page). This spec and
the audit are hosted here because both are public-safe by construction: they
describe architecture and cite only already-public evidence.

**The registry, state files, and rendered private dashboard must not land here.**
Publishing them would reproduce F-001 in a new location.

## 12. Build order

Each session ends with something verifiable. No session ships a surface before the
contract under it.

<details open>
<summary><strong>Session 1 — Foundation</strong></summary>

Schemas + validator + 5-project registry seed
(hub · Garden OS · PixelForge · MixMash · Ops Hub itself)
+ allowlist + a read-only dashboard skeleton reading real state.

**Done when:** `validate-registry.mjs` passes on the seed and fails on a row with
a missing `privacy.reviewedAt`.
</details>

<details>
<summary><strong>Session 2 — Migration</strong></summary>

Import v0.5 registry entries, de-duplicating to one canonical file (I-6). Convert
existing state files to schema v2. Add `audit-public-safety.mjs`. Wire the safety
rail and source-health footer.

**Done when:** the safety rail reproduces the audit's open findings from live data,
with no hand-authored entries.
</details>

<details>
<summary><strong>Session 3 — Public separation</strong></summary>

Generate `public-project-manifest.json` from the allowlist. **Emit a diff against
the existing manifest — do not write over it.** Add sitemap generation (I-4),
static link pre-rendering (I-5), and the unlisted ⟹ noindex invariant (I-1).

**Done when:** the diff is reviewed and approved by a human, and a deliberately
mis-flagged fixture row fails the export (I-9).
</details>

<details>
<summary><strong>Session 4 — Automation</strong></summary>

Scheduled state collection, history log, stale-source badges. Decide the refresh
owner: scheduled CI, local scheduler, or manual.

**Done when:** a full unattended refresh runs, and an injected invariant violation
fails it.
</details>

## 13. Acceptance criteria

v2 is accepted when **all** hold:

- [ ] No private or internal surface is reachable from any public build output
- [ ] Every registry row has `visibility`, `lifecycle`, `indexPolicy`, `privacy.publicSafe`, and `canonicalRecord`
- [ ] Every active project has a valid `ops-state.json` v2, or an explicit `state.required: false`
- [ ] Every displayed status shows confidence and freshness
- [ ] The public manifest is allowlist-generated; export **fails closed** on ambiguity
- [ ] `sitemap.xml` is generated and covers every public project URL
- [ ] Every public project has a static `<a href>` before JavaScript runs
- [ ] `visibility != public` ⟹ `noindex,nofollow`, verified against the **built output**
- [ ] Archived Code Dashboard surfaces are labeled historical and out of active navigation
- [ ] `/command-center-061eed/` is no longer publicly indexable internal content

### Verification

Each criterion has a check that runs in CI and fails the build:

| Check | Enforces |
|---|---|
| `validate-registry.mjs` — schema + required fields | I-6, I-8, I-9 |
| `audit-public-safety.mjs` — crawl built output for robots directives, internal links, static anchors | I-1, I-2, I-5 |
| `export-public-manifest.mjs --check` — assert exported keys ⊆ allowlist | I-3 |
| sitemap diff — generated vs committed | I-4 |
| state schema validation across all rows | I-7 |

An invariant without a failing check is a convention, and conventions are what the
previous five generations already tried.
