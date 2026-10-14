// Tema — settings rules and the theme registry, in plain Node.
//
//   node tools/tests/unit.mjs
//
// The popup and every content script decide what a site wears with the same
// functions (src/settings.js); these pin the rules down without a browser.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadThemes } from "../build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await import(resolve(ROOT, "src/settings.js"));
await import(resolve(ROOT, "src/registry.js"));
const S = globalThis.TemaSettings;
const REAL = globalThis.TemaRegistry;

let failed = 0;
const eq = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`ok   ${label}`);
  else { failed++; console.log(`FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

// A registry with two themes, one of them not made for gemini.
const REG = {
  sites: [{ id: "claude", host: "claude.ai" }, { id: "chatgpt", host: "chatgpt.com" }, { id: "gemini", host: "gemini.google.com" }],
  themes: [
    { id: "a", sites: { claude: true, chatgpt: true, gemini: true },
      options: [{ id: "x", default: true }, { id: "y", default: false }] },
    { id: "b", sites: { claude: true, chatgpt: true }, options: [] },
  ],
};

/* ---------------------------------------------------------------- read */

eq(S.read({}, REG), { sites: { claude: null, chatgpt: null, gemini: null }, options: {} },
  "empty storage reads as every site on its own look");
eq(S.read({ sites: { claude: "a", gemini: "", bogus: "a" }, options: { a: { x: false, y: "yes" } } }, REG),
  { sites: { claude: "a", chatgpt: null, gemini: null }, options: { a: { x: false } } },
  "read keeps known sites and boolean options, drops the rest");
eq(S.read({ sites: "nonsense", options: [1, 2] }, REG).sites.claude, null, "read survives garbage");

/* ------------------------------------------------------- active theme */

const s1 = S.read({ sites: { claude: "a", chatgpt: "b", gemini: "b" } }, REG);
eq(S.activeTheme(s1, "claude", REG)?.id, "a", "a site wears the theme stored for it");
eq(S.activeTheme(s1, "gemini", REG), null, "a theme not made for a site reads as no theme there");
eq(S.activeTheme(S.read({ sites: { claude: "gone" } }, REG), "claude", REG), null,
  "a removed theme's id reads as no theme");

/* ------------------------------------------------------------ options */

eq(S.enabledOptions(REG.themes[0], {}), ["x"], "options start at their declared defaults");
eq(S.enabledOptions(REG.themes[0], { a: { x: false, y: true } }), ["y"], "a stored value beats the default");
eq(S.enabledOptions(REG.themes[1], {}), [], "a theme with no options enables none");
eq(S.withOption(S.read({ options: { a: { x: false } } }, REG), "a", "y", true), { a: { x: false, y: true } },
  "setting an option keeps the theme's other stored values");

/* --------------------------------------------------- one theme a site */

const before = S.read({ sites: { claude: "b", chatgpt: "a" } }, REG);
const moved = S.withSite(before, "claude", "a");
eq(moved.sites, { claude: "a", chatgpt: "a", gemini: null }, "putting a theme on a site replaces what it wore");
eq(moved.previous, "b", "and reports what it replaced");
eq(S.withSite(before, "chatgpt", null).sites.chatgpt, null, "null takes a site back to its own look");
eq(S.sitesWearing(S.read({ sites: { claude: "a", gemini: "a" } }, REG), "a", REG), ["claude", "gemini"],
  "sitesWearing lists the sites in site order");

/* -------------------------------------------------------------- hosts */

eq(S.siteForHost(REG, "claude.ai"), "claude", "claude.ai is claude");
eq(S.siteForHost(REG, "www.chatgpt.com"), "chatgpt", "a subdomain counts as its site");
eq(S.siteForHost(REG, "notclaude.ai"), null, "a lookalike host is not a site");
eq(S.siteForHost(REG, "gemini.google.com"), "gemini", "gemini.google.com is gemini");
eq(S.siteForHost(REG, "google.com"), null, "the parent domain is not gemini");

/* ----------------------------------------------- the real registry */

const { themes, sites } = await loadThemes();
eq(REAL.sites.map((s) => s.id), sites.map((s) => s.id), "registry.js lists the sites in src/sites.json");
eq(REAL.themes.map((t) => t.id), themes.map((t) => t.id), "registry.js lists the themes in themes/index.json");
for (const t of REAL.themes) {
  for (const o of t.options) eq(typeof o.default, "boolean", `${t.id}: option ${o.id} has a boolean default`);
}
const manifest = JSON.parse(await readFile(resolve(ROOT, "manifest.json"), "utf8"));
eq(manifest.permissions, ["storage"], "the extension asks for storage and nothing else");
eq(manifest.host_permissions, undefined, "no host permissions beyond the content-script matches");
eq(manifest.content_scripts.flatMap((c) => c.matches).sort(),
  sites.flatMap((s) => s.matches).sort(), "content scripts run on exactly the three sites");

console.log(failed ? `\n${failed} failed` : "\nall unit checks passed");
process.exit(failed ? 1 : 0);
