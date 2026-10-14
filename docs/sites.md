# Site notes

What the three sites' pages look like to a theme: the hooks that have held,
and the traps. All three ship new markup without notice, so every date below
is when it was last checked live. The stylesheets in `themes/final-fantasy/`
carry the detail beside each rule; this is the map.

## claude.ai

- Design tokens are HSL triplets (`--bg-000`, `--text-100`, `--accent-brand`…),
  used as `hsl(var(--x) / a)`. Override them on `html` **and** `*`.
- Fonts are assigned per element by utility classes (`.font-ui`,
  `.font-base`, `.font-claude-response`…), so setting `body` does nothing:
  each class has to be named.
- A reply is `div[data-is-streaming]` with its text in `.font-claude-response`.
  While Claude thinks, the reasoning already sits inside, marked
  `[data-find-omitted]`; the page signals skip it, so `data-tema-reply`
  lands with the first real answer text.
- The empty next-turn placeholder is mounted most of the time: pick "newest
  reply" from stamped replies only.
- The 2026-10 transcript (the "cds" design system, probed 2026-10-14) keeps
  `data-is-streaming` but on `div[data-cds="AssistantMessage"]`, which holds
  a screen-reader `h2`, the content column (the `data-cds="TurnStatus"`
  thinking summary, marked `[data-find-omitted]`, then the body
  `[data-transcript-engine-root] > .prose`) and the action row
  (`data-cds="MessageActions"`). The window frames the content column. Your
  turn is `div[data-cds="UserMessage"]`: the bubble is its child holding
  `[data-testid="user-message"]`, beside its own action row. There is no
  next-turn placeholder and no working glyph; `data-is-streaming="true"`
  holds for the whole run, and the `working` signal follows it.
- The working glyph is `svg[data-cds="Spark"]` (and a sprite-strip logo);
  a `:has()` nested in a `:has()` is invalid CSS and drops the whole rule
  silently — `tools/tests/glyph.mjs` counts parsed rules for that reason.
- Composer: `div[class*="cursor-text"]:has([data-testid="chat-input"])`;
  the Code tab's is `.epitaxy-prompt`.
- Small icons are Private Use Area glyphs from the Anthropicons font; the
  `icons` signal names them (`data-tema-icon`).
- Wide tables scroll inside the column; there's no container to size against
  from CSS, hence the `wide-tables` signal.

## chatgpt.com (the 2026-09 "app shell", probed 2026-09-27/29)

- No `data-testid`s at all. A turn is `div[data-turn-key]` holding both
  units: `[data-chatgpt-search-unit-key$=":user"]` and `…$=":assistant"]`.
- Reply body `[data-markdown-text-style="assistant-message"]` mounts with the
  first token; user bubble `[data-user-message-bubble]`.
- Busy: composer button `aria-label="Stop"`, `[role=status][aria-busy=true]`
  until the body mounts, `data-markdown-animated` while it streams; the action
  row (`.turn-action-controls`, outside the user unit) mounts at completion.
- Composer `form[data-chatgpt-composer][data-composer-placement=thread|home]`;
  the visual box is `[data-composer-surface-variant]`; input
  `.ProseMirror[data-composer-markdown]`.
- Sidebar `#app-shell-sidebar` (rows `.sidebar-item`); collapsed rail
  `nav[data-app-navigation-rail]`. The profile row's own `::after` is
  ChatGPT's divider: never draw on it.
- Tokens `--color-surface*`, `--color-text*`, `--app-color-*`, inside
  `@layer theme`. Tailwind utilities with a trailing `!` are layered
  importants and beat unlayered ones; the theme wins those from `@layer`.
- Tables break out of the column rightward (`[data-wide-block]`).

## gemini.google.com (Gemini 4, probed 2026-10-13)

- Angular + Material: tokens are `--gem-sys-color--*` / `--bard-color-*`;
  icons are `mat-icon` font ligatures, so icon swaps hide the glyph by colour
  and draw on the slot.
- A turn is `.conversation-container` with `<user-query>` and
  `<model-response>`; the answer is `message-content .markdown`, reasoning
  `model-thoughts` / `.thoughts-container`. Settled replies keep an empty
  `thinking-overlay`; `.has-thoughts` wraps the real answer too.
- `div.response-container` nests inside the `<response-container>` element:
  key on the class only, or anything drawn appears twice.
- The "extended and XL grid" layout (`.enable-extended-and-xl-grid`): the
  response container spans the whole chat area and each block centres in a
  708px column (740px for code and images, full width for tables and other
  wide blocks). Anything placed against the container's edge, like the reply
  window or Mog, has to follow the column instead.
- A hidden `mat-progress-spinner` idles in the history scroller at rest, so
  busy tests scope spinners to the newest reply.
- The composer box is `.input-area-container` (a `fieldset` before Gemini 4,
  a `div` since); the stock pill's fill belongs to the `input-area-v2` host.
  On a new chat it also holds the Chat/Task toggle (`chat-spark-toggle` →
  `gem-segmented-button-row`, active tab `.gem-segmented-button-selected`,
  sliding `.gem-segmented-button-row-slider`). No toggle in a conversation.
- `input-container` paints an opaque band of its own, and generated scroll
  fades cover the bottom of the chat; overlay menus (`mat-card` in the cdk
  overlay) take their dark fill from a cross-origin rule. Stylesheets lose
  some of these fights, which is why the Final Fantasy runtime pins them
  inline (and undoes it when the theme goes off).
- The send button mounts only once there is text; old turns virtualise out.
