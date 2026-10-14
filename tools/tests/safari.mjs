// Tema — the Safari build end to end, in WebKit's extension runtime.
//
//   node tools/tests/safari.mjs
//
// The Safari twin of extension.mjs. It stages the Safari web extension
// (tools/safari.mjs) and loads it into WKWebExtension, the engine under
// Safari's own extensions, through tools/safari/harness.swift: no Safari to
// enable it in, no website access to grant. The stand-in pages are served at
// the real hostnames through a local proxy, so the Safari manifest's own
// matches decide what runs, and the run follows extension.mjs: put the theme
// on each site from the real popup, change an option, press a chocobo
// button, take a site off. It also checks what only Safari's build does: the
// stylesheet arrives inside the content script (the manifest lists no CSS)
// and is adopted as a constructed stylesheet.
//
// Skips (exit 0, with a note) off macOS, without the Xcode command line tools,
// or on macOS older than 15.4 (no WKWebExtension).

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, startStandIns } from "../lib/stand-ins.mjs";
import { stage, STAGE } from "../safari.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

if (process.platform !== "darwin") {
  console.log("skipped — the Safari build is tested with WebKit on macOS");
  process.exit(0);
}
const { stdout: osVersion } = await run("sw_vers", ["-productVersion"]);
const [major, minor] = osVersion.trim().split(".").map(Number);
if (major < 15 || (major === 15 && minor < 4)) {
  console.log(`skipped — macOS ${osVersion.trim()} has no WKWebExtension (15.4 or later)`);
  process.exit(0);
}

/* ------------------------------------------------------- the harness */

const HARNESS_SRC = join(ROOT, "tools/safari/harness.swift");
const HARNESS = join(ROOT, "safari/build/harness");

/** The compiled harness, rebuilt when its source is newer. */
async function harnessBinary() {
  const src = await stat(HARNESS_SRC);
  const bin = await stat(HARNESS).catch(() => null);
  if (bin && bin.mtimeMs >= src.mtimeMs) return HARNESS;
  await mkdir(dirname(HARNESS), { recursive: true });
  try {
    await run("xcrun", ["swiftc", "-O", "-o", HARNESS, HARNESS_SRC]);
  } catch (err) {
    if (err.code === "ENOENT" || /xcrun: error/.test(err.stderr || "")) {
      console.log("skipped — no Swift compiler (install the Xcode command line tools)");
      process.exit(0);
    }
    throw new Error("the harness didn't compile:\n" + (err.stderr || err.message));
  }
  return HARNESS;
}

/** Spawn the harness on `extDir`; returns { send, info, close }. */
async function startHarness(extDir, proxyPort, { ask = false } = {}) {
  const args = [extDir, "--proxy", String(proxyPort), ...(ask ? ["--ask"] : [])];
  const child = spawn(await harnessBinary(), args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const pending = new Map();
  let ready;
  const readyP = new Promise((r, reject) => {
    ready = r;
    child.on("exit", (code) => reject(new Error(`the harness exited (${code}) before it was ready\n${stderr.trim()}`)));
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === "ready") return ready(m);
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); p(m); }
  });
  const hello = await readyP;
  if (!hello.ok) throw new Error("the harness couldn't load the extension: " + hello.error);
  let n = 0;
  const send = (cmd, ms = 30000) => new Promise((resolveSend, reject) => {
    const id = ++n;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`no reply to ${cmd.cmd} in ${ms}ms`)); }, ms);
    pending.set(id, (m) => { clearTimeout(timer); resolveSend(m); });
    child.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
  });
  return {
    info: hello.value,
    send,
    async close() {
      await send({ cmd: "quit" }, 3000).catch(() => {});
      child.kill();
    },
  };
}

/* ----------------------------------------------------------- the run */

