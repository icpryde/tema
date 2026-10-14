# Safari

Safari runs web extensions, but only from inside a Mac app. Tema's app is
`safari/Tema.xcodeproj`, made with Apple's converter; it carries one copy of
the extension, generated from this repository at build time. Nothing in the
extension is edited by hand for Safari.

```bash
node tools/safari.mjs           # build, sign, install /Applications/Tema.app, register it
node tools/safari.mjs build     # build only, into safari/build/
node tools/safari.mjs stage     # write the Safari extension only, into safari/build/web/
```

Then: Safari → **Settings → Extensions** → tick **Tema**; open Tema's toolbar
button and tick the sites; reload open tabs. The version is the manifest's.

## What the build does

`tools/safari.mjs stage` writes `safari/build/web/`:

- the files the Chrome zip ships (`tools/package.mjs` decides those), and
- `src/safari/<site>.js` for each site: that site's stylesheets as text,
  loaded first, with a Safari manifest whose content scripts list **no CSS**.

The Xcode project's extension target references that folder and copies it
into `Tema Extension.appex`. `build` stages, runs `xcodebuild`, and checks the
signature. `install` puts the app in `/Applications` (or `~/Applications`),
removes Xcode's own registration of the copy in `DerivedData` (Safari would
list a second Tema), registers the installed one with `pluginkit`, and opens
it once in the background.

## Signing

With an **Apple Development** certificate in the keychain, the app is signed
with its team (the certificate's OU; `TEAM_ID=…` overrides) and Safari keeps
Tema enabled across restarts. Without one it is signed ad hoc ("Sign to Run
Locally"), which Safari only loads while **Develop → Developer Settings →
Allow unsigned extensions** is on. That setting resets whenever Safari quits,
and Safari judges an extension when it is registered, so after turning it
back on, run `node tools/safari.mjs` again (it re-registers). Every build
signs afresh: an incremental build that changed only web files can skip the
re-sign, and Safari then disables the extension.

## What's different in Safari

Almost nothing: the same content scripts, engine, themes and popup.

- **Stylesheets come in with the scripts.** Safari runs content scripts but
  has not reliably applied a manifest's CSS to freshly loaded pages (found
  porting another extension, 2026-10). So the Safari manifest lists none, and
  the engine (`src/content/core.js`, "Safari") adopts `src/safari/<site>.js`'s
  text as one constructed stylesheet: no page policy blocks those, and they
  cascade after the page's own sheets, at the same level as Chrome's injected
  CSS. A page that replaces `document.adoptedStyleSheets` would drop it, so
  every pass puts it back; it comes out when the extension goes away.
- **Website access is asked for, per site.** Chrome grants a manifest's sites
  at install; Safari asks, and runs nothing on a site until you allow it. The
  popup asks for a site's access the moment you tick it (Safari only prompts
  during the click), and shows a notice with an **Allow** button for a site
  that wears a theme but isn't allowed. Neither ever shows in Chrome. Once a
  site is allowed, WebKit runs the content scripts in its open tabs straight
  away, so they take the theme without a reload.
- **Fonts** load the way they do on claude.ai in Chrome: the engine fetches
  the font files from the extension and adds them with the FontFace API,
  which no page policy can refuse.

## Testing without Safari

Safari itself can't be driven unattended (the extension has to be enabled
and each site allowed by hand), so the Safari build is tested in WebKit's own
extension runtime, `WKWebExtension`, the engine under Safari's extensions:

- `tools/safari/harness.swift` loads an extension into it and takes JSON
  commands on stdin: open a page, open an extension page, run script in a
  page, answer Safari's permission prompts, snapshot a view.
- `tools/tests/safari.mjs` stages the Safari build and runs the same scenario
  as the Chrome end-to-end test against stand-in pages served at the real
  hostnames (through a local CONNECT proxy, with each site's kind of content
  security policy): the theme put on from the real popup, an option, a
  chocobo, a site taken off. Then it starts again the way Safari does, with
  no website access, and checks the popup's asking: nothing runs on an open
  claude.ai tab; tick Claude, refuse, see the notice; Allow, and the open tab
  takes the theme without a reload.
- `TEMA_ENGINE=webkit` runs the smoke, glyph, wide and render suites in WebKit
  instead of Chrome (`tools/lib/webkit.mjs`). `tools/check.mjs` runs all of it.

Harness notes, each found the hard way:

- The extension folder must be passed as an **absolute** path: a relative
  file URL keeps the working directory as a separate base, and
  `WKWebExtension` trips a release assertion on it instead of returning an
  error.
- A non-persistent website data store is private browsing to WebKit, where
  extensions run only with `hasAccessToPrivateData`.
- Script run through `evaluateJavaScript` counts as a user gesture, which
  hands the page user activation (the menu sounds then wake up). The probe
  pages are waited on through the view's title property instead, and read
  once at the end.
- Views nobody sees get their timers throttled and their processes suspended;
  the harness turns that off (WebKit SPI, test-only).
- Pages there come from `webkit-extension://`, not `safari-web-extension://`.
