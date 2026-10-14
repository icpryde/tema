// Tema — wide-reply layout test (Final Fantasy).
//
//   node tools/tests/wide.mjs
//
// A table wider than the text column used to run straight out of the
// ChatGPT reply window's right edge. ChatGPT breaks tables out of the column
// on purpose (100cqw container, negative gutters, a table at least the whole
// column wide), and the window's own padding left the text narrower than
// that. The fix makes the WINDOW grow to fit the table instead — evenly both
// ways, up to the room the thread has — and does the same on claude.ai,
// where a table too wide for the column used to scroll inside the frame.
//
// Everything here is asserted on real geometry in a real browser, against
// markup and site CSS transcribed from the live pages (2026-09-24): the
// chatgpt table module rules and column-size limits are verbatim, and the
// claude page runs the content scripts, which do the measuring there. ChatGPT's
// 2026-09 "app shell" rebuild moved tables into a [data-wide-block] that
// breaks out RIGHTWARD only; it gets its own page, transcribed 2026-09-27.

import { writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../lib/chrome.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = findChrome();

const cells = (n, size, text) =>
  Array.from({ length: n }, (_, i) => `<td data-col-size="${size}">${text(i)}</td>`).join("");
const heads = (n, size) =>
  Array.from({ length: n }, (_, i) => `<th data-col-size="${size}">Column ${i + 1}</th>`).join("");

/* ---------------------------------------------------------------- chatgpt */

// One assistant turn, shaped exactly like the live one down to the table.
const gptTurn = (id, body) => `
  <section data-turn="assistant" data-tema-reply="1" id="${id}">
    <div class="turn"><div class="col"><div class="stack">
      <div data-message-author-role="assistant"><div class="msg"><div class="markdown prose">
        ${body}
      </div></div></div>
    </div></div></div>
  </section>`;

const gptTable = (n, size, text) => `
  <div class="group TyagGW_tableContainer">
    <div class="TyagGW_tableWrapper flex flex-col-reverse w-fit">
      <table class="w-fit min-w-(--thread-content-width)">
        <thead><tr>${heads(n, size)}</tr></thead>
        <tbody><tr>${cells(n, size, text)}</tr><tr>${cells(n, size, (i) => "Row two " + (i + 1))}</tr></tbody>
      </table>
      <div class="relative h-0 self-end select-none"></div>
    </div>
  </div>`;

const LONG_CODE = "const everyItem = [" + Array.from({ length: 60 }, (_, i) => "item" + i).join(", ") + "];";

const GPT_PAGE = `<!doctype html>
<html lang="en" data-tema="final-fantasy">
<head><meta charset="utf-8">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/fonts.css">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/sprites/crystal.css">
<link rel="stylesheet" href="../../themes/final-fantasy/chatgpt.css">
<style>
  /* chatgpt.com's own rules the layout depends on. The two module rules and
     the column-size limits are copied from the live stylesheets; the rest
     are the utilities on the live turn, written out longhand. */
  * { box-sizing: border-box; margin: 0; }
  .thread { container-type: inline-size; margin: 0 0 40px 260px; }
  .turn { --thread-content-margin: calc(.25rem * 16); padding-inline: var(--thread-content-margin); }
  .col { --thread-content-max-width: 48rem; max-width: var(--thread-content-max-width); margin-inline: auto;
         display: flex; flex-direction: column; width: 100%; min-width: 0; position: relative; flex: 1; }
  .stack { display: flex; flex-direction: column; gap: 1rem; max-width: 100%; flex-grow: 1; }
  div[data-message-author-role="assistant"] { position: relative; display: flex; flex-direction: column;
         align-items: flex-end; gap: .5rem; width: 100%; }
  .msg { display: flex; flex-direction: column; gap: .25rem; width: 100%; }
  .markdown { width: 100%; }
  .markdown table { border-collapse: collapse; }
  .markdown th, .markdown td { padding: 6px 12px; text-align: left; }
  .TyagGW_tableContainer {
    --thread-content-width: min(calc(100cqw - 2 * var(--thread-content-margin,0)), var(--thread-content-max-width));
    --thread-gutter-size: calc((100cqw - var(--thread-content-width)) / 2);
    width: 100cqw; margin-inline: calc(-1 * var(--thread-gutter-size)); scrollbar-width: thin; overflow-x: auto; }
  .TyagGW_tableWrapper { margin-inline: var(--thread-gutter-size) var(--thread-content-margin); pointer-events: auto; }
  .flex { display: flex; } .flex-col-reverse { flex-direction: column-reverse; } .w-fit { width: fit-content; }
  .min-w-\\(--thread-content-width\\) { min-width: var(--thread-content-width); }
  .relative { position: relative; } .h-0 { height: 0; } .self-end { align-self: flex-end; }
  .markdown table [data-col-size="sm"] { min-width: calc(var(--thread-content-max-width) * 4 / 24); max-width: calc(var(--thread-content-max-width) * 6 / 24); }
  .markdown table [data-col-size="md"] { min-width: calc(var(--thread-content-max-width) * 6 / 24); max-width: calc(var(--thread-content-max-width) * 8 / 24); }
  pre { overflow-x: auto; }
</style>
</head>
<body>
<div class="thread" style="width:1340px">
  ${gptTurn("narrow", "<p>Three short columns: the fridge comparison shape.</p>" + gptTable(3, "sm", (i) => "Cell " + (i + 1)))}
  ${gptTurn("grow", "<p>Four small columns of longer text want more than the column.</p>" + gptTable(4, "sm", (i) => "A somewhat longer cell " + (i + 1)))}
  ${gptTurn("cap", "<p>Eight medium columns cannot fit even the widest window.</p>" + gptTable(8, "md", (i) => "Medium column cell " + (i + 1)))}
  ${gptTurn("prose", "<p style='white-space:nowrap'>An unbreakable line that refuses to wrap and would ask for its whole length on one row if it could.</p><pre><code>" + LONG_CODE + "</code></pre>" + gptTable(3, "sm", (i) => "Cell " + (i + 1)))}
  ${gptTurn("plain", "<p>No table at all, only a long code line.</p><pre><code>" + LONG_CODE + "</code></pre>")}
</div>
<div class="thread" style="width:800px">
  ${gptTurn("small", "<p>A narrow thread has no room to grow into.</p>" + gptTable(6, "sm", (i) => "A somewhat longer cell " + (i + 1)))}
</div>
<script>
window.addEventListener("load", async () => {
  await document.fonts.ready;
  // A timer, not a double rAF: under --virtual-time-budget headless Chrome
  // sometimes never produces the frame, and the page never reports. The
  // rect reads below force layout on their own.
  await new Promise((r) => setTimeout(r, 50));
  const box = (el) => el.getBoundingClientRect();
  const out = { _vars: getComputedStyle(document.documentElement).getPropertyValue("--ff-window").trim().length };
  // The new rules must have PARSED — a rejected selector is dropped silently.
  let parsed = 0;
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules || []) if (r.selectorText && r.selectorText.includes(":has(table)")) parsed++;
  }
  out._parsed = parsed;
  for (const id of ["narrow", "grow", "cap", "prose", "plain", "small"]) {
    const turn = document.getElementById(id);
    const win = turn.querySelector('div[data-message-author-role="assistant"]');
    const col = turn.querySelector(".col");
    const w = box(win), c = box(col);
    const cs = getComputedStyle(win);
    const inL = w.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const inR = w.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const tc = turn.querySelector(".TyagGW_tableContainer");
    const t = turn.querySelector("table");
    const thread = turn.closest(".thread").getBoundingClientRect().width;
    out[id] = {
      win: Math.round(w.width), col: Math.round(c.width),
      offCentre: Math.round(Math.abs((w.left + w.right) / 2 - (c.left + c.right) / 2)),
      cap: Math.round(Math.min(72 * 16, thread - 8 * 16)),
      // The table's visible box: its scroller, clipped to the frame's padding box.
      tcLeft: tc ? Math.round(box(tc).left - inL) : null,
      tcRight: tc ? Math.round(inR - box(tc).right) : null,
      tableFill: t ? Math.round(inR - inL - box(t).width) : null,
      scroll: tc ? tc.scrollWidth - tc.clientWidth : null,
    };
  }
  document.title = "WIDE:" + JSON.stringify(out);
});
</script>
</body></html>`;

/* ------------------------------------------------------- chatgpt (app shell) */

// The app-shell turn down to the table. The .block wrapper between the column
// and the assistant unit is display: contents on the live page, which is what
// makes the unit a flex item of the column.
const shellTurn = (id, body) => `
  <div data-turn-key="${id}" id="${id}"><div class="group flex flex-col"><div class="col">
    <div class="block"><div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" data-tema-reply="1">
      <div class="group flex min-w-0 flex-col"><div data-markdown-text-style="assistant-message">
        ${body}
      </div></div>
    </div></div>
  </div></div></div>`;

const shellTable = (n, size, text) => `
  <div class="group/app-widget TableContainer-fx" data-markdown-table="true" data-wide-block tabindex="-1">
    <div class="TableScroller-fx"><div class="TableWrapper-fx">
      <table class="Table-fx">
        <thead><tr>${heads(n, size)}</tr></thead>
        <tbody><tr>${cells(n, size, text)}</tr><tr>${cells(n, size, (i) => "Row two " + (i + 1))}</tr></tbody>
      </table>
    </div></div>
    <div class="block-actions" data-block-actions="true" data-markdown-copy="exclude"><button type="button">Copy table</button></div>
  </div>`;

const GPT_SHELL_PAGE = `<!doctype html>
<html lang="en" data-tema="final-fantasy">
<head><meta charset="utf-8">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/fonts.css">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/sprites/crystal.css">
<link rel="stylesheet" href="../../themes/final-fantasy/chatgpt.css">
<style>
  /* chatgpt.com's own rules the layout depends on. The Table* rules are
     copied from the live stylesheets (module hashes renamed -fx); the rest
     are the utilities on the live turn, written out longhand. */
  * { box-sizing: border-box; margin: 0; }
  .thread { container-type: inline-size; margin: 0 0 40px 260px; }
  .turns { --thread-content-max-width: 48rem; --thread-content-margin: 24px; --padding-toolbar: 16px;
           --markdown-space: .25rem; max-width: var(--thread-content-max-width); margin-inline: auto; }
  .flex { display: flex; } .flex-col { flex-direction: column; } .min-w-0 { min-width: 0; }
  .col { display: flex; flex-direction: column; gap: .75rem; }
  .block { display: contents; }
  .TableContainer-fx { width: 100%; margin-top: calc(var(--markdown-space) * 4); position: relative; }
  .TableContainer-fx[data-wide-block] {
    --wide-block-panel-max-width: var(--wide-block-panel-max-width-override,calc(100cqi - var(--thread-content-max-width) + (var(--thread-content-margin,24px) * 3) + (var(--thread-wide-block-inline-shift,0px) * 2)));
    --wide-block-width: max(100%, min(calc(50cqi + 50% - var(--padding-toolbar) - var(--thread-content-margin,24px) - var(--thread-wide-block-inline-shift,0px)), calc((100% + var(--wide-block-panel-max-width)) / 2)));
    width: fit-content; max-width: var(--wide-block-width); }
  .TableScroller-fx { scrollbar-width: thin; overflow-x: auto; }
  .TableContainer-fx[data-wide-block] .TableScroller-fx { display: flex; }
  .TableWrapper-fx { pointer-events: auto; width: fit-content; }
  .Table-fx { width: fit-content; min-width: min(calc(100cqw - (var(--padding-toolbar) * 2)), calc(var(--thread-content-max-width,40rem) - (var(--padding-toolbar) * 2)));
              border-collapse: separate; border-spacing: 0; table-layout: auto; text-align: start; margin: 0; }
  .Table-fx [data-col-size="sm"] { min-width: calc(var(--thread-content-max-width,40rem) * 4 / 24); max-width: calc(var(--thread-content-max-width,40rem) * 6 / 24); }
  .Table-fx [data-col-size="md"] { min-width: calc(var(--thread-content-max-width,40rem) * 6 / 24); max-width: calc(var(--thread-content-max-width,40rem) * 8 / 24); }
  .Table-fx th, .Table-fx td { padding: 6px 12px; text-align: left; }
  .block-actions { position: absolute; inset-inline-end: 0; top: 0; display: flex; }
  pre { overflow-x: auto; }
</style>
</head>
<body>
<div class="thread" style="width:1340px"><div class="turns">
  ${shellTurn("narrow", "<p>Three short columns: the fruit table shape.</p>" + shellTable(3, "sm", (i) => "Cell " + (i + 1)))}
  ${shellTurn("grow", "<p>Four small columns of longer text want more than the column.</p>" + shellTable(4, "sm", (i) => "A somewhat longer cell " + (i + 1)))}
  ${shellTurn("cap", "<p>Eight medium columns cannot fit even the widest window.</p>" + shellTable(8, "md", (i) => "Medium column cell " + (i + 1)))}
  ${shellTurn("prose", "<p style='white-space:nowrap'>An unbreakable line that refuses to wrap and would ask for its whole length on one row if it could.</p><pre><code>" + LONG_CODE + "</code></pre>" + shellTable(3, "sm", (i) => "Cell " + (i + 1)))}
  ${shellTurn("plain", "<p>No table at all, only a long code line.</p><pre><code>" + LONG_CODE + "</code></pre>")}
</div></div>
<div class="thread" style="width:800px"><div class="turns">
  ${shellTurn("small", "<p>A narrow thread has no room to grow into.</p>" + shellTable(6, "sm", (i) => "A somewhat longer cell " + (i + 1)))}
</div></div>
<script>
window.addEventListener("load", async () => {
  await document.fonts.ready;
  // A timer, not a double rAF: under --virtual-time-budget headless Chrome
  // sometimes never produces the frame, and the page never reports. The
  // rect reads below force layout on their own.
  await new Promise((r) => setTimeout(r, 50));
  const box = (el) => el.getBoundingClientRect();
  // The theme's variable block must have parsed: a stray comment closer in
  // the file header once swallowed it, and every var(--ff-*) went blank.
  const out = { _vars: getComputedStyle(document.documentElement).getPropertyValue("--ff-window").trim().length };
  let parsed = 0;
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules || []) if (r.selectorText && r.selectorText.includes("div[data-tema-reply]:has(table)")) parsed++;
  }
  out._parsed = parsed;
  for (const id of ["narrow", "grow", "cap", "prose", "plain", "small"]) {
    const turn = document.getElementById(id);
    const win = turn.querySelector("[data-tema-reply]");
    const col = turn.querySelector(".col");
    const w = box(win), c = box(col);
    const cs = getComputedStyle(win);
    const inL = w.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const inR = w.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const tc = turn.querySelector(".TableScroller-fx");
    const t = turn.querySelector("table");
    const thread = turn.closest(".thread").getBoundingClientRect().width;
    out[id] = {
      win: Math.round(w.width), col: Math.round(c.width),
      offCentre: Math.round(Math.abs((w.left + w.right) / 2 - (c.left + c.right) / 2)),
      cap: Math.round(Math.min(72 * 16, thread - 8 * 16)),
      tcLeft: tc ? Math.round(box(tc).left - inL) : null,
      tcRight: tc ? Math.round(inR - box(tc).right) : null,
      tableFill: t ? Math.round(inR - inL - box(t).width) : null,
      scroll: tc ? tc.scrollWidth - tc.clientWidth : null,
    };
  }
  document.title = "WIDE:" + JSON.stringify(out);
});
</script>
</body></html>`;

/* ----------------------------------------------------------------- claude */

// claude.ai's reply, as measured live: a display:contents wrapper around the
// streaming div, the markdown as a one-track grid, every table in its own
// overflow-x:auto scroller. The thread scroller is overflow-x:hidden, which
// is what bounds the room the window may grow into.
const claudeTable = (n, text) => `
  <div class="md-table-scroll prose-scroll" style="overflow-x:auto">
    <table><thead><tr>${Array.from({ length: n }, (_, i) => `<th>Head_${i + 1}</th>`).join("")}</tr></thead>
    <tbody><tr>${Array.from({ length: n }, (_, i) => `<td>${text(i)}</td>`).join("")}</tr></tbody></table>
  </div>`;

const claudeReply = (id, body) => `
  <div role="article"><div class="group group/message-row"><div class="contents" style="display:contents">
    <div data-is-streaming="false" class="group relative" id="${id}">
      <div class="font-claude-response"><div class="standard-markdown grid" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:10px">
        ${body}
      </div></div>
    </div>
  </div></div></div>`;

const CLAUDE_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/fonts.css">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/sprites/crystal.css">
<link rel="stylesheet" href="../../themes/final-fantasy/claude.css">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { margin: 0; }
  .scroller { overflow-x: hidden; overflow-y: auto; height: 100vh; margin-left: 280px; width: 1309px; }
  .col { max-width: 808px; padding: 0 20px; margin: 0 auto; }
  table { border-collapse: collapse; }
  /* Fixed cell minimums keep each case's min-content independent of the
     pixel font's metrics: 3 columns fit the column, 5 need a wider window,
     20 outrun even the widest one. */
  th, td { padding: 6px 10px; border: 1px solid #888; min-width: 150px; }
</style>
<script>
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ claude: "final-fantasy" }));
  window.__TEMA_TEST_SITE = "claude";
