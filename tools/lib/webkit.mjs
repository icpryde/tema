// Tema — WebKit, for the suites that test Safari's engine.
//
// Builds and drives tools/safari/harness.swift: WebKit's extension runtime
// (WKWebExtension, the engine under Safari's extensions) with a line-based
// JSON command protocol. tools/tests/safari.mjs loads the Safari build into
// it; tools/tests/render.mjs (TEMA_ENGINE=webkit) uses its plain probe pages.
//
// `available()` says why WebKit can't be used here, or null when it can:
// macOS 15.4 or later (WKWebExtension) and a Swift compiler.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HARNESS_SRC = join(ROOT, "tools/safari/harness.swift");
const HARNESS = join(ROOT, "safari/build/harness");

/** null when WebKit can be driven here, otherwise the reason it can't. */
export async function available() {
  if (process.platform !== "darwin") return "the Safari build is tested with WebKit on macOS";
  const { stdout } = await run("sw_vers", ["-productVersion"]);
  const [major, minor] = stdout.trim().split(".").map(Number);
  if (major < 15 || (major === 15 && minor < 4)) return `macOS ${stdout.trim()} has no WKWebExtension (15.4 or later)`;
  try { await run("xcrun", ["--find", "swiftc"]); } catch { return "no Swift compiler (install the Xcode command line tools)"; }
  return null;
}

/** The compiled harness, rebuilt when its source is newer. */
async function harnessBinary() {
  const src = await stat(HARNESS_SRC);
  const bin = await stat(HARNESS).catch(() => null);
  if (bin && bin.mtimeMs >= src.mtimeMs) return HARNESS;
  await mkdir(dirname(HARNESS), { recursive: true });
  // A fresh file: rewriting a signed binary in place can get it killed at launch.
  await run("rm", ["-f", HARNESS]);
  try {
    await run("xcrun", ["swiftc", "-O", "-o", HARNESS, HARNESS_SRC]);
  } catch (err) {
    throw new Error("the harness didn't compile:\n" + (err.stderr || err.message));
  }
  return HARNESS;
}

/**
 * Spawn the harness with the extension in `extDir`. Options: proxyPort (the
 * stand-ins' CONNECT proxy), ask (start without website access, as Safari
 * does). Returns { info, send(cmd, ms), call(cmd), close() }; call() throws
 * on a failed command and returns its value.
 */
export async function startHarness(extDir, { proxyPort = null, ask = false } = {}) {
  const args = [extDir, ...(proxyPort ? ["--proxy", String(proxyPort)] : []), ...(ask ? ["--ask"] : [])];
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
    pid: child.pid,
    send,
    async call(cmd, ms) {
      const r = await send(cmd, ms);
      if (!r.ok) throw new Error(`${cmd.cmd}${cmd.tab ? " " + cmd.tab : ""}: ${r.error}`);
      return r.value;
    },
    async close() {
      await send({ cmd: "quit" }, 3000).catch(() => {});
      child.kill();
    },
  };
}

/* --------------------------------------------- the browser-driven suites */

// render, glyph, wide and smoke each load a page in headless Chrome and read
// the result it leaves in document.title from --dump-dom. With
// TEMA_ENGINE=webkit they load it in WebKit instead: dumpTitle() returns the
// title as --dump-dom would print it, so each suite's own parsing reads it
// unchanged. WebKit has no virtual time, so pages run in real time, and the
// views are never on screen, where WebKit slows timers: give them room.

export const ENGINE = process.env.TEMA_ENGINE === "webkit" ? "webkit" : "chrome";
let shared = null;

export async function dumpTitle(file, prefix, { width = 800, height = 600, timeout = 30 } = {}) {
  if (!shared) {
    const why = await available();
    if (why) {
      console.log("skipped — " + why);
      process.exit(0);
    }
    // The harness wants an extension to start; these pages don't use it.
    const { stage, STAGE } = await import("../safari.mjs");
    await stage();
    shared = await startHarness(STAGE);
    process.on("exit", () => { try { process.kill(shared.pid); } catch { /* gone */ } });
  }
  const title = await shared.call({ cmd: "probe", url: "file://" + file, prefix, timeout, width, height }, (timeout + 10) * 1000);
  const html = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<title>${html}</title>`;
}
