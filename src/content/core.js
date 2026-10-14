// Tema — content script core.
//
// Runs on every supported site at document_start. It works out which theme
// this site should wear, stamps that on <html> for the theme's stylesheets
//
//   data-tema="<theme id>"         while a theme is on
//   data-tema-opt="<option ids>"   the theme's options that are switched on
//
// and runs the theme's behaviour script, if it has one, for as long as the
// theme stays on. A theme's stylesheets are loaded on its sites by the
// manifest and scoped under html[data-tema="<id>"], so switching themes in
// the popup is one attribute write: no reload, and no flash of the old look.
//
// Behaviour scripts (themes/<id>/runtime.js) and the engine's page signals
// (signals.js) plug in through globalThis.Tema with the same small shape:
//
//   start(ctx)    the theme went on in this tab
//   stop()        it went off, or the extension was reloaded: undo everything
//   update(ctx)   options changed while it was on
//   pass()        the page changed (debounced DOM mutations, scroll, resize)
//   added(el)     an element was just added, called before the browser paints
//   action(n, a)  a button in the popup (behaviour scripts only)
//
// ctx = { site, theme, options, has(optionId) }.
(() => {
  "use strict";

  const REG = globalThis.TemaRegistry;
  const S = globalThis.TemaSettings;
  // Safari and Firefox expose the promise-based `browser`; Chrome has
  // `chrome`. Both shapes are handled below.
  const api = globalThis.browser && globalThis.browser.storage ? globalThis.browser : globalThis.chrome;
  const promised = api === globalThis.browser;
  const SITE = globalThis.__TEMA_TEST_SITE || (REG && S ? S.siteForHost(REG, location.hostname) : null);
  if (!REG || !S || !api || !api.storage || !SITE) return;

  const ROOT = document.documentElement;
  const THEME_ATTR = "data-tema";
  const OPT_ATTR = "data-tema-opt";

  // Reloading or updating the extension leaves this script running in open
  // tabs with its stylesheets gone. Everything it added has to come out then,
  // or the page keeps half a theme until it is reloaded.
  const alive = () => { try { return !!(api.runtime && api.runtime.id); } catch { return false; } };

  /* -------------------------------------------------------------- Safari */

  // Safari runs content scripts but hasn't reliably applied a manifest's CSS
  // to freshly loaded pages (found porting Apollo, 2026-10). So the Safari
  // build (tools/safari.mjs) lists no CSS and ships this site's stylesheets
  // as text in src/safari/<site>.js, which loads first, and they are adopted
  // here as one constructed stylesheet: no page policy blocks those, and
  // they cascade after the page's own sheets at the same (author) level as
  // Chrome's injected CSS. A page that replaces document.adoptedStyleSheets
  // would drop it, so every pass puts it back.
  let adopted = null;

  function adoptStyles() {
    const css = globalThis.TemaSafariCss;
    if (typeof css !== "string" || typeof CSSStyleSheet !== "function" || !("adoptedStyleSheets" in document)) return;
    if (!adopted) {
      adopted = new CSSStyleSheet();
      adopted.replaceSync(css);
    }
    if (!document.adoptedStyleSheets.includes(adopted)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted];
    }
  }

  function dropStyles() {
    if (adopted) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== adopted);
  }

  adoptStyles();

  function storageGet(area, keys) {
    try {
      if (promised) return api.storage[area].get(keys).then((v) => v || {}, () => ({}));
      return new Promise((resolve) => api.storage[area].get(keys, (v) => resolve(v || {})));
    } catch {
      return Promise.resolve({});
    }
  }

  /* --------------------------------------------------------------- state */

  const runtimes = new Map();   // theme id -> behaviour script
  const engine = [];            // engine parts (page signals), run for every theme
  let raw = {};                 // the sync keys exactly as stored
  let settings = S.read(raw, REG);
  let current = null;           // { theme, ctx, parts }
  let dead = false;

  function call(part, method, ...args) {
    if (!part || typeof part[method] !== "function") return;
    try {
      part[method](...args);
    } catch (err) {
      console.error("[tema] " + method + " failed:", err);
    }
  }

  function setAttr(name, value) {
    if (value == null) {
      if (ROOT.hasAttribute(name)) ROOT.removeAttribute(name);
    } else if (ROOT.getAttribute(name) !== value) {
      ROOT.setAttribute(name, value);
    }
  }

  /* --------------------------------------------------------------- apply */

  function apply() {
    if (dead) return;
    if (!alive()) { shutdown(); return; }

    const theme = S.activeTheme(settings, SITE, REG);
    const options = theme ? S.enabledOptions(theme, settings.options) : [];
    setAttr(THEME_ATTR, theme ? theme.id : null);
    setAttr(OPT_ATTR, options.length ? options.join(" ") : null);

    const was = current ? current.theme.id : null;
    const now = theme ? theme.id : null;
    if (was !== now) {
      switchTo(theme, options);
    } else if (current && current.ctx.options.join(" ") !== options.join(" ")) {
      current.ctx.options = options;
      for (const p of current.parts) call(p, "update", current.ctx);
      schedule();
    }
  }

  function switchTo(theme, options) {
    if (current) {
      // Behaviour first, then the signals it was reading.
      for (const p of [...current.parts].reverse()) call(p, "stop");
      current = null;
      observe(false);
      unloadFonts();
    }
    if (!theme) return;

    const ctx = {
      site: SITE,
      theme,
      options,
      has: (id) => ctx.options.includes(id),
    };
    const parts = [...engine];
    const rt = runtimes.get(theme.id);
    if (rt) parts.push(rt);
    current = { theme, ctx, parts };
    for (const p of parts) call(p, "start", ctx);
    observe(true);
    loadFonts(theme);
    schedule();
  }

  /* --------------------------------------------------------------- fonts */

  // A theme can ship its fonts as @font-face data URIs in its stylesheets,
  // which draw from the first paint, but a page's own security policy can
  // refuse data: fonts (claude.ai's font-src does, 2026-10). So the engine
  // also adds the packaged files through the FontFace API: built from bytes
  // the extension fetched itself, they load no URL the page could veto.
  // Wherever both copies work they're the same face; where the stylesheet's
  // fails, this one carries the theme.
  const fontCache = new Map();   // theme id -> Promise<FontFace[]>
  let fontsAdded = [];

  function loadFonts(theme) {
    if (!theme.fonts || !theme.fonts.length || typeof FontFace !== "function" || !document.fonts) return;
    let faces = fontCache.get(theme.id);
    if (!faces) {
      faces = Promise.all(theme.fonts.map(async (f) => {
        const res = await fetch(api.runtime.getURL(f.src));
        if (!res.ok) throw new Error(f.src + " " + res.status);
        const face = new FontFace(f.family, await res.arrayBuffer(), f.descriptors || {});
        return face.load();
      })).catch(() => []);
      fontCache.set(theme.id, faces);
    }
    faces.then((list) => {
      if (!current || current.theme.id !== theme.id || fontsAdded.length) return;
      for (const face of list) document.fonts.add(face);
      fontsAdded = list;
    });
  }

  function unloadFonts() {
    for (const face of fontsAdded) document.fonts.delete(face);
    fontsAdded = [];
  }

  function shutdown() {
    dead = true;
    if (current) {
      for (const p of [...current.parts].reverse()) call(p, "stop");
      current = null;
    }
    unloadFonts();
    dropStyles();
    observe(false);
    guard.disconnect();
    ROOT.removeAttribute(THEME_ATTR);
    ROOT.removeAttribute(OPT_ATTR);
  }

  /* ----------------------------------------------------------- the pass */

  // Trailing debounce with a max-wait deadline. A pure trailing debounce
  // never fires while a reply streams: mutations arrive faster than the
  // delay, so the timer re-arms forever, exactly while a theme most needs
  // to keep up.
  const PASS_WAIT = 120;
  const PASS_MAX = 400;
  let passTimer = null;
  let passDeadline = 0;

  function schedule() {
    if (!current) return;
    const now = performance.now();
    if (!passTimer) passDeadline = now + PASS_MAX;
    clearTimeout(passTimer);
    passTimer = setTimeout(runPass, Math.max(0, Math.min(PASS_WAIT, passDeadline - now)));
  }

  function runPass() {
    passTimer = null;
    if (!alive()) { shutdown(); return; }
    if (!current) return;
    adoptStyles();
    for (const p of current.parts) call(p, "pass");
  }

  // A document-wide subtree observer is expensive on pages that mutate as
  // much as these do, so it only runs while a theme is on.
  const mo = new MutationObserver((records) => {
    if (!current) return;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        for (const p of current.parts) if (p.added) call(p, "added", n);
      }
    }
    schedule();
  });

  // Scrolling and resizing move things through the regions themes measure
  // without mutating anything.
  let scrollTick = 0;
  const onScroll = () => {
    const now = performance.now();
    if (now - scrollTick < 200) return;
    scrollTick = now;
    schedule();
  };
  const onResize = () => schedule();
  let observing = false;

  function observe(on) {
    if (on === observing) return;
    observing = on;
    if (on) {
      mo.observe(ROOT, { childList: true, subtree: true });
      addEventListener("scroll", onScroll, { passive: true, capture: true });
      addEventListener("resize", onResize, { passive: true });
    } else {
      mo.disconnect();
      removeEventListener("scroll", onScroll, { capture: true });
      removeEventListener("resize", onResize);
      clearTimeout(passTimer);
      passTimer = null;
    }
  }

  // claude.ai rewrites <html> attributes while it hydrates; put ours back.
  const guard = new MutationObserver(() => apply());
  guard.observe(ROOT, { attributes: true, attributeFilter: [THEME_ATTR, OPT_ATTR] });
  addEventListener("load", () => apply());

  /* ------------------------------------------------------------ storage */

  storageGet("sync", S.SYNC_KEYS).then((stored) => {
    // A change event can land before this first read resolves; keep it.
    raw = { ...stored, ...raw };
    settings = S.read(raw, REG);
    apply();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (dead) return;
    if (area === "sync" && S.SYNC_KEYS.some((k) => k in changes)) {
      for (const k of S.SYNC_KEYS) if (k in changes) raw[k] = changes[k].newValue;
      settings = S.read(raw, REG);
      apply();
    }
    // Popup buttons ("send a chocobo now"). Aimed at a theme, optionally at
    // one site; every tab currently wearing that theme there reacts.
    if (area === "local" && changes.action && changes.action.newValue) {
      const a = changes.action.newValue;
      if (current && a.theme === current.theme.id && (!a.site || a.site === SITE)) {
        call(runtimes.get(a.theme), "action", a.name, a.arg);
      }
    }
  });

  /* ----------------------------------------------------------- the API */

  function register(id, runtime) {
    runtimes.set(id, runtime);
    // Registered after the theme went on (scripts load in manifest order, so
    // only a harness does this): start it now.
    if (current && current.theme.id === id && !current.parts.includes(runtime)) {
      current.parts.push(runtime);
      call(runtime, "start", current.ctx);
      schedule();
    }
  }

  function useEngine(part) {
    engine.push(part);
    if (current) {
      current.parts.splice(engine.length - 1, 0, part);
      call(part, "start", current.ctx);
      schedule();
    }
  }

  globalThis.Tema = Object.freeze({ site: SITE, register, useEngine, schedule, alive });
})();
