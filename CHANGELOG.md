# Changelog

## Unreleased

- Gemini: the New chat box sits flush with the boxes below it again (Gemini 4
  wraps it in a container with an 8px margin of its own) and no longer shows
  a double border: New chat is alone in that box now, so the active row's
  ring ran just inside the box's frame. The active row keeps its wash.
- Claude: the account row's right-hand button (now "Get apps and
  extensions", "Send feedback" before it) wears the menu crystal again.
  The crystal follows the slot, not the label.
- Claude: voice mode and its microphone menu (the ⌄) are one split control,
  and now look like one: a single chip with two halves. Chipped separately,
  the ⌄ (tucked 6px under by Claude) drew over the voice button.
- Claude rebuilt its chat page (2026-10), and replies had lost the theme:
  no window, no crystal, no pixel type, no Mog. Replies are menu windows
  again, with the action row (Copy, the thumbs, Retry) outside the window
  as before; your messages are menu windows in the pixel face; and Mog
  lives under the newest reply as he does on ChatGPT, hopping from the
  moment you send until Claude's last word, in place of Claude's own clay
  working mark. The colourful-text option and the wide-table windows
  follow the new page too.
- Gemini: Mog stands under the reply again. Gemini 4's wide layout centres
  each reply in a reading column while the box around it spans the screen,
  and Mog had stayed at that box's far left edge. And for the couple of
  seconds before Gemini starts a reply, he now waits under your new message
  instead of hopping under the previous reply above it (and no longer
  flashes back there for a moment when the reply appears).
- The crystal in a one-line reply sat low, running onto the window's
  bottom border; in a window that short it now centres on the line. Longer
  replies are unchanged.
- No more errors on Tema's Errors page from claude.ai: the theme's fonts
  were also embedded in a stylesheet, which claude.ai refuses (logging an
  error each time). claude.ai gets them only the way it already used them,
  loaded by the extension itself.

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
- Gemini 4, continued: reply windows follow its new 708px reading column
  instead of stretching across the screen; Task mode's suggestions are a
  command menu with the select hand; the new Scheduled, Customise and More
  rows have pixel icons; the scroll-to-bottom button is a menu button.
- The big hand: clicking a Gemini sidebar row left Material's focus layer
  stretching the row's select hand across the label. Every site's row hand
  is now pinned to its size and spot.
- claude.ai's rebuilt sidebar: icons follow the rows' names (Projects,
  Artifacts, Scheduled, Customize, More), the nav rows are a menu window
  again, and the new-chat greeting is pixel type once more.
- ChatGPT: Codex and Images have their own icons, and a sidebar row the
  theme doesn't know yet gets the star instead of an empty slot.
- Fonts: claude.ai refuses fonts embedded in stylesheets, which left Claude
  in fallback type. Tema now also loads a theme's font files itself (the
  FontFace API), so the pixel fonts load on every site, and the same way in
  Safari later.
- Switching a theme off undoes every inline change it made, including
  Gemini's send button.
- Engine: the page facts themes key on (filled replies, the newest reply,
  "the model is working", claude.ai's icon glyphs, wide tables) are worked out
  once by the engine and shared by every theme. Adding a theme is a folder
  and a `theme.json`; `tools/build.mjs` writes the manifest.
- Tests: `node tools/check.mjs` runs eight suites, including an end-to-end run
  of the installed extension at the real hostnames, driven through the popup.