let failed = 0;
const check = (ok, label, detail = "") => {
  if (ok) console.log(`ok   ${label}${detail ? "   " + detail : ""}`);
  else { failed++; console.log(`FAIL ${label}${detail ? "   " + detail : ""}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll rather than sleep: the pages live in views nobody sees, and WebKit
// throttles their timers, so the engine's debounced pass lands when it does.
async function until(read, ok, ms = 8000) {
  const end = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < end) { await wait(200); v = await read(); }
  return v;
}

await stage();
const manifest = JSON.parse(await readFile(join(STAGE, "manifest.json"), "utf8"));
check(manifest.content_scripts.every((e) => !e.css && /^src\/safari\//.test(e.js[0])),
  "the Safari manifest lists no CSS; each site's stylesheet loads first, as a script");

const standIns = await startStandIns({ proxy: true });
const harness = await startHarness(STAGE, standIns.proxyPort);

try {
  const { send } = harness;
  const call = async (cmd) => {
    const r = await send(cmd);
    if (!r.ok) throw new Error(`${cmd.cmd} ${cmd.tab || ""}: ${r.error}`);
    return r.value;
  };
  const evalIn = (tab, js) => call({ cmd: "eval", tab, js });

  const SITES = [["claude", "claude.ai"], ["chatgpt", "chatgpt.com"], ["gemini", "gemini.google.com"]];
  for (const [site, host] of SITES) await call({ cmd: "open", tab: site, url: `https://${host}/` });
  if (Object.keys(PAGES).length !== SITES.length) throw new Error("a stand-in has no tab here");

  const state = (tab) => evalIn(tab, `
    try { await document.fonts.load('8px "FF Press Start"'); } catch { /* a refused copy */ }
    const root = document.documentElement;
    const composer = document.getElementById("composer");
    const cs = composer && getComputedStyle(composer);
    const reply = document.getElementById("reply");
    return {
      theme: root.getAttribute("data-tema"),
      opts: root.getAttribute("data-tema-opt"),
      party: document.querySelectorAll(".ff-party-member").length,
      reply: !!(reply && reply.hasAttribute("data-tema-reply")),
      border: cs ? cs.borderTopWidth + " " + cs.borderTopColor : null,
      font: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "FF Press Start" && f.status === "loaded"),
      choco: !!document.querySelector(".ff-choco-sky, .ff-choco-clip"),
      adopted: document.adoptedStyleSheets.length,
      mog: reply ? getComputedStyle(reply, "::after").content : null,
    };
  `);

  for (const [site] of SITES) {
    const s = await until(() => state(site), (v) => v.adopted >= 1);
    check(s.theme === null && s.party === 0, `${site}: untouched before any theme is on`, `theme=${s.theme} party=${s.party}`);
    check(s.adopted >= 1, `${site}: the stylesheet is adopted from the content script`, `${s.adopted} adopted`);
  }

  await call({ cmd: "popup", tab: "popup", path: "src/popup/popup.html" });
  await wait(600);
  check(await evalIn("popup", "return document.querySelectorAll('.card').length") >= 1, "popup lists the themes");
  check(await evalIn("popup", "return !!document.querySelector('.card[data-theme=final-fantasy] .ff-card')"), "popup draws the theme's card art");

  const click = (sel) => evalIn("popup", `document.querySelector(${JSON.stringify(sel)}).click()`);
  const pill = (site) => `.card[data-theme="final-fantasy"] .site[data-site="${site}"]`;

  for (const [site] of SITES) await click(pill(site));
  for (const [site] of SITES) {
    const s = await until(() => state(site), (v) => v.party === 4 && v.reply && v.font);
    check(s.theme === "final-fantasy", `${site}: wears the theme after the popup click`, `data-tema=${s.theme}`);
    check(s.opts === "menu-sounds bottom-scenery", `${site}: default options stamped`, `data-tema-opt=${s.opts}`);
    check(s.party === 4, `${site}: the party is on the message box`, `${s.party} members`);
    check(s.reply, `${site}: the settled reply is framed (page signals)`);
    check(s.border === "2px rgb(255, 255, 255)", `${site}: the composer is a menu window`, s.border);
    check(s.font, `${site}: the pixel font loaded${site === "claude" ? " (under claude.ai's no-data:-fonts policy)" : ""}`);
  }
  const claudeMog = await until(() => state("claude"), (v) => v.mog === '""');
  check(claudeMog.mog === '""', "claude: Mog stands under the newest reply", `content=${claudeMog.mog}`);
  check(await evalIn("popup", "return [...document.querySelectorAll('.wear')].every((w) => w.classList.contains('on'))"),
    "popup: every site shows the theme it wears");

  await click('.card[data-theme="final-fantasy"] .gear');
  await evalIn("popup", `document.querySelector('.switch[data-opt="rich-text"]').click()`);
  for (const [site] of SITES) {
    const s = await until(() => state(site), (v) => /rich-text/.test(v.opts || ""));
    check(/rich-text/.test(s.opts || ""), `${site}: an option turned on in the popup reaches the page`, `data-tema-opt=${s.opts}`);
  }

  await evalIn("popup", `[...document.querySelectorAll('.action-btn')].find((b) => b.textContent === "Parkour").click()`);
  check((await until(() => state("claude"), (v) => v.choco)).choco, "claude: the chocobo button sends one across the open tab");

  await click(pill("claude"));
  const off = await until(() => state("claude"), (v) => v.theme === null && v.party === 0 && !v.reply);
  check(off.theme === null && off.party === 0 && !off.reply, "claude: off again, nothing left behind",
    `theme=${off.theme} party=${off.party} reply=${off.reply}`);
  check((await state("chatgpt")).theme === "final-fantasy", "chatgpt: unaffected by claude going off");

  const errors = await call({ cmd: "errors" });
  check(!errors.length, "the extension loaded without errors", errors.join(" | ").slice(0, 300));
} finally {
  await harness.close();
}

/* ------------------------------------------------- Safari's site access */

// Safari gives a new extension no website access and asks per site, so a
// fresh harness starts that way (--ask) and answers the prompts itself.
// Ticking a site in the popup must ask for it; a refusal leaves a notice
// with an Allow button; allowing it lets the theme in.
const asking = await startHarness(STAGE, standIns.proxyPort, { ask: true });
try {
  const call = async (cmd) => {
    const r = await asking.send(cmd);
    if (!r.ok) throw new Error(`${cmd.cmd} ${cmd.tab || ""}: ${r.error}`);
    return r.value;
  };
  const evalIn = (tab, js) => call({ cmd: "eval", tab, js });
  const notice = () => evalIn("popup", `const el = document.getElementById("access");
    return { shown: !el.hidden, text: el.textContent }`);

  await call({ cmd: "popup", tab: "popup", path: "src/popup/popup.html" });
  await wait(600);
  check(!(await notice()).shown, "access: no notice while no site wears a theme");

  await call({ cmd: "answer", grant: false });
  await evalIn("popup", `document.querySelector('.card[data-theme="final-fantasy"] .site[data-site="claude"]').click()`);
  const refused = await until(notice, (v) => v.shown);
  const asked = await call({ cmd: "prompts" });
  check(asked.includes("https://claude.ai/*"), "access: ticking Claude asks Safari to let Tema into claude.ai", asked.join(" "));
  check(refused.shown && /Claude/.test(refused.text), "access: refused, the popup says so and offers Allow", refused.text);

  await call({ cmd: "answer", grant: true });
  await evalIn("popup", `document.querySelector("#access .access-btn").click()`);
  const allowed = await until(notice, (v) => !v.shown);
  check(!allowed.shown, "access: Allow asks again, and once allowed the notice goes");

  await call({ cmd: "open", tab: "claude", url: "https://claude.ai/" });
  const themed = await until(() => evalIn("claude", `return {
      theme: document.documentElement.getAttribute("data-tema"),
      party: document.querySelectorAll(".ff-party-member").length }`), (v) => v.party === 4);
  check(themed.theme === "final-fantasy" && themed.party === 4, "access: once allowed, claude.ai wears the theme",
    `theme=${themed.theme} party=${themed.party}`);
} finally {
  await asking.close();
  await standIns.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nthe Safari build works end to end in WebKit on all three sites");
process.exit(failed ? 1 : 0);
