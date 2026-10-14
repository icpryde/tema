// Tema — popup.
//
// Theme first: every theme is a card, and each card carries a toggle per site
// (Claude, ChatGPT, Gemini). A site wears one theme at a time, so turning a
// site on for one theme takes it off whichever theme had it.
//
// All this writes is chrome.storage.sync ("sites", "options") and the odd
// one-shot button press in chrome.storage.local ("action"). The content
// scripts on open tabs listen for those and restyle on the spot.
(() => {
  "use strict";

  const REG = globalThis.TemaRegistry;
  const S = globalThis.TemaSettings;
  const api = globalThis.browser && globalThis.browser.storage ? globalThis.browser : globalThis.chrome;
  const promised = api === globalThis.browser;

  const store = {
    get: (area, keys) => promised
      ? api.storage[area].get(keys)
      : new Promise((resolve) => api.storage[area].get(keys, (v) => resolve(v || {}))),
    set: (area, items) => promised
      ? api.storage[area].set(items)
      : new Promise((resolve) => api.storage[area].set(items, () => resolve())),
  };

  const SITES = REG.sites;
  const siteById = Object.fromEntries(SITES.map((s) => [s.id, s]));

  let raw = {};
  let settings = S.read(raw, REG);
  let openSettings = null;          // theme id whose settings panel is open
  const cards = new Map();          // theme id -> card element

  /* ------------------------------------------------------------ helpers */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  const ICONS = {
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M11.3 1.6l.4 2.2c.6.2 1.1.5 1.6.9l2.1-.8 1.3 2.3-1.7 1.4c.1.6.1 1.2 0 1.8l1.7 1.4-1.3 2.3-2.1-.8c-.5.4-1 .7-1.6.9l-.4 2.2H8.7l-.4-2.2c-.6-.2-1.1-.5-1.6-.9l-2.1.8-1.3-2.3L5 9.4a5 5 0 010-1.8L3.3 6.2l1.3-2.3 2.1.8c.5-.4 1-.7 1.6-.9l.4-2.2zM10 6.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"/></svg>',
  };
  const icon = (name, cls) => {
    const span = h("span", { class: cls || "icon" });
    span.innerHTML = ICONS[name];
    return span;
  };

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  const themeName = (id) => {
    const t = S.themeById(REG, id);
    return t ? t.name : id;
  };

  /* ------------------------------------------------------------- actions */

  async function toggleSite(theme, siteId) {
    const wearing = settings.sites[siteId] === theme.id;
    const { sites, previous } = S.withSite(settings, siteId, wearing ? null : theme.id);
    raw = { ...raw, sites };
    settings = S.read(raw, REG);
    update();
    await store.set("sync", { sites });
    const site = siteById[siteId].name;
    if (wearing) toast(`${site} is back to its own look`);
    else if (previous && previous !== theme.id && S.themeById(REG, previous)) {
      toast(`${site} now wears ${theme.name} instead of ${themeName(previous)}`);
    } else toast(`${site} now wears ${theme.name}`);
  }

  async function setOption(theme, opt, value) {
    const options = S.withOption(settings, theme.id, opt.id, value);
    raw = { ...raw, options };
    settings = S.read(raw, REG);
    await store.set("sync", { options });
    toast(`${opt.label} ${value ? "on" : "off"}`);
  }

  async function runAction(theme, action, button) {
    // `at` makes every press a new value, so pressing twice fires twice.
    await store.set("local", { action: { theme: theme.id, name: action.id, arg: button.arg, at: Date.now() } });
    const where = S.sitesWearing(settings, theme.id, REG);
    toast(where.length
      ? `${action.label}: watch your open ${where.map((s) => siteById[s].name).join(" / ")} tabs`
      : `Turn ${theme.name} on for a site first`);
  }

  function toggleSettings(themeId) {
    openSettings = openSettings === themeId ? null : themeId;
    store.set("local", { popup: { open: openSettings } });
    update();
  }

  /* ---------------------------------------------------------- rendering */

  function renderWearing() {
    const list = document.getElementById("wearing");
    list.replaceChildren(...SITES.map((s) => {
      const t = S.activeTheme(settings, s.id, REG);
      return h("li", { class: "wear" + (t ? " on" : ""), style: `--site:${s.color}` },
        h("span", { class: "dot", "aria-hidden": "true" }),
        h("span", { class: "wear-site", text: s.name }),
        h("span", { class: "wear-theme", text: t ? `${t.emoji} ${t.name}` : "Own look" }));
    }));
  }

  /** The art strip at the top of a card: the theme's own, or its colours. */
  async function loadArt(theme, slot) {
    const card = theme.card;
    const c = theme.colors || {};
    slot.style.setProperty("--art-bg", c.bg || "#1d1f2b");
    slot.style.setProperty("--art-accent", c.accent || "#9aa7ff");
    if (!card) return;
    for (const href of [...(card.styles || []), card.css].filter(Boolean)) {
      if (document.querySelector(`link[data-theme-css="${href}"]`)) continue;
      const link = h("link", { rel: "stylesheet", href: api.runtime.getURL(href), "data-theme-css": href });
      document.head.append(link);
    }
    if (card.html) {
      try {
        const res = await fetch(api.runtime.getURL(card.html));
        // Packaged with the extension, never fetched from anywhere else, so
        // this markup is as trusted as the popup's own.
        if (res.ok) slot.innerHTML = await res.text();
      } catch { /* the colour strip stays */ }
    }
  }

  function siteButton(theme, site) {
    const made = !!theme.sites[site.id];
    const btn = h("button", {
      class: "site",
      type: "button",
      "data-site": site.id,
      style: `--site:${site.color}`,
      disabled: !made,
      title: made ? `Wear ${theme.name} on ${site.host}` : `${theme.name} isn't made for ${site.name} yet`,
      onclick: () => toggleSite(theme, site.id),
    }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", { class: "site-name", text: site.name }), icon("check", "tick"));
    return btn;
  }

  function settingsPanel(theme) {
    const panel = h("div", { class: "settings", id: `settings-${theme.id}` });
    for (const opt of theme.options) {
      const box = h("input", {
        type: "checkbox",
        role: "switch",
        class: "switch",
        "data-opt": opt.id,
        onchange: (e) => setOption(theme, opt, e.target.checked),
      });
      panel.append(h("label", { class: "opt" },
        h("span", { class: "opt-text" },
          h("span", { class: "opt-label", text: opt.label }),
          opt.hint ? h("span", { class: "opt-hint", text: opt.hint }) : null),
        box));
    }
    for (const action of theme.actions || []) {
      panel.append(h("div", { class: "opt action" },
        h("span", { class: "opt-text" },
          h("span", { class: "opt-label", text: `${action.emoji ? action.emoji + " " : ""}${action.label}` }),
          action.hint ? h("span", { class: "opt-hint", text: action.hint }) : null),
        h("span", { class: "action-btns" }, action.buttons.map((b) =>
          h("button", { type: "button", class: "action-btn", title: b.title || null,
            onclick: () => runAction(theme, action, b) }, b.label)))));
    }
    return panel;
  }

  function card(theme) {
    const art = h("div", { class: "art", "aria-hidden": "true" });
    loadArt(theme, art);
    const hasSettings = (theme.options || []).length || (theme.actions || []).length;
    const accent = theme.colors && theme.colors.accent;
    const el = h("article", {
      class: "card",
      "data-theme": theme.id,
      "aria-labelledby": `name-${theme.id}`,
      style: accent ? `--card-accent:${accent}` : null,
    },
      art,
      h("div", { class: "card-body" },
        h("div", { class: "card-head" },
          h("h2", { class: "name", id: `name-${theme.id}` },
            h("span", { class: "emoji", "aria-hidden": "true", text: theme.emoji }),
            h("span", { class: "name-text", text: theme.name })),
          hasSettings ? h("button", {
            type: "button",
            class: "gear",
            title: "Theme settings",
            "aria-label": `${theme.name} settings`,
            "aria-controls": `settings-${theme.id}`,
            onclick: () => toggleSettings(theme.id),
          }, icon("gear")) : null),
        h("p", { class: "tagline", text: theme.tagline }),
        h("div", { class: "sites", role: "group", "aria-label": `Wear ${theme.name} on` },
          SITES.map((s) => siteButton(theme, s)))),
      hasSettings ? settingsPanel(theme) : null);
    return el;
  }

  /** Reflect the current settings without rebuilding (keeps focus and art). */
  function update() {
    renderWearing();
    for (const theme of REG.themes) {
      const el = cards.get(theme.id);
      if (!el) continue;
      const worn = S.sitesWearing(settings, theme.id, REG);
      el.classList.toggle("worn", worn.length > 0);
      for (const btn of el.querySelectorAll(".site")) {
        btn.setAttribute("aria-pressed", String(worn.includes(btn.dataset.site)));
      }
      for (const box of el.querySelectorAll(".switch")) {
        box.checked = S.optionValue(theme, settings.options, box.dataset.opt);
      }
      const open = openSettings === theme.id;
      const gear = el.querySelector(".gear");
      if (gear) gear.setAttribute("aria-expanded", String(open));
      const panel = el.querySelector(".settings");
      if (panel) panel.hidden = !open;
    }
  }

  function render() {
    const list = document.getElementById("themes");
    for (const theme of REG.themes) {
      const el = card(theme);
      cards.set(theme.id, el);
      list.append(el);
    }
    const n = REG.themes.length;
    document.getElementById("count").textContent =
      `${n} theme${n === 1 ? "" : "s"} · more on the way`;
    update();
  }

  /* -------------------------------------------------------------- start */

  async function init() {
    const [sync, local] = await Promise.all([
      store.get("sync", S.SYNC_KEYS),
      store.get("local", ["popup"]),
    ]);
    raw = sync;
    settings = S.read(raw, REG);
    const remembered = local.popup && local.popup.open;
    if (remembered && S.themeById(REG, remembered)) openSettings = remembered;
    render();

    // Another popup, or a second browser window, can change things too.
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !S.SYNC_KEYS.some((k) => k in changes)) return;
      for (const k of S.SYNC_KEYS) if (k in changes) raw[k] = changes[k].newValue;
      settings = S.read(raw, REG);
      update();
    });
  }

  init();
})();
