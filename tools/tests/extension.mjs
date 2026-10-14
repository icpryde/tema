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

import { createServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findTestBrowser, launch, extensionId } from "../lib/browser.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = process.argv.includes("--shots");

const binary = await findTestBrowser();
if (!binary) {
  console.log("skipped — no Chrome for Testing or Chromium found (branded Chrome ignores --load-extension).");
  console.log("Install one with: npx @puppeteer/browsers install chrome@stable, or set CHROME_FOR_TESTING.");
  process.exit(0);
}

/* ------------------------------------------------------- the stand-ins */

// Just enough of each site for the engine and the theme to find their
// footing: a composer, a settled reply, a sidebar row.
const PAGES = {
  "claude.ai": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>claude stand-in</title>
<style>body{margin:0;background:#262624;color:#eee;font:14px system-ui}main{padding:40px 80px}
.cursor-text{position:relative;margin-top:120px;min-height:70px;border:1px solid #444;border-radius:16px}</style></head>
<body class="font-ui"><aside class="dframe-sidebar"><div class="dframe-sidebar-body">
<a data-row-main-button href="#"><span class="df-leading-slot"></span><span>A chat</span></a></div></aside>
<main class="dframe-content"><div role="article"><div data-is-streaming="false" id="reply" class="group relative">
<div class="font-claude-response"><p>A settled reply.</p></div></div></div>
<div class="sticky bottom-0"><fieldset><div class="cursor-text" id="composer">
<div data-testid="chat-input" role="textbox" contenteditable="true"></div></div></fieldset></div></main></body></html>`,

  "chatgpt.com": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>chatgpt stand-in</title>
<style>body{margin:0;background:#212121;color:#eee;font:14px system-ui}main{padding:40px 80px}
[data-composer-surface-variant]{min-height:60px;border-radius:28px;background:#303030;margin-top:120px}</style></head>
<body><main><div data-turn-key="t1">
<div data-chatgpt-search-unit-key="t1:user"><div data-user-message-bubble>hello</div></div>
<div data-chatgpt-search-unit-key="t1:assistant" id="reply"><div data-markdown-text-style="assistant-message"><p>A settled reply.</p></div>
<div class="turn-action-controls"><button aria-label="Copy">c</button></div></div></div>
<form data-chatgpt-composer data-composer-placement="home"><div id="stage"><div data-composer-surface-variant id="composer">
<div class="ProseMirror" data-composer-markdown contenteditable="true"></div></div></div></form></main></body></html>`,

  "gemini.google.com": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>gemini stand-in</title>
<style>body{margin:0;background:#131314;color:#eee;font:14px system-ui}main{padding:40px 80px}
.input-area-container{display:flex;flex-direction:column;margin-top:120px;border-radius:28px}
input-area-v2{display:block;min-height:56px;background:#1e1f20;border-radius:28px}</style></head>
<body class="dark-theme"><main><div class="conversation-container">
<user-query><span class="user-query-bubble-with-background">hello</span></user-query>
<model-response id="reply"><div class="response-container"><div class="response-container-content">
<message-content><div class="markdown"><p>A settled reply.</p></div></message-content></div></div>
<message-actions><button aria-label="Copy">c</button></message-actions></model-response></div>
<input-container><div class="input-area-container" id="composer"><input-area-v2><div class="input-area">
<rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea></div></input-area-v2></div></input-container>
</main></body></html>`,
};

/* --------------------------------------------------------- the server */

const certDir = await mkdtemp(join(tmpdir(), "tema-cert-"));
await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-subj", "/CN=tema-test", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem")]);
const server = createServer({
  key: await readFile(join(certDir, "key.pem")),
  cert: await readFile(join(certDir, "cert.pem")),
}, (req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  if (req.url === "/" && PAGES[host]) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGES[host]);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

/* ----------------------------------------------------------- the run */

let failed = 0;
const check = (ok, label, detail = "") => {
  if (ok) console.log(`ok   ${label}${detail ? "   " + detail : ""}`);
  else { failed++; console.log(`FAIL ${label}${detail ? "   " + detail : ""}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // fonts.load() rather than fonts.check(): a background tab that has not
  // painted has not asked for the face yet, which check() reports as missing.
  const state = (tab) => tab.eval(`(async () => {
    const root = document.documentElement;
    const composer = document.getElementById("composer");
    const cs = composer && getComputedStyle(composer);
    return {
      theme: root.getAttribute("data-tema"),
      opts: root.getAttribute("data-tema-opt"),
      party: document.querySelectorAll(".ff-party-member").length,
      reply: !!document.querySelector("#reply[data-tema-reply]"),
      border: cs ? cs.borderTopWidth + " " + cs.borderTopColor : null,
      font: (await document.fonts.load('8px "FF Press Start"')).length > 0,
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
  await wait(900);
  for (const [site, tab] of Object.entries(tabs)) {
    const s = await state(tab);
    check(s.theme === "final-fantasy", `${site}: wears the theme after the popup click`, `data-tema=${s.theme}`);
    check(s.opts === "menu-sounds bottom-scenery", `${site}: default options stamped`, `data-tema-opt=${s.opts}`);
    check(s.party === 4, `${site}: the party is on the message box`, `${s.party} members`);
    check(s.reply, `${site}: the settled reply is framed (page signals)`);
    check(s.border === "2px rgb(255, 255, 255)", `${site}: the composer is a menu window`, s.border);
    check(s.font, `${site}: the pixel font loaded`);
  }
  check(await popup.eval(`[...document.querySelectorAll('.wear')].every((w) => w.classList.contains('on'))`),
    "popup: every site shows the theme it wears");

  // An option, from the card's settings.
  await click('.card[data-theme="final-fantasy"] .gear');
  await popup.eval(`(() => { const b = document.querySelector('.switch[data-opt="rich-text"]'); b.click(); })()`);
  await wait(500);
  for (const [site, tab] of Object.entries(tabs)) {
    const s = await state(tab);
    check(/rich-text/.test(s.opts || ""), `${site}: an option turned on in the popup reaches the page`, `data-tema-opt=${s.opts}`);
  }

  // A popup button: the chocobo.
  await popup.eval(`[...document.querySelectorAll('.action-btn')].find((b) => b.textContent === "Parkour").click()`);
  await wait(400);
  check((await state(tabs.claude)).choco, "claude: the chocobo button sends one across the open tab");
  if (SHOTS) {
    const h = await popup.eval("document.documentElement.scrollHeight");
    await writeFile(join(ROOT, "docs/screenshots/popup.png"), await popup.screenshot({ x: 0, y: 0, width: 372, height: h }));
    console.log("wrote docs/screenshots/popup.png");
  }

  // Take one site off; the others keep the theme.
  await click(pill("claude"));
  await wait(600);
  const off = await state(tabs.claude);
  check(off.theme === null && off.party === 0 && !off.reply, "claude: off again, nothing left behind",
    `theme=${off.theme} party=${off.party} reply=${off.reply}`);
  check((await state(tabs.chatgpt)).theme === "final-fantasy", "chatgpt: unaffected by claude going off");

  for (const [site, tab] of Object.entries({ ...tabs, popup })) {
    check(!tab.errors.length, `${site}: no errors`, tab.errors.join(" | ").slice(0, 300));
  }
} finally {
  await browser.close();
  server.close();
  await rm(certDir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nthe installed extension works end to end on all three sites");
process.exit(failed ? 1 : 0);
