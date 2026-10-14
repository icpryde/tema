// Tema — page signals.
//
// Facts about each site's chat page that CSS cannot work out for itself,
// stamped as attributes so any theme can style against them:
//
//   "replies"      data-tema-reply   every reply that holds real answer text
//                  data-tema-latest  the newest of those
//   "working"      data-tema-working the newest turn while the model is busy
//   "icons"        data-tema-icon    claude.ai's icon-font glyphs, by name
//   "wide-tables"  --tema-grow       claude.ai: how far a reply should widen
//                                    for a table that can't fit the column
//
// A theme lists the signals it uses in its theme.json; none of this runs for
// a theme that asks for none, and every stamp comes off when the theme does.
// The detectors were each worked out against the live sites, and the notes
// beside them say what each site's markup taught.
(() => {
  "use strict";

  const T = globalThis.Tema;
  if (!T) return;
  const SITE = T.site;

  const REPLY = "temaReply";              // dataset key of data-tema-reply
  const LATEST = "data-tema-latest";
  const WORKING = "data-tema-working";
  const GROW = "--tema-grow";

  let want = new Set();

  /* -------------------------------------------------------- reply text */

  /**
   * Does this reply body hold any RESPONSE text?
   *
   * textContent alone is the wrong test on claude.ai: while Claude is
   * thinking, the streamed reasoning already sits inside
   * .font-claude-response, collapsed and marked [data-find-omitted] so the
   * browser's find-in-page skips it. Counting it stamped the reply mid-
   * thinking, which drew an empty framed window and swapped the working
   * glyph out early. Once the answer streams, its text lands OUTSIDE the
   * marker (and the settled DOM drops the marker nodes entirely), so
   * skipping [data-find-omitted] makes the stamp land exactly when the real
   * reply begins.
   */
  function hasReplyText(body) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue.trim()) continue;
      const el = t.parentElement;
      if (el && el.closest("[data-find-omitted]")) continue;
      return true;
    }
    return false;
  }

  /**
   * Gemini's version: what must not count is the thoughts subtree.
   * thinking-overlay is the settled build's leftover shell; the class
   * has-thoughts is deliberately NOT excluded — it sits on the wrapper that
   * holds the real answer too, and excluding it would blind this walk.
   */
  function hasGeminiReplyText(body) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue.trim()) continue;
      const el = t.parentElement;
      if (el && el.closest("model-thoughts, .thoughts-container, thinking-overlay, .thinking-banner")) continue;
      return true;
    }
    return false;
  }

  function stampReply(el, filled) {
    if (filled) {
      if (!el.dataset[REPLY]) el.dataset[REPLY] = "1";
    } else if (el.dataset[REPLY]) {
      delete el.dataset[REPLY];
    }
  }

  /* ----------------------------------------------------------- working */

  // Hysteresis state: the moment the busy signals last held, and the timer
  // that re-checks once they have been gone for the whole grace window.
  let workHold = 0;
  let workTimer = null;

  /**
   * Stamp `last` (the newest turn) as working while `busy` holds.
   *
   * HYSTERESIS. Long runs hand off between phase widgets with brief moments
   * where NO busy signal is mounted, and tracking the union instantly made
   * anything keyed on it blink at each hand-off. Once busy, the stamp holds
   * for a grace window that every busy pass refreshes, and clears only after
   * the signals have been gone for the whole window. Run end costs ~1.5s of
   * overstay; mid-run gaps cost nothing. The timer exists because passes are
   * mutation-driven: a silent DOM after the last signal would otherwise never
   * re-evaluate and never clear.
   */
  function holdWorking(busy, last) {
    const now = performance.now();
    if (busy) {
      workHold = now + 1500;
      if (workTimer) { clearTimeout(workTimer); workTimer = null; }
    }
    const active = busy || now < workHold;
    const working = active && want.has("working") ? last : null;
    if (!busy && active && !workTimer) {
      workTimer = setTimeout(() => {
        workTimer = null;
        markReplies();
      }, workHold - now + 80);
    }
    for (const el of document.querySelectorAll("[" + WORKING + "]")) {
      if (el !== working) el.removeAttribute(WORKING);
    }
    if (working && !working.hasAttribute(WORKING)) working.setAttribute(WORKING, "");
  }

  /* ----------------------------------------------------------- replies */

  function markReplies() {
    if (SITE === "gemini") markGemini();
    else if (SITE === "chatgpt") markChatgpt();
    else markClaude();
    if (want.has("replies")) markLatest();
  }

  function markGemini() {
    // Turns are .conversation-container (a user-query + a model-response
    // each); the reply body is message-content's .markdown. While the model
    // only thinks, the markdown holds no text yet (the streamed reasoning
    // lives in .thoughts-container / model-thoughts, with "Show thinking"
    // chrome), so thoughts subtrees are excluded from the walk and the stamp
    // lands exactly when the first real answer token does.
    const replies = document.querySelectorAll("model-response");
    if (want.has("replies")) {
      for (const el of replies) {
        const body = el.querySelector("message-content .markdown") || el.querySelector(".markdown");
        stampReply(el, !!body &&
          !body.closest("model-thoughts, .thoughts-container, thinking-overlay") &&
          hasGeminiReplyText(body));
      }
    }

    // Working = the newest model-response while the run is in flight. A union
    // of signals: the stop affordance replaces the send arrow for the whole
    // run, the generation-time loaders (skeleton / shimmer / thinking banner,
    // none of which exist at rest) cover the silent reasoning stretch, and
    // the actions row under the reply mounts at completion. The spinner test
    // stays SCOPED to the newest reply: a hidden mat-progress-spinner idles
    // inside the history scroller at rest (pagination), so a document-wide
    // spinner test would read as busy forever.
    const last = replies[replies.length - 1] || null;
    const busy = !!(
      document.querySelector('button[aria-label*="stop" i], .stop-icon, [class*="stop-generating"]') ||
      document.querySelector(".thinking-banner, .skeleton-loader-container, .gem-shimmer-active") ||
      (last && (
        !last.querySelector("message-actions") ||
        last.querySelector('[class*="streaming"], [class*="generating"], [class*="pending"], .loading-indicator, blinking-cursor') ||
        last.querySelector("mat-progress-spinner, mat-spinner")
      ))
    );
    holdWorking(busy, last);
  }

  function markChatgpt() {
    // App-shell build (2026-09): a turn is div[data-turn-key] holding the
    // user unit AND the assistant unit(s). The assistant unit
    // ([data-chatgpt-search-unit-key$=":assistant"]) is the whole message
    // and nothing else, so it takes the stamp. Its body,
    // [data-markdown-text-style="assistant-message"], mounts with the first
    // answer token; before that the turn shows only a status row.
    const shellTurns = document.querySelectorAll("[data-turn-key]");
    if (shellTurns.length) {
      if (want.has("replies")) {
        for (const unit of document.querySelectorAll(
          '[data-turn-key] [data-chatgpt-search-unit-key$=":assistant"]')) {
          const body = unit.querySelector('[data-markdown-text-style="assistant-message"]');
          stampReply(unit, !!body && hasReplyText(body));
        }
      }
      // Working = the newest TURN (the reply may not exist yet). Measured on
      // a live run (2026-09-27): the send slot turns into "Stop", the turn
      // shows an aria-busy status row ("ChatGPT is responding") until the
      // body mounts, the body wears data-markdown-animated while it streams,
      // and the action row (Copy, Rate, Read aloud, Regenerate) mounts only
      // at completion, so its absence alone spans the whole run. The user
      // bubble's hover actions share the row's class, so they are excluded
      // by unit. The shimmer classes are the thinking/searching labels.
      const last = shellTurns[shellTurns.length - 1];
      const settled = [...last.querySelectorAll(".turn-action-controls")]
        .some((el) => !el.closest('[data-chatgpt-search-unit-key$=":user"]'));
      const busy = !settled ||
        !!last.querySelector('[data-markdown-animated], [role="status"][aria-busy="true"], ' +
          '[class*="workingTextShimmer-"], [class*="cadencedShimmerActive-"]') ||
        !!document.querySelector('form[data-chatgpt-composer] button[aria-label="Stop"], ' +
          "[data-in-progress-fixed-content]");
      holdWorking(busy, last);
      return;
    }

    // The previous build: every turn a section[data-turn], the assistant
    // body .markdown. While the model was still thinking the same .markdown
    // carried .result-thinking with an empty <p>, so thinking is excluded
    // outright and the stamp lands with the first real token.
    const turns = document.querySelectorAll('section[data-turn="assistant"]');
    if (want.has("replies")) {
      for (const el of turns) {
        const body = el.querySelector(".markdown");
        stampReply(el, !!body && !body.classList.contains("result-thinking") && hasReplyText(body));
      }
    }
    // Working there was judged by run END first (the copy button mounts at
    // completion) with in-flight signals as backstops, because the Pro build
    // pre-mounted that row with the turn shell. The loading-shimmer family is
    // what carried the search/reasoning stretch.
    const last = turns[turns.length - 1] || null;
    const busy = !!(last && (
      !last.querySelector('[data-testid="copy-turn-action-button"]') ||
      last.querySelector('.result-thinking, .streaming-animation, [class*="loading-shimmer"]') ||
      document.querySelector('[data-testid="stop-button"]')));
    holdWorking(busy, last);
  }

  function markClaude() {
    // claude.ai shows its working state itself (the status row under the
    // reply), so only the reply stamp is needed here.
    if (!want.has("replies")) return;
    for (const el of document.querySelectorAll("div[data-is-streaming]")) {
      const body = el.querySelector(".font-claude-response");
      stampReply(el, !!body && hasReplyText(body));
    }
  }

  /**
   * The newest filled reply. It has to come from the SAME set the reply
   * stamp frames: picking from every wrapper put it on claude.ai's empty
   * next-turn placeholder, which is mounted most of the time.
   */
  function markLatest() {
    const replies = document.querySelectorAll(
      SITE === "gemini" ? "model-response[data-tema-reply]"
      : SITE === "chatgpt"
        ? 'section[data-turn="assistant"][data-tema-reply], [data-chatgpt-search-unit-key][data-tema-reply]'
        : "div[data-is-streaming][data-tema-reply]");
    const last = replies[replies.length - 1] || null;
    for (const el of document.querySelectorAll("[" + LATEST + "]")) {
      if (el !== last) el.removeAttribute(LATEST);
    }
    if (last && !last.hasAttribute(LATEST)) last.setAttribute(LATEST, "");
  }

  function clearReplies() {
    document.querySelectorAll("[data-tema-reply]").forEach((el) => delete el.dataset[REPLY]);
    document.querySelectorAll("[" + LATEST + "]").forEach((el) => el.removeAttribute(LATEST));
    document.querySelectorAll("[" + WORKING + "]").forEach((el) => el.removeAttribute(WORKING));
    if (workTimer) { clearTimeout(workTimer); workTimer = null; }
    workHold = 0;
  }

  /* ------------------------------------------------------- wide tables */

  /**
   * claude.ai only: widen a reply whose table can't fit the column.
   *
   * claude.ai scrolls such a table sideways inside the column, which under a
   * framed reply is a scrollbar in a window that could simply be wider. The
   * reply grows by however far the widest table's minimum width runs past
   * the column, plus a little breathing room, written to --tema-grow for the
   * theme to spend as negative inline margins, so the window widens evenly
   * and its centre stays on the column. Capped by the room around the column
   * (less a margin each side) and 72rem overall. On chatgpt.com the same job
   * is pure CSS, sized off the container query the thread already declares;
   * claude.ai offers CSS no container to measure that room with.
   *
   * A table that fits the column is never touched or measured. The growth is
   * worked out afresh on every pass from the table's minimum width against
   * the ungrown column, so it shrinks as readily as it grows.
   */
  const GROW_EASE = 64;     // past the table's bare minimum width
  const GROW_MARGIN = 64;   // kept clear of the scroller's edge, each side
  const GROW_MAX = 1152;    // 72rem, the widest a window gets

  // A table's min-content width, measured by laying it out at min-content
  // for one synchronous read (no frame paints in between). Memoised per
  // table until its rows, text or the loaded fonts change: the pass reruns
  // on every scroll tick.
  const tableMins = new WeakMap();
  let fontEpoch = 0;
  const onFonts = () => { fontEpoch++; };

  function tableMinWidth(table) {
    const sig = table.rows.length + ":" + table.textContent.length + ":" + fontEpoch;
    const hit = tableMins.get(table);
    if (hit && hit.sig === sig) return hit.width;
    const saved = table.getAttribute("style");
    table.style.setProperty("width", "min-content", "important");
    table.style.setProperty("min-width", "0", "important");
    table.style.setProperty("max-width", "none", "important");
    const width = table.getBoundingClientRect().width;
    if (saved === null) table.removeAttribute("style");
    else table.setAttribute("style", saved);
    tableMins.set(table, { sig, width });
    return width;
  }

  // How far a table's minimum width runs past the room the UNGROWN window
  // would give it. The room is its scroller's (claude.ai wraps tables in an
  // overflow-x:auto div) or, for a bare table, the window's content box. A
  // table showing no overflow in an ungrown window needs nothing and is not
  // measured at all.
  function tableNeed(table, win, cur) {
    let box = null;
    for (let n = table; n && n !== win; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") { box = n; break; }
      if (ox !== "visible") break;
    }
    let room, over;
    if (box) {
      room = box.clientWidth;
      over = box.scrollWidth - room;
    } else {
      const cs = getComputedStyle(win);
      const r = win.getBoundingClientRect();
      const right = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      room = right - (r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth));
      over = table.getBoundingClientRect().right - right;
    }
    if (cur <= 0 && over <= 1) return 0;
    return tableMinWidth(table) - (room - cur);
  }

  // The widest the window may be: twice the distance from its centre to the
  // nearer inner edge of the first ancestor that would clip it, less the
  // margin. Even growth never moves the centre, so a grown window measures
  // exactly like a fresh one.
  function roomAround(win) {
    let clip = win.parentElement;
    while (clip && clip !== document.documentElement &&
           getComputedStyle(clip).overflowX === "visible") clip = clip.parentElement;
    const box = clip || document.documentElement;
    const left = box.getBoundingClientRect().left + box.clientLeft;
    const right = left + box.clientWidth;
    const r = win.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    return 2 * (Math.min(mid - left, right - mid) - GROW_MARGIN);
  }

  function syncWide() {
    if (SITE !== "claude") return;
    for (const win of document.querySelectorAll("div[data-is-streaming][data-tema-reply]")) {
      const cur = parseFloat(win.style.getPropertyValue(GROW)) || 0;
      let need = 0;
      for (const t of win.querySelectorAll("table")) need = Math.max(need, tableNeed(t, win, cur));
      let grow = 0;
      if (need > 1) {
        const base = win.getBoundingClientRect().width - cur;
        const most = Math.min(roomAround(win), GROW_MAX) - base;
        grow = Math.round(Math.max(0, Math.min(need + GROW_EASE, most)));
      }
      if (grow === Math.round(cur)) continue;
      if (grow > 0) win.style.setProperty(GROW, grow + "px");
      else win.style.removeProperty(GROW);
    }
  }

  function clearWide() {
    for (const el of document.querySelectorAll('[style*="' + GROW + '"]')) {
      el.style.removeProperty(GROW);
    }
  }

  /* ------------------------------------------------------------- icons */

  // claude.ai draws many small icons as Private Use Area characters from its
  // Anthropicons font. CSS cannot select by text, so the glyph's host span
  // is marked with data-tema-icon and a theme can swap in its own art. One
  // entry per adopted icon. (chatgpt.com draws icons as SVG sprite refs and
  // Gemini as named font ligatures, both of which CSS reaches directly.)
  const ICON_GLYPHS = {
    "": "bolt",        // Routines
    "": "hourglass",   // Dispatch
    "": "star",        // Customize sidebar (menu row)
    "": "artifacts",   // Artifacts (sidebar dialog)
    "": "case",        // Customize (sidebar dialog)
  };

  function markIcons(root) {
    if (SITE !== "claude") return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const v = t.nodeValue.trim();
      if (v.length !== 1 || !ICON_GLYPHS[v]) continue;
      const el = t.parentElement;
      if (el && el.dataset.temaIcon !== ICON_GLYPHS[v]) el.dataset.temaIcon = ICON_GLYPHS[v];
    }
  }

  function clearIcons() {
    document.querySelectorAll("[data-tema-icon]").forEach((el) => { delete el.dataset.temaIcon; });
  }

  /* ------------------------------------------------------------ wiring */

  T.useEngine({
    start(ctx) {
      want = new Set(ctx.theme.signals || []);
      if (want.has("icons")) markIcons(document.documentElement);
      if (want.has("wide-tables") && SITE === "claude" && document.fonts) {
        document.fonts.addEventListener("loadingdone", onFonts);
      }
    },
    stop() {
      clearReplies();
      clearWide();
      clearIcons();
      if (document.fonts) document.fonts.removeEventListener("loadingdone", onFonts);
      want = new Set();
    },
    pass() {
      if (want.has("replies") || want.has("working")) markReplies();
      if (want.has("wide-tables")) syncWide();
    },
    added(el) {
      if (want.has("icons")) markIcons(el);
    },
  });
})();