</script>
</head>
<body>
<main class="dframe-content"><div class="scroller"><div class="col">
  ${claudeReply("fits", "<p>A table that fits the column is left alone.</p>" + claudeTable(3, (i) => "Fits " + (i + 1)))}
  ${claudeReply("wide", "<p>Five columns cannot fit the column.</p>" + claudeTable(5, (i) => "Wide " + (i + 1)))}
  ${claudeReply("huge", "<p>Twenty columns cannot fit even the widest window.</p>" + claudeTable(20, (i) => "Huge " + (i + 1)))}
</div></div></main>
<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
window.addEventListener("load", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await document.fonts.ready;
  await wait(900);   // stamp + wide passes (the pass is debounced)
  const col = document.querySelector(".col");
  const cb = col.getBoundingClientRect();
  const colInner = cb.width - 40;
  const colMid = (cb.left + cb.right) / 2;
  const sc = document.querySelector(".scroller");
  const room = Math.min(1152, 2 * (Math.min(colMid - sc.getBoundingClientRect().left,
    sc.getBoundingClientRect().left + sc.clientWidth - colMid) - 64));
  const snap = (id) => {
    const win = document.getElementById(id);
    const w = win.getBoundingClientRect();
    const s = win.querySelector(".md-table-scroll");
    return {
      stamped: win.hasAttribute("data-tema-reply"),
      grow: win.style.getPropertyValue("--tema-grow") || "",
      win: Math.round(w.width),
      offCentre: Math.round(Math.abs((w.left + w.right) / 2 - colMid)),
      scroll: s ? s.scrollWidth - s.clientWidth : null,
    };
  };
  const out = { colInner: Math.round(colInner), room: Math.round(room) };
  for (const id of ["fits", "wide", "huge"]) out[id] = snap(id);

  // A regenerated reply whose table now fits goes back to the column.
  document.querySelector("#wide .md-table-scroll").remove();
  await wait(700);
  out.shrunk = snap("wide");

  // Theme off: every grow stamp goes with it.
  chrome.storage.sync.set({ sites: { claude: null } });
  await wait(700);
  out.offLeft = document.querySelectorAll('[style*="--tema-grow"]').length;
  out.errors = window.__errors;
  document.title = "WIDE:" + JSON.stringify(out);
});
</script>
</body></html>`;

/* ------------------------------------------------------------------ drive */

async function render(name, html, budget) {
  const file = resolve(ROOT, "tools/tests/.wide-" + name + ".html");
  await writeFile(file, html, "utf8");
  try {
    const { stdout } = await run(CHROME, [
      "--headless", "--disable-gpu", "--allow-file-access-from-files",
      "--window-size=1600,1000", "--virtual-time-budget=" + budget, "--dump-dom",
      "file://" + file,
    ], { maxBuffer: 40 * 1024 * 1024 });
    const m = /<title>WIDE:([\s\S]*?)<\/title>/.exec(stdout);
    return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&")) : null;
  } finally {
    await rm(file, { force: true });
  }
}

let bad = 0;
const check = (ok, label, detail) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`);
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const g = await render("gpt", GPT_PAGE, 5000);
if (!g) {
  console.log("FAILED — the chatgpt page never reported");
  process.exit(1);
}
// Authored count, kept in step by hand: the window rule and the containment
// rule. Fewer means a selector was rejected and dropped.
check(g._parsed >= 2, "gpt: wide-reply rules parsed", `${g._parsed} :has(table) rules`);
{
  const r = g.narrow;
  check(r.win === r.col, "gpt: a table that fits keeps the window at the column", `win=${r.win} col=${r.col}`);
  check(r.tcLeft >= -1 && r.tcRight >= -1, "gpt: that table stays inside the frame", `left=${r.tcLeft} right=${r.tcRight}`);
  check(near(r.tableFill, 0, 2), "gpt: and fills the window's width, as the stock table fills the column", `slack=${r.tableFill}`);
}
{
  const r = g.grow;
  // Four small columns top out at 4 x 12rem of cells: more than the column,
  // well short of the cap. The window must stop where the table does.
  check(r.win > r.col && r.win < r.cap, "gpt: a wider table grows the window just enough, short of the cap", `win=${r.win} col=${r.col} cap=${r.cap}`);
  check(near(r.tableFill, 0, 2), "gpt: with no dead space beside the table", `slack=${r.tableFill}`);
  check(r.offCentre <= 1, "gpt: evenly both ways (centred on the column)", `off=${r.offCentre}`);
  check(r.scroll <= 1 && r.tcLeft >= -1 && r.tcRight >= -1, "gpt: the table fits inside the grown frame", `scroll=${r.scroll} left=${r.tcLeft} right=${r.tcRight}`);
}
{
  const r = g.cap;
  check(near(r.win, r.cap), "gpt: a table wider than the cap stops the window at the cap", `win=${r.win} cap=${r.cap}`);
  check(r.scroll > 0 && r.tcLeft >= -1 && r.tcRight >= -1, "gpt: and scrolls inside the frame instead of spilling", `scroll=${r.scroll} left=${r.tcLeft} right=${r.tcRight}`);
}
check(g.prose.win === g.prose.col, "gpt: long code and no-wrap text beside a table can't balloon the window", `win=${g.prose.win}`);
check(g.plain.win === g.plain.col, "gpt: a reply with no table is untouched", `win=${g.plain.win}`);
{
  const r = g.small;
  check(r.win === r.col, "gpt: a thread with no room to spare never grows", `win=${r.win} col=${r.col}`);
  check(r.tcLeft >= -1 && r.tcRight >= -1, "gpt: its table scrolls inside the frame", `scroll=${r.scroll} left=${r.tcLeft} right=${r.tcRight}`);
}

