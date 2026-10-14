// Tema — run everything.
//
//   node tools/check.mjs
//
// One entry point, because the failures that ship are the ones nobody ran
// the test for. In order:
//
//   build      the generated registry and manifest match the themes on disk
//   unit       the settings rules (which theme a site wears) and the registry
//   smoke      runs the content scripts against stand-in pages for each site
//              and drives the states that only happen over time
//   glyph      claude.ai's working glyph: exactly one moogle in every state,
//              and every selector that draws it actually parsed
//   wide       wide tables: reply windows grow to fit, never spill
//   render     computed styles on site-shaped pages: what the theme must
//              change, and what it must leave alone
//   package    the release zip holds exactly what the extension needs
//   extension  the installed extension end to end, driven through its popup
//              (needs Chrome for Testing or Chromium; skips without one)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  ["build", ["tools/build.mjs", "--check"]],
  ["unit", ["tools/tests/unit.mjs"]],
  ["smoke", ["tools/tests/smoke.mjs"]],
  ["glyph", ["tools/tests/glyph.mjs"]],
  ["wide", ["tools/tests/wide.mjs"]],
  ["render", ["tools/tests/render.mjs"]],
  ["package", ["tools/tests/package.mjs"]],
  ["extension", ["tools/tests/extension.mjs"]],
];

let failed = 0;
for (const [name, [script, ...args]] of SUITES) {
  process.stdout.write(`── ${name} ${"─".repeat(Math.max(0, 40 - name.length))}\n`);
  try {
    const { stdout } = await run(process.execPath, [resolve(ROOT, script), ...args], {
      cwd: ROOT,
      maxBuffer: 200 * 1024 * 1024,
    });
    console.log(stdout.trim());
  } catch (err) {
    failed++;
    // A non-zero exit rejects; the suite's own output is the useful part.
    console.log(((err.stdout || "") + (err.stderr ? "\n" + err.stderr : "")).trim() || err.message);
    console.log(`\n^^ ${name} FAILED`);
  }
  console.log("");
}

console.log(failed ? `${failed} suite(s) failed` : "all suites passed");
process.exit(failed ? 1 : 0);
