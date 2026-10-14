// Tema — stand-in pages at the real hostnames, for the end-to-end suites.
//
// Just enough of each site for the engine and the theme to find their
// footing (a composer, a settled reply, a sidebar row), served over HTTPS
// with a throwaway self-signed certificate and each site's own kind of
// Content Security Policy. The browser under test reaches them as
// https://claude.ai/ and so on:
//
//   Chrome:  --host-rules maps the hostnames to `port`
//   WebKit:  everything goes through the HTTP CONNECT proxy on `proxyPort`,
//            which hands every tunnel to the same server
//
// so the manifest's own matches decide what gets injected.

import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

export const PAGES = {
  // The 2026-10 transcript: turns are data-cds="UserMessage" and
  // "AssistantMessage" (still data-is-streaming), the reply body is
  // [data-transcript-engine-root] > .prose, the action row sits inside it.
  "claude.ai": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>claude stand-in</title>
<style>body{margin:0;background:#262624;color:#eee;font:14px system-ui}main{padding:40px 80px}
.cursor-text{position:relative;margin-top:120px;min-height:70px;border:1px solid #444;border-radius:16px}</style></head>
<body class="font-ui"><aside class="dframe-sidebar"><div class="dframe-sidebar-body">
<a data-row-main-button href="#"><span class="df-leading-slot"></span><span>A chat</span></a></div></aside>
<main class="dframe-content"><div data-testid="transcript-list">
<div data-cds="UserMessage" data-turn-key><div class="relative flex"><div><div class="cds-user-message-body">
<div data-testid="user-message"><div class="contents"><p>hello</p></div></div></div></div></div></div>
<div data-cds="AssistantMessage" data-testid="assistant-message" data-turn-key data-is-streaming="false" id="reply" class="relative flex flex-col">
<div class="flex min-w-0 flex-col"><div class="min-w-0"><div class="grid"><div data-transcript-engine-root class="contents">
<div class="prose"><p>A settled reply.</p></div></div></div></div></div>
<div class="print:mt-xs"><div data-cds="MessageActions" role="toolbar"><button aria-label="Copy">c</button></div></div></div></div>
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

// Each site's own policy, as far as it bears on a theme (2026-10):
// claude.ai refuses data: fonts and fetches outside itself; Gemini allows
// data: fonts but demands Trusted Types for scripts. Content scripts and
// their stylesheets have to work under both.
const POLICY = {
  "claude.ai": ["default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'"],
  "chatgpt.com": ["default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self'"],
  "gemini.google.com": ["default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https:", "require-trusted-types-for 'script'"],
};

/**
 * Start the stand-ins. With { proxy: true } also an HTTP CONNECT proxy that
 * tunnels every request to them. Returns { port, proxyPort, close }.
 */
export async function startStandIns({ proxy = false } = {}) {
  const certDir = await mkdtemp(join(tmpdir(), "tema-cert-"));
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=tema-test", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem")]);
  const server = createServer({
    key: await readFile(join(certDir, "key.pem")),
    cert: await readFile(join(certDir, "cert.pem")),
  }, (req, res) => {
    const host = (req.headers.host || "").split(":")[0];
    if (req.url === "/" && PAGES[host]) {
      const headers = { "content-type": "text/html; charset=utf-8" };
      // Several policies are sent as one comma-joined header, as the spec allows.
      if (POLICY[host]) headers["content-security-policy"] = POLICY[host].join(", ");
      res.writeHead(200, headers);
      res.end(PAGES[host]);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  let tunnel = null;
  if (proxy) {
    tunnel = createHttpServer((req, res) => { res.writeHead(405); res.end(); });
    tunnel.on("connect", (req, socket, head) => {
      const upstream = connect(port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    });
    await new Promise((r) => tunnel.listen(0, "127.0.0.1", r));
  }

  return {
    port,
    proxyPort: tunnel ? tunnel.address().port : null,
    async close() {
      server.closeAllConnections?.();
      server.close();
      if (tunnel) { tunnel.closeAllConnections?.(); tunnel.close(); }
      await rm(certDir, { recursive: true, force: true });
    },
  };
}
