// Tema — working-glyph state test (Final Fantasy on claude.ai).
//
//   node tools/tests/glyph.mjs
//
// The moogle replacing Claude's working glyph has regressed in a dozen ways,
// every time because a state only reachable on the live site behaved unlike the
// mock. This reproduces the REAL markup — transcribed from console dumps of
// claude.ai — in each state, and asserts on computed style rather than eyeball:
//
//   1. the original glyph is not visible
//   2. a moogle is drawn in its place
//   3. exactly one moogle per state, never two
//
// Structures below are verbatim from the page; do not "tidy" the class strings.

import { writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../lib/chrome.mjs";
import { ENGINE, dumpTitle } from "../lib/webkit.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = findChrome();

// The status button, exactly as claude.ai renders it.
const statusButton = `
  <button class="group/status flex items-center gap-2 py-1 text-sm transition-colors text-left cursor-pointer text-text-500">
    <div class="relative h-5 flex items-center justify-center shrink-0 overflow-hidden transition-[width,margin-right]">
      <div class="pt-1 transition-opacity duration-150 motion-reduce:transition-none">
        <svg data-cds="Spark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="20" height="20" fill="#d97757" aria-hidden="true"><path d="M50 0 60 40 100 50 60 60 50 100 40 60 0 50 40 40Z"/></svg>
      </div>
    </div>
    <span class="inline-flex items-center gap-1 min-w-0"><span class="truncate font-base">Weighing options</span></span>
  </button>`;

// The sprite-strip logo, both sizes, as dumped from the page.
const stripLogo = (px) => `
  <div class="${px === 20 ? "!w-5 !text-brand-200 " : ""}w-8 text-accent-brand inline-block overflow-hidden select-none" data-state="closed">
    <div class="[&>svg]:block [&>svg]:w-full [&>svg]:fill-current" style="transform: matrix(1,0,0,1,0,-${px * 3})">
      <svg viewBox="0 0 ${px} ${px * 9}" width="${px}" height="${px * 9}" fill="#ffd35c"><path d="M0 0h${px}v${px * 9}H0z"/></svg>
    </div>
  </div>`;

const STATES = {
  // Claude is working. The reply body is NOT empty on the real site: the
  // streamed reasoning already sits inside it, collapsed and marked
  // data-find-omitted (captured from claude.ai). The page signals deliberately do
  // not stamp data-tema-reply for that text — stamping mid-thinking is what
  // flickered the moogle — so this state models the wrapper unstamped WITH
  // the hidden text present.
  thinking: `
    <div role="article"><div class="contents">
      <div data-is-streaming="true" class="group relative">
        <div class="font-claude-response">
          <div><div data-find-omitted>streamed reasoning, collapsed behind the status row</div>
          <div class="overflow-hidden" data-find-omitted></div></div>
        </div>
        ${statusButton}
      </div>
    </div></div>`,

  // Same, plus the strip logo mounted alongside — the state the recording shows.
  thinkingWithLogo: `
    <div role="article"><div class="contents">
      <div data-is-streaming="true" class="group relative">
        <div class="font-claude-response"></div>
        ${statusButton}
      </div>
    </div></div>
    ${stripLogo(32)}`,

  // The 2026-10 transcript, recorded live 2026-10-14. Just after you send:
  // the new reply is mounted busy, before data-is-streaming exists, its
  // status row pending with the Spark and the clay WorkingMark in its
  // leading slot; the page signals have stamped it working. The last reply
  // is still the latest. One Mog, hopping, under the new turn.
  cdsPending: `
    <div data-cds="AssistantMessage" data-testid="assistant-message" data-turn-key data-is-streaming="false" data-tema-reply="1" data-tema-latest class="group/message-row relative flex w-full min-w-0 flex-col gap-xs">
      <div class="flex min-w-0 flex-col"><div data-cds="TurnStatus" data-find-omitted data-state="done" class="group/status flex w-full min-w-0 flex-col"><div><span><span>Figured it out</span></span></div></div>
      <div class="min-w-0"><div class="grid"><div data-transcript-engine-root class="contents"><div class="prose"><p>The last reply.</p></div></div></div></div></div>
      <div class="print:mt-xs"><div data-cds="MessageActions" role="toolbar"><button aria-label="Copy">c</button></div></div>
    </div>
    <div data-cds="AssistantMessage" data-busy data-tema-working data-testid="assistant-message" data-turn-key class="group/message-row relative flex w-full min-w-0 flex-col gap-xs">
      <div class="flex min-w-0 flex-col"><div data-cds="TurnStatus" data-pending-status data-find-omitted data-state="pending" class="group/status flex w-full min-w-0 flex-col">
        <div tabindex="-1" class="flex min-w-0 gap-xs"><span aria-hidden="true" data-cds-row-mark class="relative flex h-[1lh] shrink-0 items-center justify-center w-[20px]">
          <span class="absolute top-1/2 left-1/2 flex size-icon"><svg data-cds="Spark" width="100%" height="100%" fill="var(--cds-clay, #d97757)" aria-hidden="true" class="shrink-0" viewBox="0 0 100 100"><path d="M50 0 60 40 100 50 60 60 50 100 40 60 0 50 40 40Z"/></svg></span>
          <span class="absolute inset-0 flex items-center justify-center"><span class="relative flex size-[20px] shrink-0 items-center"><span class="absolute inset-0 opacity-100">
            <span data-testid="TurnStatusClayMark" aria-hidden="true" data-cds="WorkingMark" class="relative block shrink-0 select-none" style="width:8px;height:8px;color:#d97757"><span class="absolute inset-0 m-auto block rounded-full bg-current" style="position:absolute;inset:0;background:currentColor;border-radius:50%"></span></span>
          </span></span></span>
        </span><span class="flex min-w-0 gap-xs items-center">Crystallizing</span></div>
      </div>
      <div class="min-w-0"><div class="grid"><div data-transcript-engine-root class="contents"></div></div></div></div>
    </div>`,

  // The 2026-10 transcript at rest: Mog parked under the newest reply.
  cdsFinished: `
    <div data-cds="AssistantMessage" data-testid="assistant-message" data-turn-key data-is-streaming="false" data-tema-reply="1" data-tema-latest class="group/message-row relative flex w-full min-w-0 flex-col gap-xs">
      <div class="flex min-w-0 flex-col"><div data-cds="TurnStatus" data-find-omitted data-state="done" class="group/status flex w-full min-w-0 flex-col"><div><span><span>Figured it out</span></span></div></div>
      <div class="min-w-0"><div class="grid"><div data-transcript-engine-root class="contents"><div class="prose"><p>A finished reply.</p></div></div></div></div></div>
      <div class="print:mt-xs"><div data-cds="MessageActions" role="toolbar"><button aria-label="Copy">c</button></div></div>
    </div>`,

  // Finished: the reply has text, and the status row is now its summary line.
  finished: `
    <div role="article"><div class="contents">
      <div data-is-streaming="false" data-tema-reply="1" class="group relative">
        ${statusButton}
        <div class="font-claude-response"><p>A finished reply.</p></div>
      </div>
    </div></div>
    ${stripLogo(32)}`,
};

const page = `<!doctype html>
<html lang="en" data-tema="final-fantasy">
<head><meta charset="utf-8">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/sprites/moogle.css">
<link rel="stylesheet" href="../../themes/final-fantasy/assets/sprites/crystal.css">
<link rel="stylesheet" href="../../themes/final-fantasy/claude.css">
</head>
<body>
${Object.entries(STATES).map(([k, html]) => `<main class="dframe-content" id="${k}">${html}</main>`).join("\n")}
<script>
window.addEventListener("load", () => {
  const drawsMoogle = (el) => {
    const a = getComputedStyle(el, "::after");
    return a.content !== "none" && /moogle|data:image/.test(a.backgroundImage);
  };
  const visible = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const c = getComputedStyle(n);
      if (c.opacity === "0" || c.visibility === "hidden" || c.display === "none") return false;
      n = n.parentElement;
    }
    return true;
  };

  // Invalid selectors are dropped SILENTLY by the browser — a :has() nested
  // inside another :has() is invalid, and losing that rule is exactly how both
  // slots ended up drawing a moogle with no error anywhere. So assert the
  // stylesheet kept every rule it was given.
  const authored = {};
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules } catch { continue }
    for (const r of rules || []) if (r.selectorText) {
      // Plain includes(), not a regex: this lives inside a template literal,
      // where an escaped forward slash collapses and breaks the pattern.
      const t = r.selectorText;
      if (t.includes("group") || t.includes("text-accent-brand") || t.includes("text-brand-200")) {
        // Full text as the key: truncating collides distinct rules and
        // under-counts, which reads as "a rule was dropped".
        authored[r.selectorText] = true;
      }
    }
  }
  const out = { _parsedGlyphRules: Object.keys(authored).length };
  for (const state of ${JSON.stringify(Object.keys(STATES))}) {
    const root = document.getElementById(state);
    const glyphs = [...root.querySelectorAll('svg[data-cds="Spark"], [data-cds="WorkingMark"], div[class~="text-accent-brand"] svg, div[class~="text-brand-200"] svg')];
    const moogles = [...root.querySelectorAll("*")].filter(drawsMoogle);
    out[state] = {
      visibleGlyphs: glyphs.filter(visible).length,
      moogles: moogles.length,
      visibleMoogles: moogles.filter(visible).length,
      hopping: moogles.filter(visible).filter((el) => /ff-moogle-hop/.test(getComputedStyle(el, "::after").animationName)).length,
      where: moogles.filter(visible).map((el) => {
        const a = getComputedStyle(el, "::after");
        return (el.tagName.toLowerCase() + "." +
          (el.className || "").toString().split(/\s+/).slice(0, 2).join(".")) +
          " content=" + a.content.slice(0, 6);
      }),
    };
  }
  document.title = "GLYPH:" + JSON.stringify(out);
});
</script>
</body></html>`;

const file = resolve(ROOT, "tools/tests/.glyph.html");
await writeFile(file, page, "utf8");

// TEMA_ENGINE=webkit: the same page in WebKit, Safari's engine.
const { stdout } = ENGINE === "webkit"
  ? { stdout: await dumpTitle(file, "GLYPH:", { timeout: 20 }) }
  : await run(CHROME, [
    "--headless", "--disable-gpu", "--allow-file-access-from-files",
    "--virtual-time-budget=4000", "--dump-dom", "file://" + file,
  ], { maxBuffer: 40 * 1024 * 1024 });

await rm(file, { force: true });

const m = /<title>GLYPH:([\s\S]*?)<\/title>/.exec(stdout);
if (!m) { console.log("FAILED — page never reported"); process.exit(1); }

const res = JSON.parse(m[1].replace(/&quot;/g, '"'));
let bad = 0;

// Authored count, kept in step by hand: if a rule stops parsing this drops and
// the test fails instead of the behaviour quietly changing.
const EXPECT_GLYPH_RULES = 7;
const parsed = res._parsedGlyphRules;
delete res._parsedGlyphRules;
if (parsed < EXPECT_GLYPH_RULES) {
  bad++;
  console.log(`FAIL selector parsing   ${parsed} glyph rules survived, expected >= ${EXPECT_GLYPH_RULES}` +
              " — a selector was rejected and dropped");
} else {
  console.log(`ok   selector parsing   ${parsed} glyph rules parsed`);
}

for (const [state, r] of Object.entries(res)) {
  // Finished state deliberately shows no moogle on the status row — the crystal
  // is the marker there — but the strip logo under the reply still gets one.
  const wantMoogles = 1;
  // On the 2026-10 transcript Mog hops while the turn works, and only then.
  const wantHop = state === "cdsPending" ? 1 : state === "cdsFinished" ? 0 : r.hopping;
  const ok = r.visibleGlyphs === 0 && r.visibleMoogles === wantMoogles && r.hopping === wantHop;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${state.padEnd(18)} visibleGlyphs=${r.visibleGlyphs} (want 0)  ` +
    `visibleMoogles=${r.visibleMoogles} (want ${wantMoogles})  hopping=${r.hopping} (want ${wantHop})` +
    (ok ? "" : "\n       drawn on: " + (r.where || []).join("  |  "))
  );
}
console.log(bad ? `\n${bad} state(s) wrong` : "\nall states correct");
process.exit(bad ? 1 : 0);
