// Tema — a chrome.* stand-in for pages opened straight from disk.
//
// The offline mocks and the browser-driven tests load Tema's real scripts
// into file:// pages, where no extension API exists. This installs the part
// of chrome.* that Tema uses — storage (sync, local, onChanged) and runtime
// (id, getURL) — backed by localStorage, and with the real API's timing:
// callbacks, promises and change events always land on a later task, as they
// do in the browser. A synchronous fake once hid a startup-order bug that
// only the real extension tripped over.
//
// Seed a page before Tema's scripts load:
//   localStorage.setItem("sync:sites", JSON.stringify({ claude: "final-fantasy" }));
//
// Never shipped: tools/ is not part of the release zip.
(() => {
  "use strict";
  if (globalThis.chrome && globalThis.chrome.storage) return;

  const here = document.currentScript ? document.currentScript.src : location.href;
  const ROOT = new URL("../../", here).href;   // tools/lib/ -> the repo root
  const listeners = new Set();
  const later = (fn) => setTimeout(fn, 0);
  const slot = (area, k) => area + ":" + k;
  const parse = (v) => (v === null ? undefined : JSON.parse(v));

  function deliver(cb, value) {
    if (typeof cb === "function") { later(() => cb(value)); return undefined; }
    return new Promise((resolve) => later(() => resolve(value)));
  }

  function emit(changes, area) {
    if (!Object.keys(changes).length) return;
    later(() => { for (const fn of listeners) fn(changes, area); });
  }

  function makeArea(area) {
    return {
      get(keys, cb) {
        if (typeof keys === "function") { cb = keys; keys = null; }
        const out = {};
        if (keys == null) {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k.startsWith(area + ":")) out[k.slice(area.length + 1)] = JSON.parse(localStorage.getItem(k));
          }
        } else {
          const defaults = typeof keys === "object" && !Array.isArray(keys) ? keys : {};
          const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          for (const k of list) {
            const v = parse(localStorage.getItem(slot(area, k)));
            if (v !== undefined) out[k] = v;
            else if (k in defaults) out[k] = defaults[k];
          }
        }
        return deliver(cb, out);
      },
      set(items, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          const old = parse(localStorage.getItem(slot(area, k)));
          localStorage.setItem(slot(area, k), JSON.stringify(v));
          changes[k] = { oldValue: old, newValue: v };
        }
        emit(changes, area);
        return deliver(cb);
      },
      remove(keys, cb) {
        const changes = {};
        for (const k of [].concat(keys)) {
          const old = parse(localStorage.getItem(slot(area, k)));
          if (old === undefined) continue;
          localStorage.removeItem(slot(area, k));
          changes[k] = { oldValue: old };
        }
        emit(changes, area);
        return deliver(cb);
      },
    };
  }

  globalThis.chrome = {
    storage: {
      sync: makeArea("sync"),
      local: makeArea("local"),
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    runtime: {
      id: "tema-dev-shim",
      getURL: (p) => new URL(String(p).replace(/^\//, ""), ROOT).href,
    },
  };
})();