check(g._vars > 0, "gpt: the theme's variable block parsed", `--ff-window is ${g._vars ? "set" : "EMPTY"}`);

const h = await render("gpt-shell", GPT_SHELL_PAGE, 5000);
if (!h) {
  console.log("FAILED — the chatgpt app-shell page never reported");
  process.exit(1);
}
check(h._vars > 0, "shell: the theme's variable block parsed", `--ff-window is ${h._vars ? "set" : "EMPTY"}`);
// Authored count: the window rule and the containment rule.
check(h._parsed >= 2, "shell: wide-reply rules parsed", `${h._parsed} rules`);
{
  const r = h.narrow;
  check(r.win === r.col, "shell: a table that fits keeps the window at the column", `win=${r.win} col=${r.col}`);
  check(r.tcLeft >= -1 && r.tcRight >= -1, "shell: that table stays inside the frame", `left=${r.tcLeft} right=${r.tcRight}`);
  check(near(r.tableFill, 0, 2), "shell: and fills the window's width, as the stock table fills the column", `slack=${r.tableFill}`);
}
{
  const r = h.grow;
  check(r.win > r.col && r.win < r.cap, "shell: a wider table grows the window just enough, short of the cap", `win=${r.win} col=${r.col} cap=${r.cap}`);
  check(near(r.tableFill, 0, 2), "shell: with no dead space beside the table", `slack=${r.tableFill}`);
  check(r.offCentre <= 1, "shell: evenly both ways (centred on the column)", `off=${r.offCentre}`);
  check(r.scroll <= 1 && r.tcLeft >= -1 && r.tcRight >= -1, "shell: the table fits inside the grown frame", `scroll=${r.scroll} left=${r.tcLeft} right=${r.tcRight}`);
}
{
  const r = h.cap;
  check(near(r.win, r.cap), "shell: a table wider than the cap stops the window at the cap", `win=${r.win} cap=${r.cap}`);
  check(r.scroll > 0 && r.tcLeft >= -1 && r.tcRight >= -1, "shell: and scrolls inside the frame instead of spilling", `scroll=${r.scroll} left=${r.tcLeft} right=${r.tcRight}`);
}
check(h.prose.win === h.prose.col, "shell: long code and no-wrap text beside a table can't balloon the window", `win=${h.prose.win}`);
check(h.plain.win === h.plain.col, "shell: a reply with no table is untouched", `win=${h.plain.win}`);
{
  const r = h.small;
  check(r.win === r.col, "shell: a thread with no room to spare never grows", `win=${r.win} col=${r.col}`);
  check(r.tcLeft >= -1 && r.tcRight >= -1, "shell: its table scrolls inside the frame", `scroll=${r.scroll} left=${r.tcLeft} right=${r.tcRight}`);
}

