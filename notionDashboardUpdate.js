#!/usr/bin/env node
/**
 * notionDashboardUpdate.js
 *
 * Reads the @Mar 25 Code Dashboard database from Notion, groups rows by
 * Status and Priority, and writes a deterministic summary into the
 * DASHBOARD_SUMMARY markers on the parent page.
 *
 * Usage:  node scripts/notionDashboardUpdate.js
 *         npm run dashboard:update
 *
 * Environment:
 *   NOTION_TOKEN        (required)
 *   NOTION_API_BASE     (default: https://api.notion.com)
 *   NOTION_VERSION      (default: 2022-06-28)
 *   DASHBOARD_PAGE_ID   (default: fd9255fc8f448343899e817c22804e09)
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_API_BASE = process.env.NOTION_API_BASE || "https://api.notion.com";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";
const PAGE_ID = (
  process.env.DASHBOARD_PAGE_ID || "fd9255fc8f448343899e817c22804e09"
).replace(/-/g, "");
const DATABASE_ID = "79bd524b-0563-4d19-8696-2c706a55a704";

if (!NOTION_TOKEN) {
  console.error("NOTION_TOKEN is not set. Aborting.");
  process.exit(1);
}

// ── Notion API helpers ────────────────────────────────────────────────

async function notionFetch(path, opts = {}) {
  const url = `${NOTION_API_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status} ${path}: ${body}`);
  }
  return res.json();
}

async function getChildBlocks(blockId) {
  let results = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}` : "";
    const data = await notionFetch(`/v1/blocks/${blockId}/children${qs}`);
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

async function queryDatabase(dbId) {
  let results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(`/v1/databases/${dbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

async function deleteBlock(blockId) {
  await notionFetch(`/v1/blocks/${blockId}`, { method: "DELETE" });
}

async function appendChildren(blockId, children) {
  // Notion allows max 100 blocks per append call
  for (let i = 0; i < children.length; i += 100) {
    await notionFetch(`/v1/blocks/${blockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: children.slice(i, i + 100) }),
    });
  }
}

// ── Extract plain text from rich_text arrays ──────────────────────────

function plainText(richTextArr) {
  if (!richTextArr) return "";
  return richTextArr.map((t) => t.plain_text || "").join("");
}

function blockPlainText(block) {
  const payload =
    block[block.type] ||
    block.paragraph ||
    block.heading_3 ||
    block.callout ||
    {};
  return plainText(payload.rich_text);
}

// ── Extract row properties ────────────────────────────────────────────

function extractRow(page) {
  const p = page.properties || {};
  const titleProp = p.Title || {};
  const title = plainText(titleProp.title);
  const status = p.Status?.select?.name || "No Status";
  const priority = p.Priority?.select?.name || "No Priority";
  const projectTag = p["Project Tag"]?.select?.name || "";
  const type = p.Type?.select?.name || "";
  const followUp = p["Follow Up Needed"]?.checkbox === true;
  return { title, status, priority, projectTag, type, followUp };
}

// ── Render the summary ────────────────────────────────────────────────

function renderSummary(rows) {
  const now = new Date();
  const ts = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const statusOrder = ["In Progress", "Blocked", "Logged", "Closed"];
  const priorityOrder = ["High", "Med", "Low", "No Priority"];

  // Group by status
  const byStatus = {};
  for (const r of rows) {
    (byStatus[r.status] ||= []).push(r);
  }

  // Within each status group, sort by priority
  for (const group of Object.values(byStatus)) {
    group.sort(
      (a, b) =>
        priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
    );
  }

  const statusEmoji = {
    "In Progress": "\u23f3",
    Blocked: "\ud83d\udd34",
    Logged: "\ud83d\udfe0",
    Closed: "\ud83d\udfe2",
  };

  const lines = [`*Last updated: ${ts} ET*`, ""];

  for (const status of statusOrder) {
    const group = byStatus[status];
    if (!group || group.length === 0) continue;
    const emoji = statusEmoji[status] || "\u26aa";
    lines.push(`${emoji} **${status.toUpperCase()}** (${group.length})`);
    for (const r of group) {
      const priTag = r.priority !== "No Priority" ? ` [${r.priority}]` : "";
      const projTag = r.projectTag ? ` \u2014 ${r.projectTag}` : "";
      lines.push(`- ${r.title}${priTag}${projTag}`);
    }
    lines.push("");
  }

  // Follow-up needed callout
  const followUps = rows.filter((r) => r.followUp && r.status !== "Closed");
  if (followUps.length > 0) {
    lines.push(`\ud83d\udccc **FOLLOW-UP NEEDED** (${followUps.length})`);
    for (const r of followUps) {
      lines.push(`- ${r.title}`);
    }
    lines.push("");
  }

  // Counts summary
  const total = rows.length;
  const closed = (byStatus["Closed"] || []).length;
  const open = total - closed;
  lines.push(`*${total} items total \u2014 ${open} open, ${closed} closed*`);

  return lines;
}

// ── Build Notion blocks from rendered lines ───────────────────────────

function richText(content, annotations = {}) {
  return [{ type: "text", text: { content }, annotations }];
}

function parseLine(line) {
  // Italic line:  *text*
  const italicMatch = line.match(/^\*(.+)\*$/);
  if (italicMatch) {
    return {
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: richText(italicMatch[1], { italic: true }) },
    };
  }

  // Heading-style line with emoji + bold:  emoji **TEXT** (n)
  const headingMatch = line.match(/^(.+\s)\*\*(.+)\*\*(.*)$/);
  if (headingMatch && !line.startsWith("- ")) {
    const segments = [
      { type: "text", text: { content: headingMatch[1] } },
      {
        type: "text",
        text: { content: headingMatch[2] },
        annotations: { bold: true },
      },
    ];
    if (headingMatch[3]) {
      segments.push({ type: "text", text: { content: headingMatch[3] } });
    }
    return {
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: segments },
    };
  }

  // Bullet item:  - text [Pri] — Project
  if (line.startsWith("- ")) {
    return {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: richText(line.slice(2)) },
    };
  }

  // Plain paragraph
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(line) },
  };
}

function linesToBlocks(lines) {
  const blocks = [];
  for (const line of lines) {
    if (line === "") {
      // skip empty lines — spacing is implicit between blocks
      continue;
    }
    blocks.push(parseLine(line));
  }
  return blocks;
}

// ── Find the marker blocks among children ─────────────────────────────

const START_MARKER = "<!-- DASHBOARD_SUMMARY:START -->";
const END_MARKER = "<!-- DASHBOARD_SUMMARY:END -->";

function findMarkers(blocks) {
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const txt = blockPlainText(blocks[i]);
    if (txt.includes("DASHBOARD_SUMMARY:START")) startIdx = i;
    if (txt.includes("DASHBOARD_SUMMARY:END")) endIdx = i;
  }
  return { startIdx, endIdx };
}

// ── Find the Dashboard Summary toggle or marker parent ────────────────

async function findSummaryParent(pageId) {
  const topBlocks = await getChildBlocks(pageId);

  // Strategy 1: Look for markers directly in top-level blocks
  let { startIdx, endIdx } = findMarkers(topBlocks);
  if (startIdx !== -1 && endIdx !== -1) {
    return { parentId: pageId, blocks: topBlocks, startIdx, endIdx };
  }

  // Strategy 2: Look inside toggle headings and other blocks with children
  for (const block of topBlocks) {
    if (!block.has_children) continue;
    const children = await getChildBlocks(block.id);
    const result = findMarkers(children);
    if (result.startIdx !== -1 && result.endIdx !== -1) {
      return {
        parentId: block.id,
        blocks: children,
        startIdx: result.startIdx,
        endIdx: result.endIdx,
      };
    }
  }

  // Strategy 3: Markers don't exist. Find the database block and insert
  // markers directly above it at the top level.
  const dbIdx = topBlocks.findIndex(
    (b) =>
      b.type === "child_database" &&
      b.id.replace(/-/g, "") === DATABASE_ID.replace(/-/g, "")
  );
  if (dbIdx !== -1) {
    return { parentId: pageId, blocks: topBlocks, dbIdx, needsInsert: true };
  }

  throw new Error(
    "Could not find DASHBOARD_SUMMARY markers or the database block on the page."
  );
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching database rows...");
  const pages = await queryDatabase(DATABASE_ID);
  console.log(`  Found ${pages.length} rows.`);

  const rows = pages.map(extractRow);
  const summaryLines = renderSummary(rows);
  const summaryBlocks = linesToBlocks(summaryLines);

  console.log("Locating summary markers on page...");
  const loc = await findSummaryParent(PAGE_ID);

  if (loc.needsInsert) {
    // Markers don't exist yet — we cannot easily insert "before" a block
    // in Notion API without using the "after" parameter relative to the
    // block before the database block.  Instead, append a toggle above.
    console.log(
      "  Markers not found. Cannot insert without restructuring. Aborting safely."
    );
    console.log(
      "  Add the markers manually above the database block and re-run."
    );
    process.exit(1);
  }

  const { parentId, blocks, startIdx, endIdx } = loc;

  // Delete all blocks between START and END (exclusive of markers)
  const toDelete = blocks.slice(startIdx + 1, endIdx);
  console.log(
    `  Deleting ${toDelete.length} old blocks between markers...`
  );
  for (const block of toDelete) {
    await deleteBlock(block.id);
  }

  // Append new summary blocks after the START marker.
  // Notion's append API puts children at the end of the parent.
  // We need to use the "after" parameter to insert after the START marker.
  console.log(`  Inserting ${summaryBlocks.length} new summary blocks...`);

  // Notion PATCH /blocks/{id}/children supports "after" to position blocks
  for (let i = 0; i < summaryBlocks.length; i += 100) {
    const batch = summaryBlocks.slice(i, i + 100);
    const body = {
      children: batch,
      after: i === 0 ? blocks[startIdx].id : undefined,
    };
    // For subsequent batches, we don't know the new block IDs without
    // re-reading, so we only use "after" for the first batch.
    // For a typical dashboard summary this fits in one batch.
    await notionFetch(`/v1/blocks/${parentId}/children`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  console.log("Dashboard updated successfully.");
}

main().catch((err) => {
  console.error("Dashboard update failed:", err.message);
  process.exit(1);
});
