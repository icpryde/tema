# Making a theme

A theme is one folder under `themes/`. Tema's engine finds it through
`themes/index.json`, loads its stylesheets on the sites it supports, runs its
behaviour script while it is on, and gives it a card in the popup.

```
themes/<id>/
  theme.json        what the theme is and what it needs (below)
  claude.css        one stylesheet per site it supports
  chatgpt.css
  gemini.css
  runtime.js        optional: behaviour (things CSS can't do)
  card.html         optional: art for its card in the popup
  card.css
  assets/           anything the files above use (generated sprites, fonts…)
  art/, tools/      optional: sources and generators; never shipped
```

Then:

1. add the id to `themes/index.json` (the order there is the popup's order),
2. `node tools/build.mjs` — regenerates `src/registry.js` and the
   `content_scripts` / `web_accessible_resources` in `manifest.json`,
3. `node tools/check.mjs`.

## theme.json

```jsonc
{
  "id": "final-fantasy",                 // = the folder name
  "name": "Final Fantasy",
  "emoji": "💎",
  "tagline": "One sentence for the card.",
  "colors": { "bg": "#0b1240", "text": "#dbe4ff", "accent": "#ffd75e" },

  "sites": {                             // site id -> its stylesheet(s)
    "claude": "claude.css",
    "chatgpt": ["assets/fonts.css", "chatgpt.css"],
    "gemini": ["assets/fonts.css", "gemini.css"]
  },
  "styles": ["assets/sprites/art.css"],  // loaded first on every site above
  "fonts": [                             // loaded by the engine on every site
    { "family": "My Pixel Face", "src": "assets/fonts/MyFace.woff2" }
  ],
  "script": "runtime.js",                // optional
  "signals": ["replies", "working"],     // optional, see below
  "files": ["assets/sounds/*.wav"],      // fetched at runtime (made web-accessible)
  "ship": ["assets/OFL.txt"],            // other files the zip must carry
  "card": { "html": "card.html", "css": "card.css" },

  "options": [                           // switches in the card's settings
    { "id": "menu-sounds", "label": "Menu sounds", "hint": "…", "default": true }
  ],
  "actions": [                           // buttons in the card's settings
    { "id": "choco", "label": "Chocobo drive-by", "emoji": "🐤", "hint": "…",
      "buttons": [{ "arg": "a", "label": "Parkour", "title": "…" }] }
  ]
}
```

Sites are defined once, in `src/sites.json` (`claude`, `chatgpt`, `gemini`).
A theme that leaves a site out simply can't be worn there; its pill in the
popup is greyed out.

## Stylesheets

Every theme's stylesheets are on the page all the time (the manifest injects
them at document start), so **every rule must be scoped** to the theme:

```css
html[data-tema="my-theme"] body { … }
html[data-tema="my-theme"][data-tema-opt~="menu-sounds"] … { … }
```

`data-tema` is the theme the site is wearing; `data-tema-opt` lists the
options that are switched on. Switching themes in the popup is one attribute
write, so there's no reload and no flash. Keep generated art in data URIs
(as `--my-theme-*` custom properties): a relative `url()` in injected CSS
can resolve against the page, and an absolute `chrome-extension://` URL
won't work in Safari.

Fonts go in `fonts`: the engine fetches each file itself and hands it to
the page through the FontFace API, which works on every site. A stylesheet
with the same faces embedded as `data:` URIs only helps where the page
allows `data:` fonts, where it gives the face from the very first paint.
claude.ai refuses them, and each refusal is listed on the extension's
Errors page, so list such a stylesheet for the other sites only.

Name every custom property, keyframe and class with a prefix of your own
(Final Fantasy uses `ff-`), since all themes share the page.

## Page signals

CSS can't tell a reply that holds text from claude.ai's empty placeholder,
or whether the model is still working. Tema's engine works these out per
site and stamps them as attributes, for any theme that lists them in
`signals`:

| signal | stamp | where |
|---|---|---|
| `replies` | `data-tema-reply` | every reply that holds answer text |
|  | `data-tema-latest` | the newest of those |
| `working` | `data-tema-working` | the newest turn while the model is busy (ChatGPT, Gemini) |
| `icons` | `data-tema-icon="bolt"` … | claude.ai's icon-font glyphs, by name |
| `wide-tables` | `--tema-grow` | claude.ai: how far a reply should widen for a wide table |

The detectors live in `src/content/signals.js`, with notes on what each site's
markup taught. `docs/sites.md` has the hooks themes key on.

## Behaviour script

For what CSS can't do. It runs on every site the theme supports, and talks to
the engine through `globalThis.Tema`:

```js
(() => {
  const T = globalThis.Tema;
  if (!T) return;
  T.register("my-theme", {
    start(ctx) {},       // the theme went on in this tab; ctx = { site, theme, options, has(id) }
    stop() {},           // it went off, or the extension reloaded: remove EVERYTHING you added
    update(ctx) {},      // options changed while on
    pass() {},           // the page changed (debounced DOM mutations, scroll, resize)
    added(el) {},        // an element was just added, before the browser paints it
    action(name, arg) {} // a button from theme.json "actions" was pressed in the popup
  });
})();
```

`T.site` is the site, `T.schedule()` asks for a pass, `T.alive()` is false
once the extension has been reloaded under the page. Nothing runs, listens or
lingers while the theme is off: the engine only starts a theme where it is
worn, and calls `stop()` the moment it isn't.

## Card art

`card.html` is dropped into the top of the theme's card and `card.css` styles
it; the theme's `styles` are loaded into the popup too, so the card can use
the same sprites. Scope card rules to `.card[data-theme="my-theme"]`.

## Testing

`node tools/check.mjs` runs everything. For a new theme, the useful pieces to
copy are in `tools/tests/`: `render.mjs` (computed-style probes on site-shaped
pages: what the theme must change and what it must leave alone) and
`smoke.mjs` (runs the content scripts against stand-in pages over time). The
mocks in `tools/mocks/` render a theme offline for visual work.
