// Tema — drive a real Chromium with the extension loaded, over the DevTools
// protocol. No dependencies: Node's built-in WebSocket speaks CDP.
//
// Branded Google Chrome ignores --load-extension (since Chrome 137), so this
// needs Chrome for Testing or Chromium. It looks in the usual Playwright and
// Puppeteer caches; set CHROME_FOR_TESTING=/path/to/binary to point it
// elsewhere. findTestBrowser() returns null when there is none, so suites can
// skip with a note instead of failing.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export async function findTestBrowser() {
  if (process.env.CHROME_FOR_TESTING && existsSync(process.env.CHROME_FOR_TESTING)) {
    return process.env.CHROME_FOR_TESTING;
  }
  const caches = [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
    join(homedir(), ".cache/puppeteer/chrome"),
  ];
  const inside = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux64/chrome",
    "chrome-linux/chrome",
  ];
  for (const cache of caches) {
    let dirs = [];
    try { dirs = (await readdir(cache)).filter((d) => /^(chromium|mac|linux)/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dirs) {
      for (const tail of inside) {
        const p = join(cache, d, tail);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

/** The id Chromium gives an unpacked extension: a hash of its path. */
export function extensionId(path) {
  const hex = createHash("sha256").update(path).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

/** A tiny CDP connection: send(method, params, sessionId) and events. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

/**
 * Launch a headless browser with the extension at `extPath` loaded. Returns
 * { cdp, page(url), close() }. Extra Chromium flags go in `args`.
 */
export async function launch({ binary, extPath, args = [] }) {
  const profile = await mkdtemp(join(tmpdir(), "tema-browser-"));
  const proc = spawn(binary, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--load-extension=${extPath}`,
    `--disable-extensions-except=${extPath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1280,860",
    ...args,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  // Drain stderr (an unread pipe can stall the browser) and keep the tail
  // for the error message if it never comes up.
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });

  // The browser writes its debugging port to DevToolsActivePort.
  const portFile = join(profile, "DevToolsActivePort");
  let wsUrl = null;
  for (let i = 0; i < 600 && !wsUrl; i++) {
    await new Promise((r) => setTimeout(r, 50));
    if (!existsSync(portFile)) continue;
    const [port, path] = (await readFile(portFile, "utf8")).trim().split("\n");
    if (port && path) wsUrl = `ws://127.0.0.1:${port}${path}`;
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error("the test browser never opened its debugging port\n" + stderr.trim().split("\n").slice(-8).join("\n"));
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("CDP connect failed")); });
  const cdp = new Cdp(ws);

  /** Open a tab at `url`; returns helpers bound to its session. */
  async function page(url, { width = 1280, height = 860 } = {}) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const errors = [];
    cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
      // Content Security Policy refusals never reach the console API; they
      // arrive here, and the browser lists them on the extension's Errors
      // page when the extension's own resources caused them.
      if (msg.method === "Log.entryAdded" && msg.params.entry.source === "security") {
        errors.push(msg.params.entry.text.slice(0, 160));
      }
    });
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Log.enable", {}, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 2, mobile: false }, sessionId);
    const loaded = () => new Promise((resolve) => {
      const off = cdp.on((msg) => {
        if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") { off(); resolve(); }
      });
    });
    const p = {
      sessionId,
      errors,
      async goto(u) {
        const done = loaded();
        await cdp.send("Page.navigate", { url: u }, sessionId);
        await done;
      },
      async eval(expression) {
        const r = await cdp.send("Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async screenshot(clip) {
        const r = await cdp.send("Page.captureScreenshot",
          { format: "png", captureBeyondViewport: !!clip, clip: clip ? { ...clip, scale: 1 } : undefined }, sessionId);
        return Buffer.from(r.data, "base64");
      },
      async close() { await cdp.send("Target.closeTarget", { targetId }); },
    };
    if (url) await p.goto(url);
    return p;
  }

  async function close() {
    try { await cdp.send("Browser.close"); } catch { /* already gone */ }
    proc.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  return { cdp, page, close };
}
