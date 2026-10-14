// Tema — settings model, shared by the popup and the content scripts.
//
// Pure functions over plain data, so the same rules decide what the popup
// shows and what a page wears, and tools/tests/unit.mjs can check them in
// Node without a browser.
//
// What is stored (chrome.storage.sync, so it follows the browser profile):
//
//   sites    { claude: "final-fantasy", chatgpt: null, gemini: "final-fantasy" }
//            Which theme each site wears. A site wears at most one theme;
//            null (or missing) means the site's own look.
//   options  { "final-fantasy": { "menu-sounds": false } }
//            Only values someone actually changed. Everything else falls back
//            to the default declared in the theme's theme.json, so a new
//            option reaches existing installs switched to its default.
(() => {
  "use strict";

  const SYNC_KEYS = ["sites", "options"];

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  const themeById = (reg, id) => reg.themes.find((t) => t.id === id) || null;

  const supports = (theme, site) => !!(theme && theme.sites && theme.sites[site]);

  /** Normalise whatever storage handed back into the shape above. */
  function read(raw, reg) {
    const sites = {};
    const storedSites = isObj(raw && raw.sites) ? raw.sites : {};
    for (const s of reg.sites) {
      const id = storedSites[s.id];
      sites[s.id] = typeof id === "string" && id ? id : null;
    }
    const options = {};
    const storedOpts = isObj(raw && raw.options) ? raw.options : {};
    for (const [themeId, values] of Object.entries(storedOpts)) {
      if (!isObj(values)) continue;
      const clean = {};
      for (const [k, v] of Object.entries(values)) if (typeof v === "boolean") clean[k] = v;
      options[themeId] = clean;
    }
    return { sites, options };
  }

  /**
   * The theme a site should wear right now, or null. A stored id that names
   * a theme this build doesn't have (removed, renamed) or one that was never
   * made for this site reads as "no theme" rather than as an error.
   */
  function activeTheme(settings, site, reg) {
    const t = themeById(reg, settings.sites[site]);
    return supports(t, site) ? t : null;
  }

  function optionValue(theme, options, optId) {
    const saved = options[theme.id];
    if (saved && optId in saved) return saved[optId];
    const decl = (theme.options || []).find((o) => o.id === optId);
    return !!(decl && decl.default);
  }

  /** Option ids switched ON for a theme, in declaration order. */
  function enabledOptions(theme, options) {
    return (theme.options || []).filter((o) => optionValue(theme, options, o.id)).map((o) => o.id);
  }

  /** Sites currently wearing a theme, in site order. */
  function sitesWearing(settings, themeId, reg) {
    return reg.sites.map((s) => s.id).filter((s) => settings.sites[s] === themeId);
  }

  /**
   * Put a theme on a site (or take it off with themeId null). Returns the
   * new sites map and whichever theme the site wore before, so the popup can
   * say what it replaced.
   */
  function withSite(settings, site, themeId) {
    const previous = settings.sites[site] || null;
    return { sites: { ...settings.sites, [site]: themeId || null }, previous };
  }

  function withOption(settings, themeId, optId, value) {
    return {
      ...settings.options,
      [themeId]: { ...(settings.options[themeId] || {}), [optId]: !!value },
    };
  }

  function siteForHost(reg, hostname) {
    for (const s of reg.sites) {
      if (hostname === s.host || hostname.endsWith("." + s.host)) return s.id;
    }
    return null;
  }

  globalThis.TemaSettings = Object.freeze({
    SYNC_KEYS,
    read,
    themeById,
    supports,
    activeTheme,
    optionValue,
    enabledOptions,
    sitesWearing,
    withSite,
    withOption,
    siteForHost,
  });
})();
