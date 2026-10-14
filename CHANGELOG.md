# Changelog

## 1.0.0 — 2026-10-13

The first release of Tema.

- **Theme first.** The popup lists themes as cards; each card has a toggle
  per site (Claude, ChatGPT, Gemini). A site wears one theme at a time, so
  ticking a site on one theme moves it off another. A strip at the top shows
  what each site is wearing.
- **Final Fantasy** for claude.ai (Home and the Code tab), chatgpt.com and
  gemini.google.com: menu windows, pixel fonts, the crystal, the party, Mog,
  menu sounds, the night sky and the chocobo. Its settings and the chocobo
  buttons live on its card, and are shared by all three sites.
- **Gemini 4.** The Chat/Task toggle that Gemini 4 puts inside the message box
  on a new chat becomes its own little menu window under the composer, with a
  gold active tab; the window frames the input row alone. The paint sweep that
  turns Gemini's scroll fades into night sky no longer catches the composer
  itself (Gemini 4 made it a div, which slipped past the old exemption and
  could repaint the message box in a conversation), and it now runs on the
  first pass after the page loads.
- Switching a theme off undoes every inline change it made, including
  Gemini's send button.
- The pixel fonts are embedded in the theme, so they load everywhere (and
  will in Safari), with no extension URL to resolve.
- Engine: the page facts themes key on (filled replies, the newest reply,
  "the model is working", claude.ai's icon glyphs, wide tables) are worked out
  once by the engine and shared by every theme. Adding a theme is a folder
  and a `theme.json`; `tools/build.mjs` writes the manifest.
- Tests: `node tools/check.mjs` runs eight suites, including an end-to-end run
  of the installed extension at the real hostnames, driven through the popup.
