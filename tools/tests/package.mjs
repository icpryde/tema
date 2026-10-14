// Tema — the release zip holds exactly what the extension needs.
//
//   node tools/tests/package.mjs
//
// Builds the zip into a scratch folder and reads it back: every file the
// manifest, the popup and the themes reference is in it, nothing from the
// dev tree is, and its version is the manifest's.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let failed = 0;
const check = (ok, label, detail = "") => {
  if (ok) console.log(`ok   ${label}${detail ? "   " + detail : ""}`);
  else { failed++; console.log(`FAIL ${label}${detail ? "   " + detail : ""}`); }
};

const out = await mkdtemp(join(tmpdir(), "tema-pkgtest-"));
try {
  await run(process.execPath, [join(ROOT, "tools/package.mjs"), "--out", out], { cwd: ROOT });
  const zip = join(out, "tema.zip");
  const { stdout } = await run("unzip", ["-Z1", zip], { maxBuffer: 1 << 24 });
  const entries = stdout.split("\n").filter((e) => e && !e.endsWith("/"));
  const inZip = new Set(entries.map((e) => e.replace(/^tema\//, "")));

  check(entries.every((e) => e.startsWith("tema/")), "everything sits in one tema/ folder, ready for Load unpacked");

  const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  const referenced = new Set([
    ...Object.values(manifest.icons),
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...c.css]),
  ]);
  const missing = [...referenced].filter((f) => !inZip.has(f));
  check(!missing.length, "every file the manifest names is in the zip", missing.join(", "));

  const sounds = manifest.web_accessible_resources.flatMap((w) => w.resources);
  for (const pattern of sounds) {
    const re = new RegExp("^" + pattern.replace(/[.]/g, "\\.").replace(/\*/g, "[^/]*") + "$");
    check([...inZip].some((f) => re.test(f)), `web-accessible ${pattern} has files in the zip`);
  }

  const popupHtml = await readFile(join(ROOT, "src/popup/popup.html"), "utf8");
  const popupRefs = [...popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => join("src/popup", m[1])).map((p) => p.replace(/\\/g, "/"));
  const popupMissing = popupRefs.filter((p) => !inZip.has(p));
  check(!popupMissing.length, "every file the popup loads is in the zip", popupMissing.join(", "));

  const dev = [...inZip].filter((f) => /(^|\/)(tools|art|docs|\.snapshots|\.scratch|release)\//.test(f) || /(^|\/)\./.test(f));
  check(!dev.length, "no dev files (tools, art sources, docs, dotfiles)", dev.slice(0, 5).join(", "));

  const { stdout: m } = await run("unzip", ["-p", zip, "tema/manifest.json"]);
  check(JSON.parse(m).version === manifest.version, "the zip's version is the manifest's", manifest.version);
  console.log(`\n${entries.length} files in the zip`);
} finally {
  await rm(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