const c = await render("claude", CLAUDE_PAGE, 9000);
if (!c) {
  console.log("FAILED — the claude page never reported (a throw at load time stops everything)");
  process.exit(1);
}
check(!c.errors.length, "claude: the content scripts ran clean", c.errors.join(" | "));
check(c.fits.stamped && c.wide.stamped && c.huge.stamped, "claude: all three replies framed");
check(!c.fits.grow && c.fits.scroll <= 0, "claude: a table that fits is left alone", `grow='${c.fits.grow}' win=${c.fits.win}`);
check(!!c.wide.grow && c.wide.scroll <= 1, "claude: a table too wide for the column grows the window until it fits", `grow=${c.wide.grow} win=${c.wide.win} scroll=${c.wide.scroll}`);
check(c.wide.offCentre <= 1, "claude: evenly both ways (centred on the column)", `off=${c.wide.offCentre}`);
check(near(c.huge.win, c.room, 2) && c.huge.scroll > 0, "claude: a table past the room stops at it and scrolls inside", `win=${c.huge.win} room=${c.room} scroll=${c.huge.scroll}`);
check(!c.shrunk.grow && c.shrunk.win === c.fits.win, "claude: once the wide table is gone the window returns to the column", `grow='${c.shrunk.grow}' win=${c.shrunk.win}`);
check(c.offLeft === 0, "claude: turning the theme off clears every grow stamp", `${c.offLeft} left`);

console.log(bad ? `\n${bad} check(s) failed` : "\nall wide-reply checks passed");
process.exit(bad ? 1 : 0);
