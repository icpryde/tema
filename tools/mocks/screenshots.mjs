// Tema — render the README screenshots from the offline mocks.
//
//   node tools/mocks/screenshots.mjs
//
// The pictures come from the stand-in pages in this folder, so they carry
// sample data and nobody's real chats. The popup picture comes from the
// end-to-end suite instead: node tools/tests/extension.mjs --shots.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../lib/chrome.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = findChrome();

const SHOTS = [
  ["claude.png", "tools/mocks/claude.html", "1280,860"],
  ["chatgpt.png", "tools/mocks/chatgpt.html", "1280,800"],
  ["gemini.png", "tools/mocks/gemini.html", "1280,800"],
  ["gemini-new-chat.png", "tools/mocks/gemini.html?state=zero", "1280,800"],
];

for (const [name, page, size] of SHOTS) {
  const out = resolve(ROOT, "docs/screenshots", name);
  await run(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
    "--virtual-time-budget=4000", `--window-size=${size}`, `--screenshot=${out}`,
    "file://" + resolve(ROOT, page.split("?")[0]) + (page.includes("?") ? "?" + page.split("?")[1] : ""),
  ]);
  console.log("wrote docs/screenshots/" + name);
}
