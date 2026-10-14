// Tema — build the installable zip.
//
//   node tools/package.mjs [--out release]
//
// Writes <out>/tema.zip: unzip it and Load unpacked the folder inside. The
// file list is an ALLOWLIST worked out from the manifest and the themes'
// theme.json files, never "everything except…": a denylist ships whatever
// junk lands in the tree next (an editor backup, a screenshot, a 1MB sprite
// sheet), and you find out after handing the file to someone. Art sources,
// generators, tests and docs stay out; they live in the repository.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { loadThemes } from "./build.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "tema";

const argOut = process.argv.indexOf("--out");
const OUT = resolve(ROOT, argOut > 0 && process.argv[argOut + 1] ? process.argv[argOut + 1] : "release");

/** Every file the installed extension needs, repo-relative. */
export async function packageFiles() {
  const { themes } = await loadThemes();
  const files = new Set([
    "manifest.json",
    "README.md",
    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
    "src/registry.js", "src/settings.js",
    "src/content/core.js", "src/content/signals.js",
    "src/popup/popup.html", "src/popup/popup.css", "src/popup/popup.js", "src/popup/logo.svg",
    "themes/index.json",
  ]);
  try { await stat(join(ROOT, "CHANGELOG.md")); files.add("CHANGELOG.md"); } catch { /* optional */ }

  for (const t of themes) {
    const add = (f) => files.add(`${t.dir}/${f}`);
    add("theme.json");
    for (const list of Object.values(t.siteCss)) list.forEach(add);
    t.styles.forEach(add);
    if (t.script) add(t.script);
    if (t.card) for (const f of [t.card.html, t.card.css]) if (f) add(f);
    for (const f of [].concat(t.ship || [])) add(f);
    for (const pattern of t.files) {
      // Patterns are "dir/*.ext"; expand against the disk.
      const dir = join(ROOT, t.dir, dirname(pattern));
      const ext = pattern.split("*").pop();
      const { stdout } = await run("ls", [dir]);
      for (const n of stdout.split("\n").filter((n) => n && n.endsWith(ext))) add(`${dirname(pattern)}/${n}`);
    }
  }
  return [...files].sort();
}

async function build() {
  const files = await packageFiles();
  const stage = join(await mkdtemp(join(tmpdir(), "tema-pkg-")), NAME);
  for (const f of files) {
    await mkdir(dirname(join(stage, f)), { recursive: true });
    await cp(join(ROOT, f), join(stage, f));
  }
  await mkdir(OUT, { recursive: true });
  const zip = join(OUT, `${NAME}.zip`);
  await rm(zip, { force: true });
  // -r recurse, -q quiet, -X no macOS extended attributes (no __MACOSX/).
  await run("zip", ["-rqX", zip, NAME], { cwd: dirname(stage) });
  await rm(dirname(stage), { recursive: true, force: true });
  const { version } = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  const size = (await stat(zip)).size;
  console.log(`${zip}  v${version}  ${files.length} files  ${(size / 1024).toFixed(0)}KB`);
  return zip;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
