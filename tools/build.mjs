// Tema — build the generated files from the themes on disk.
//
//   node tools/build.mjs           write src/registry.js and manifest.json
//   node tools/build.mjs --check   exit 1 if either is out of date (check.mjs)
//
// The source of truth is src/sites.json plus one themes/<id>/theme.json per
// theme, listed in display order by themes/index.json. From those this
// writes:
//
//   src/registry.js   the sites and themes, for the popup and the content
//                     scripts (loaded as a plain script, so both read it
//                     synchronously, with no fetch and no race)
//   manifest.json     content_scripts (per site: the engine, then each
//                     theme's script; each theme's shared styles, then its
//                     site stylesheet) and web_accessible_resources. Every
//                     other manifest key is left as written.
//
// Adding a theme is: make the folder, write its theme.json, add its id to
// themes/index.json, run this. Nothing else needs editing by hand.

import { readFile, writeFile, stat, readdir } from "node:fs/promises";
import { dirname, resolve, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => resolve(ROOT, p);
const CHECK = process.argv.includes("--check");

const ENGINE_JS = ["src/registry.js", "src/settings.js", "src/content/core.js", "src/content/signals.js"];
const SIGNALS = new Set(["replies", "working", "icons", "wide-tables"]);
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errors = [];
const fail = (msg) => errors.push(msg);

const readJson = async (p) => JSON.parse(await readFile(rel(p), "utf8"));
const exists = async (p) => { try { await stat(rel(p)); return true; } catch { return false; } };

/** Files a theme-relative glob ("assets/sounds/*.wav") names, theme-relative. */
async function expand(themeDir, pattern) {
  if (!pattern.includes("*")) return (await exists(join(themeDir, pattern))) ? [pattern] : [];
  const dir = posix.dirname(pattern);
  const re = new RegExp("^" + posix.basename(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
  try {
    return (await readdir(rel(join(themeDir, dir)))).filter((n) => re.test(n)).sort().map((n) => posix.join(dir, n));
  } catch {
    return [];
  }
}

export async function loadThemes() {
  const sites = await readJson("src/sites.json");
  const siteIds = new Set(sites.map((s) => s.id));
  const index = await readJson("themes/index.json");
  const themes = [];

  for (const id of index.themes || []) {
    const dir = `themes/${id}`;
    let t;
    try {
      t = await readJson(`${dir}/theme.json`);
    } catch (err) {
      fail(`${dir}/theme.json: ${err.message}`);
      continue;
    }
    const where = `${dir}/theme.json`;
    if (t.id !== id) fail(`${where}: id "${t.id}" does not match its folder "${id}"`);
    if (!ID.test(id)) fail(`${where}: id "${id}" must be lowercase words joined by hyphens`);
    for (const k of ["name", "emoji", "tagline"]) {
      if (typeof t[k] !== "string" || !t[k]) fail(`${where}: "${k}" is required`);
    }

    // sites: { siteId: "file.css" | ["a.css", "b.css"] }
    const siteCss = {};
    for (const [site, files] of Object.entries(t.sites || {})) {
      if (!siteIds.has(site)) { fail(`${where}: unknown site "${site}"`); continue; }
      siteCss[site] = [].concat(files);
    }
    if (!Object.keys(siteCss).length) fail(`${where}: "sites" must name at least one site`);

    const styles = [].concat(t.styles || []);
    const script = t.script || null;
    for (const f of [...styles, ...Object.values(siteCss).flat(), ...(script ? [script] : [])]) {
      if (!(await exists(join(dir, f)))) fail(`${where}: ${f} does not exist`);
    }

    for (const s of t.signals || []) if (!SIGNALS.has(s)) fail(`${where}: unknown signal "${s}"`);

    const files = [];
    for (const pattern of [].concat(t.files || [])) {
      const hits = await expand(dir, pattern);
      if (!hits.length) fail(`${where}: "files" pattern ${pattern} matches nothing`);
      files.push(pattern);
    }
    for (const f of [].concat(t.ship || [])) {
      if (!(await exists(join(dir, f)))) fail(`${where}: ${f} does not exist`);
    }
    if (t.card) {
      for (const k of ["html", "css"]) {
        if (t.card[k] && !(await exists(join(dir, t.card[k])))) fail(`${where}: card ${k} ${t.card[k]} does not exist`);
      }
    }

    const optIds = new Set();
    for (const o of t.options || []) {
      if (!ID.test(o.id || "")) fail(`${where}: option id "${o.id}" must be lowercase words joined by hyphens`);
      if (optIds.has(o.id)) fail(`${where}: option "${o.id}" is declared twice`);
      optIds.add(o.id);
      if (typeof o.label !== "string") fail(`${where}: option "${o.id}" needs a label`);
    }
    for (const a of t.actions || []) {
      if (!a.id || !Array.isArray(a.buttons) || !a.buttons.length) fail(`${where}: action "${a.id}" needs buttons`);
    }

    themes.push({ ...t, dir, siteCss, styles, script, files });
  }
  return { sites, themes };
}

function registryJs({ sites, themes }) {
  const data = {
    sites: sites.map(({ id, name, host, color }) => ({ id, name, host, color })),
    themes: themes.map((t) => ({
      id: t.id,
      name: t.name,
      emoji: t.emoji,
      tagline: t.tagline,
      colors: t.colors || null,
      sites: Object.fromEntries(Object.keys(t.siteCss).map((s) => [s, true])),
      signals: t.signals || [],
      options: (t.options || []).map(({ id, label, hint, default: d }) =>
        ({ id, label, hint: hint || "", default: !!d })),
      actions: t.actions || [],
      // Extension-root paths, for the popup's theme card.
      card: t.card ? {
        html: t.card.html ? `${t.dir}/${t.card.html}` : null,
        css: t.card.css ? `${t.dir}/${t.card.css}` : null,
        styles: t.styles.map((f) => `${t.dir}/${f}`),
      } : null,
    })),
  };
  return "// GENERATED by tools/build.mjs from src/sites.json and themes/*/theme.json.\n" +
    "// Do not edit by hand: change the JSON and run `node tools/build.mjs`.\n" +
    "globalThis.TemaRegistry = Object.freeze(" + JSON.stringify(data, null, 2) + ");\n";
}

function manifestJson(base, { sites, themes }) {
  const contentScripts = [];
  const war = [];
  for (const site of sites) {
    const worn = themes.filter((t) => t.siteCss[site.id]);
    if (!worn.length) continue;
    contentScripts.push({
      matches: site.matches,
      run_at: "document_start",
      js: [...ENGINE_JS, ...worn.filter((t) => t.script).map((t) => `${t.dir}/${t.script}`)],
      css: worn.flatMap((t) => [
        ...t.styles.map((f) => `${t.dir}/${f}`),
        ...t.siteCss[site.id].map((f) => `${t.dir}/${f}`),
      ]),
    });
  }
  for (const t of themes) {
    if (!t.files.length) continue;
    war.push({
      resources: t.files.map((f) => `${t.dir}/${f}`),
      matches: sites.filter((s) => t.siteCss[s.id]).flatMap((s) => s.matches),
    });
  }

  const icons = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
  const out = {
    manifest_version: 3,
    name: base.name,
    version: base.version,
    description: base.description,
    icons,
    action: { default_popup: "src/popup/popup.html", default_title: base.name, default_icon: icons },
    permissions: ["storage"],
    content_scripts: contentScripts,
    web_accessible_resources: war,
  };
  // Any key added to manifest.json by hand that this script doesn't own.
  for (const [k, v] of Object.entries(base)) if (!(k in out)) out[k] = v;
  return JSON.stringify(out, null, 2) + "\n";
}

async function main() {
  const model = await loadThemes();
  if (errors.length) {
    console.error("theme errors:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  const base = await readJson("manifest.json");
  const outputs = [
    ["src/registry.js", registryJs(model)],
    ["manifest.json", manifestJson(base, model)],
  ];

  let stale = 0;
  for (const [path, text] of outputs) {
    const current = await readFile(rel(path), "utf8").catch(() => null);
    if (current === text) continue;
    if (CHECK) {
      stale++;
      console.log(`${path} is out of date — run: node tools/build.mjs`);
    } else {
      await writeFile(rel(path), text, "utf8");
      console.log(`wrote ${path}`);
    }
  }
  if (CHECK && stale) process.exit(1);
  console.log(CHECK ? "generated files are up to date" :
    `${model.themes.length} theme(s) across ${model.sites.length} sites`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
