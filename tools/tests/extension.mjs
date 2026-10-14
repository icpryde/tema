// Tema — the extension end to end, as installed.
//
//   node tools/tests/extension.mjs [--shots]
//
// Every other suite loads Tema's files into stand-in pages by hand. This one
// loads the extension itself (unpacked, into Chrome for Testing) and serves
// stand-in pages AT THE REAL HOSTNAMES — claude.ai, chatgpt.com and
// gemini.google.com are mapped to a local HTTPS server — so the manifest's
// own content-script and stylesheet lists do the injecting. Then it drives
// the real popup: put the theme on each site, change an option, press a
// chocobo button, take a site off, and checks every open tab follows.
//
// --shots also saves the popup to docs/screenshots/popup.png.
//
// Skips (exit 0, with a note) when no Chrome for Testing / Chromium is
// installed: branded Chrome ignores --load-extension.

import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findTestBrowser, launch, extensionId } from "../lib/browser.mjs";
import { PAGES, startStandIns } from "../lib/stand-ins.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.argv.includes("--shots");

const binary = await findTestBrowser();
if (!binary) {
  console.log("skipped — no Chrome for Testing or Chromium found (branded Chrome ignores --load-extension).");
  console.log("Install one with: npx @puppeteer/browsers install chrome@stable, or set CHROME_FOR_TESTING.");
  process.exit(0);
}

/* ------------------------------------------------------- the stand-ins */

// At the real hostnames: --host-rules below maps them to the local server.
const standIns = await startStandIns();
const port = standIns.port;

/* ----------------------------------------------------------- the run */

let failed = 0;
const check = (ok, label, detail = "") => {
  if (ok) console.log(`ok   ${label}${detail ? "   " + detail : ""}`);
  else { failed++; console.log(`FAIL ${label}${detail ? "   " + detail : ""}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll rather than sleep: the site tabs sit behind the popup, and Chrome
// aligns a background tab's timers to whole seconds, so how long the
// engine's debounced pass takes to land varies run to run.
async function until(read, ok, ms = 6000) {
  const end = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < end) { await wait(150); v = await read(); }
  return v;
}

const browser = await launch({
  binary,
  extPath: ROOT,
  args: [
    "--ignore-certificate-errors",
    "--host-rules=" + Object.keys(PAGES).map((h) => `MAP ${h} 127.0.0.1:${port}`).join(","),
  ],
});

try {
  const tabs = {};
  for (const [site, host] of [["claude", "claude.ai"], ["chatgpt", "chatgpt.com"], ["gemini", "gemini.google.com"]]) {
    tabs[site] = await browser.page(`https://${host}/`);
  }
  await wait(500);

  // Ask for the face, then look for one that LOADED: a background tab that
  // has not painted has not requested it yet, and where the page refuses the
  // stylesheet's data: copy that copy errors and load() rejects, while the
  // engine's FontFace copy still carries the text.
  const state = (tab) => tab.eval(`(async () => {
    try { await document.fonts.load('8px "FF Press Start"'); } catch { /* a refused copy */ }
    const root = document.documentElement;
    const composer = document.getElementById("composer");
    const cs = composer && getComputedStyle(composer);
    return {
      theme: root.getAttribute("data-tema"),
      opts: root.getAttribute("data-tema-opt"),
      party: document.querySelectorAll(".ff-party-member").length,
      reply: !!document.querySelector("#reply[data-tema-reply]"),
      border: cs ? cs.borderTopWidth + " " + cs.borderTopColor : null,
      font: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "FF Press Start" && f.status === "loaded"),
      choco: !!document.querySelector(".ff-choco-sky, .ff-choco-clip"),
    };
  })()`);

  for (const [site, tab] of Object.entries(tabs)) {
    const s = await state(tab);
    check(s.theme === null && s.party === 0, `${site}: untouched before any theme is on`, `theme=${s.theme} party=${s.party}`);
  }

  const popup = await browser.page(null, { width: 372, height: 600 });
  await popup.goto(`chrome-extension://${extensionId(ROOT)}/src/popup/popup.html`);
  await wait(600);
  check(await popup.eval("document.querySelectorAll('.card').length") >= 1, "popup lists the themes");
  check(await popup.eval("!!document.querySelector('.card[data-theme=final-fantasy] .ff-card')"), "popup draws the theme's card art");

  const click = (sel) => popup.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const pill = (site) => `.card[data-theme="final-fantasy"] .site[data-site="${site}"]`;

  // Put the theme on all three sites from the popup.
  for (const site of ["claude", "chatgpt", "gemini"]) await click(pill(site));
  for (const [site, tab] of Object.entries(tabs)) {
    const s = await until(() => state(tab), (v) => v.party === 4 && v.reply && v.font);
    check(s.theme === "final-fantasy", `${site}: wears the theme after the popup click`, `data-tema=${s.theme}`);
    check(s.opts === "menu-sounds bottom-scenery", `${site}: default options stamped`, `data-tema-opt=${s.opts}`);
    check(s.party === 4, `${site}: the party is on the message box`, `${s.party} members`);
    check(s.reply, `${site}: the settled reply is framed (page signals)`);
    check(s.border === "2px rgb(255, 255, 255)", `${site}: the composer is a menu window`, s.border);
    check(s.font, `${site}: the pixel font loaded${site === "claude" ? " (under claude.ai's no-data:-fonts policy)" : ""}`);
  }
  check(await popup.eval(`[...document.querySelectorAll('.wear')].every((w) => w.classList.contains('on'))`),
    "popup: every site shows the theme it wears");
  // Chrome grants a manifest's sites at install; the notice Safari needs
  // (a worn site Tema isn't allowed into) must never show here.
  check(await popup.eval(`document.getElementById("access").hidden`), "popup: no site-access notice in Chrome");

  // An option, from the card's settings.
  await click('.card[data-theme="final-fantasy"] .gear');
  await popup.eval(`(() => { const b = document.querySelector('.switch[data-opt="rich-text"]'); b.click(); })()`);
  for (const [site, tab] of Object.entries(tabs)) {
    const s = await until(() => state(tab), (v) => /rich-text/.test(v.opts || ""));
    check(/rich-text/.test(s.opts || ""), `${site}: an option turned on in the popup reaches the page`, `data-tema-opt=${s.opts}`);
  }

  // A popup button: the chocobo.
  await popup.eval(`[...document.querySelectorAll('.action-btn')].find((b) => b.textContent === "Parkour").click()`);
  check((await until(() => state(tabs.claude), (v) => v.choco)).choco, "claude: the chocobo button sends one across the open tab");
  if (SHOTS) {
    const h = await popup.eval("document.documentElement.scrollHeight");
    await writeFile(join(ROOT, "docs/screenshots/popup.png"), await popup.screenshot({ x: 0, y: 0, width: 372, height: h }));
    console.log("wrote docs/screenshots/popup.png");
  }

  // Take one site off; the others keep the theme.
  await click(pill("claude"));
  const off = await until(() => state(tabs.claude), (v) => v.theme === null && v.party === 0 && !v.reply);
  check(off.theme === null && off.party === 0 && !off.reply, "claude: off again, nothing left behind",
    `theme=${off.theme} party=${off.party} reply=${off.reply}`);
  check((await state(tabs.chatgpt)).theme === "final-fantasy", "chatgpt: unaffected by claude going off");

  for (const [site, tab] of Object.entries({ ...tabs, popup })) {
    check(!tab.errors.length, `${site}: no errors`, tab.errors.join(" | ").slice(0, 300));
  }
} finally {
  await browser.close();
  await standIns.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nthe installed extension works end to end on all three sites");
process.exit(failed ? 1 : 0);
