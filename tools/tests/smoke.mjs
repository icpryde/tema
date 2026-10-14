// Tema — runtime smoke test.
//
//   node tools/tests/smoke.mjs
//
// `node --check` only parses. It cannot see that a function was deleted while
// its call sites remain — which shipped twice as "the party vanished", because
// a ReferenceError inside a pass kills every pass silently.
//
// This actually EXECUTES the content scripts (the engine core, the page
// signals and the Final Fantasy runtime) against stand-in claude.ai,
// chatgpt.com and gemini.google.com pages in a real browser, and fails on any
// thrown error, unhandled rejection or console error. It also drives the
// states that only occur over time: theme off and on, streaming start/stop,
// composer teardown on navigation, resize, and the popup's chocobo buttons.

import { writeFile, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../lib/chrome.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = findChrome();

// Enough of claude.ai's shape for the detectors to have something to chew on.
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>smoke</title>
<script>
  // Storage seed for the dev shim (localStorage-backed): put the theme on this
  // site the way the popup would, before the content scripts load and read it.
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ claude: "final-fantasy" }));
  // file:// has no hostname to recognise, so name the site outright.
  window.__TEMA_TEST_SITE = "claude";

  // Chrome logs an autoplay violation into the extension's error panel the
  // moment an AudioContext is constructed before the page has seen a real
  // user gesture. Synthetic events grant no activation, so across this whole
  // drive — hovers, clicks, everything — the correct construction count is
  // exactly zero. Anything above zero is the warning shipping again.
  window.__audioCtxCount = 0;
  const RealAC = window.AudioContext;
  window.AudioContext = function (...a) { window.__audioCtxCount++; return new RealAC(...a); };
</script>
</head>
<body class="font-ui">
<aside class="dframe-sidebar" aria-label="Sidebar"><div class="dframe-sidebar-body">
  <div class="shrink-0"><div class="contents">
    <button data-row-main-button data-row><span class="df-leading-slot"></span><span>New</span></button>
  </div></div>
  <div class="df-recents-anchor"><div class="group/section">
    <div data-row-key="chat:0"><div><div data-row>
      <a data-row-main-button href="#"><span class="df-leading-slot"></span><span>Chat</span></a>
    </div></div></div>
  </div></div>
</div></aside>

<main class="dframe-content">
  <div role="article" aria-label="Message 1">
    <div class="group group/message-row"><div class="contents">
      <div data-is-streaming="false" class="group relative" id="reply">
        <div class="font-claude-response"><p>Filled reply.</p></div>
        <button class="group/status"><div class="relative h-5 overflow-hidden"><div class="pt-1">
          <svg data-cds="Spark" viewBox="0 0 20 20" width="20" height="20"><path d="M0 0h20v20H0z"/></svg>
        </div></div><span>Thinking</span></button>
      </div>
    </div></div>
  </div>

  <!-- the empty next-turn placeholder -->
  <div role="article" aria-label="Message 2"><div class="contents">
    <div data-is-streaming="false" class="group relative" id="placeholder">
      <div class="font-claude-response"></div>
    </div>
  </div></div>

  <!-- the sprite-strip logo -->
  <div class="w-8 text-accent-brand inline-block overflow-hidden">
    <div class="[&>svg]:block"><svg viewBox="0 0 32 288" width="32" height="288"><path d="M0 0h32v288H0z"/></svg></div>
  </div>

  <div class="sticky bottom-0 z-[5]" id="strip">
    <div><div class="font-normal flex gap-1.5 items-center justify-between" id="banner">
      <span>You've used 75% of your weekly limit</span><button>x</button>
    </div></div>
    <div id="composerWrap"><fieldset><div class="relative">
      <div class="cursor-text flex flex-col">
        <div class="relative"><div data-testid="chat-input" role="textbox">hi</div></div>
      </div>
    </div></fieldset></div>
    <div data-disclaimer="true">disclaimer</div>
  </div>
</main>

<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.join(" ")); realError(...a); };

  // No local chrome stub here: ext-shim.js is the one fake (localStorage-
  // backed, real onChanged events, async like the browser). Smoke once
  // shipped its own stub whose set() swallowed change events; every
  // storage-driven path was untestable against it.
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
  // Exercise the states that only happen over time.
  // How the popup talks to a page: which theme each site wears (sync), and
  // one-shot button presses (local). Same writes, same keys.
  const wear = (sites) => chrome.storage.sync.set({ sites });
  const choco = (variant, dur) => chrome.storage.local.set({ action: {
    theme: "final-fantasy", name: "choco", arg: dur ? { variant, dur } : variant, at: performance.now() } });
  window.__drive = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    await wait(500);                                   // initial passes

    document.getElementById("reply").setAttribute("data-is-streaming", "true");
    await wait(500);                                   // streaming
    document.getElementById("reply").setAttribute("data-is-streaming", "false");
    await wait(500);                                   // finished

    // --- extended-thinking lifecycle, replayed from a live claude.ai capture.
    // While Claude thinks, the streamed reasoning ALREADY sits inside
    // .font-claude-response, collapsed and marked [data-find-omitted]; the
    // visible window is empty. Stamping data-tema-reply off that text is what
    // flickered the moogle (frame + crystal mid-thinking, second moogle below).
    // The answer then lands OUTSIDE the marker, and the settled DOM drops the
    // marker nodes. Assert the stamp fires exactly at the response, not before.
    const think = document.createElement("div");
    think.setAttribute("data-is-streaming", "true");
    think.className = "group relative";
    think.id = "thinker";
    think.innerHTML =
      '<div class="font-claude-response">' +
      '<div><div data-find-omitted>streamed reasoning text, hidden behind the status row</div>' +
      '<div class="overflow-hidden" data-find-omitted></div></div></div>' +
      '<button class="group/status"><span>Honing</span></button>';
    document.getElementById("reply").parentElement.append(think);
    await wait(600);                                   // marker passes run
    if (think.hasAttribute("data-tema-reply")) {
      window.__errors.push("thinking-phase wrapper was stamped data-tema-reply — " +
        "the frame/crystal would appear mid-thinking and the moogle would flicker");
    }

    // Response begins: first real text lands outside the marker.
    const answer = document.createElement("p");
    answer.textContent = "The answer.";
    think.querySelector(".font-claude-response").append(answer);
    await wait(600);
    if (!think.hasAttribute("data-tema-reply")) {
      window.__errors.push("response text did not stamp data-tema-reply — replies would never get their window");
    }

    // Settled: Claude removes the marker nodes; the stamp must survive.
    think.querySelectorAll("[data-find-omitted]").forEach((n) => n.remove());
    think.setAttribute("data-is-streaming", "false");
    await wait(600);
    if (!think.hasAttribute("data-tema-reply")) {
      window.__errors.push("stamp was lost when the thinking nodes were removed after settling");
    }

    // --- chocobo drive-bys, forced through the test/preview hook with short
    // durations. Variant A must knock the party over and stand them back up;
    // B/C must mount their clip wrapper inside the composer and clean up.
    choco("a", 900);
    // The trips happen inside the crossing segment, which sits in the middle
    // of the parkour route — sample late enough to be sure it has started.
    await wait(750);
    if (!document.querySelector(".ff-choco-a")) {
      window.__errors.push("choco A: box bird not on the page mid-run");
    }
    if (!document.querySelector(".ff-choco-sky")) {
      window.__errors.push("choco A: sky bird not mounted on <body> — the ground segments would be clipped away");
    }
    if (![...document.querySelectorAll(".ff-party-member")].some((m) => m.dataset.pose === "fall")) {
      window.__errors.push("choco A: no party member fell as the bird passed");
    }
    await wait(2100);
    if (document.querySelector(".ff-choco, .ff-choco-sky")) {
      window.__errors.push("choco A: sprite still present after the run ended");
    }
    if ([...document.querySelectorAll(".ff-party-member")].some((m) => m.dataset.pose !== "idle")) {
      window.__errors.push("choco A: party did not stand back up");
    }

    choco("b", 600);
    await wait(300);
    const clip = document.querySelector(".ff-choco-clip");
    if (!clip || !clip.closest('div[class*="cursor-text"]')) {
      window.__errors.push("choco B: clip wrapper not mounted inside the composer");
    } else if (!(parseInt(clip.querySelector(".ff-choco").style.getPropertyValue("--choco-dist")) > 0)) {
      window.__errors.push("choco B: travel distance was not measured");
    }
    await wait(700);
    choco("c");                                         // default duration
    await wait(250);
    if (!document.querySelector(".ff-choco-c")) {
      window.__errors.push("choco C: sprite not on the page mid-run");
    }
    // C got the default 4.2s duration; abort it the way switching the theme
    // off would, and confirm nothing is left behind.
    wear({ claude: null });
    await wait(300);
    if (document.querySelector(".ff-choco, .ff-choco-clip")) {
      window.__errors.push("choco C: abort on theme off left the sprite behind");
    }
    wear({ claude: "final-fantasy" });
    await wait(400);

    dispatchEvent(new Event("resize"));                // viewport change
    dispatchEvent(new Event("scroll"));
    await wait(400);

    document.getElementById("composerWrap").remove();  // navigation teardown
    await wait(500);

    // --- the Code tab: same machinery, different shell. The epitaxy prompt
    // appears (as if the user opened claude.ai/code) and the party and the
    // chocobo must adopt it as their stage.
    const code = document.createElement("div");
    code.className = "epitaxy-root";
    code.innerHTML = '<div class="epitaxy-composer-width" style="position:relative">' +
      '<div class="chips-decoy" style="width:600px;height:28px">Default · repo · main</div>' +
      '<div class="epitaxy-prompt" style="position:relative;width:600px;height:60px">' +
      '<div class="tiptap" contenteditable="true"></div></div></div>';
    document.body.append(code);
    await wait(600);   // party debounce
    if (!document.querySelector(".epitaxy-prompt .ff-party")) {
      window.__errors.push("code tab: party did not mount on the epitaxy prompt");
    }
    // The chip row sits exactly where the Home banner-hunter looks. It must
    // never be styled: on the code tab the hunt stands down entirely.
    const decoy = code.querySelector(".chips-decoy");
    if (decoy.getAttribute("style") !== "width:600px;height:28px") {
      window.__errors.push("code tab: the banner hunter styled the chip row -> " +
        decoy.getAttribute("style"));
    }
    choco("b", 500);
    await wait(250);
    if (!document.querySelector(".epitaxy-prompt .ff-choco-clip")) {
      window.__errors.push("code tab: chocobo clip run did not mount inside the epitaxy prompt");
    }
    await wait(600);
    code.remove();
    await wait(500);

    // A theme id this build doesn't have (removed, renamed) reads as no theme.
    wear({ claude: "no-such-theme" });
    await wait(400);
    if (root.hasAttribute("data-tema")) {
      window.__errors.push("an unknown theme id was stamped on <html> (" + root.getAttribute("data-tema") + ")");
    }
    if (document.querySelector(".ff-party")) {
      window.__errors.push("party left behind after the theme went off");
    }
    wear({ claude: null });                          // no theme
    await wait(400);
    wear({ claude: "final-fantasy" });
    await wait(400);
    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("switching back to final-fantasy did not restore the attribute");
    }

    // --- options. Unset options take their theme.json defaults (menu sounds
    // and scenery on, colourful text off); a stored value wins.
    if (root.getAttribute("data-tema-opt") !== "menu-sounds bottom-scenery") {
      window.__errors.push("default options were not stamped (got: " + root.getAttribute("data-tema-opt") + ")");
    }
    chrome.storage.sync.set({ options: { "final-fantasy": { "rich-text": true, "bottom-scenery": false } } });
    await wait(400);
    if (root.getAttribute("data-tema-opt") !== "rich-text menu-sounds") {
      window.__errors.push("stored option values did not reach data-tema-opt (got: " +
        root.getAttribute("data-tema-opt") + ")");
    }

    // --- menu sounds. The sound files cannot be fetched from file://; the
    // point is that the whole chain (option -> hover and click handlers ->
    // loader failure) runs without a single throw.
    const target = document.querySelector("button[data-row-main-button]");
    for (let i = 0; i < 3; i++) {
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      await wait(60);
    }
    target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    target.click();
    await wait(400);   // loader promise settles (fetch fails on file://) — must not reject unhandled

    // Icon-glyph adoption: a menu portals in with an Anthropicons PUA glyph;
    // the marker must stamp its host span.
    const fakeMenu = document.createElement("div");
    fakeMenu.setAttribute("role", "menu");
    fakeMenu.innerHTML = "<button role=menuitem><span>\uE098</span><span>Routines</span></button>";
    document.body.append(fakeMenu);
    await wait(250);
    const glyphHost = fakeMenu.querySelector("span");
    if (glyphHost.dataset.temaIcon !== "bolt") {
      window.__errors.push("icon glyph U+E098 was not marked as bolt (got: " +
        glyphHost.dataset.temaIcon + ")");
    }
    fakeMenu.remove();

    if (window.__audioCtxCount !== 0) {
      window.__errors.push("an AudioContext was constructed without user activation (" +
        window.__audioCtxCount + "x) — Chrome logs the autoplay violation into the error panel");
    }
    if (!navigator.userActivation) {
      window.__errors.push("navigator.userActivation missing — the gesture gate would never open");
    }

    return window.__errors;
  };
  window.__drive().then((errs) => {
    document.title = "SMOKE:" + (errs.length ? errs.join(" | ") : "clean");
  });
</script>
</body>
</html>`;

// The same machinery against chatgpt.com's shape. The hostname can't be faked
// under file://, so the site override global routes the scripts down the
// chatgpt branches; everything else — engine shim, storage, observers — is
// identical to the real page.
const GPT_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>smoke-gpt</title>
<script>
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ chatgpt: "final-fantasy" }));
  window.__TEMA_TEST_SITE = "chatgpt";
  window.__audioCtxCount = 0;
  const RealAC = window.AudioContext;
  window.AudioContext = function (...a) { window.__audioCtxCount++; return new RealAC(...a); };
</script>
</head>
<body>
<div id="stage-slideover-sidebar"><nav aria-label="Chat history">
  <a class="__menu-item" data-testid="create-new-chat-button" href="#"><div class="icon"><svg></svg></div>New chat</a>
</nav></div>

<main>
  <section data-testid="conversation-turn-1" data-turn="user" id="uturn">
    <div data-message-author-role="user"><div class="user-message-bubble-color">hello there</div></div>
  </section>
  <section data-testid="conversation-turn-2" data-turn="assistant" id="aturn">
    <div data-message-author-role="assistant"><div class="markdown prose"><p>A filled reply.</p></div></div>
    <button data-testid="copy-turn-action-button"></button>
  </section>

  <div id="footer">
    <!-- shaped like a usage banner; the hunter must NEVER touch it on gpt -->
    <div id="gpt-decoy" style="width:600px;height:24px">You have 3 messages left today</div>
    <form data-type="unified-composer" style="position:relative;width:640px">
      <div class="relative">
        <div data-composer-surface="true" style="position:relative;height:52px">
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
        </div>
      </div>
    </form>
  </div>
</main>

<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.join(" ")); realError(...a); };
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
  // How the popup talks to a page: which theme each site wears (sync), and
  // one-shot button presses (local). Same writes, same keys.
  const wear = (sites) => chrome.storage.sync.set({ sites });
  const choco = (variant, dur) => chrome.storage.local.set({ action: {
    theme: "final-fantasy", name: "choco", arg: dur ? { variant, dur } : variant, at: performance.now() } });
  window.__drive = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    await wait(500);

    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("gpt: sites.chatgpt did not reach the html attribute");
    }
    if (!document.querySelector("form[data-type='unified-composer'] > .ff-party")) {
      window.__errors.push("gpt: party did not mount on the composer form");
    }
    if (!document.getElementById("aturn").hasAttribute("data-tema-reply")) {
      window.__errors.push("gpt: filled assistant turn was not stamped data-tema-reply");
    }
    if (document.getElementById("uturn").hasAttribute("data-tema-reply")) {
      window.__errors.push("gpt: USER turn was stamped data-tema-reply");
    }
    if (!document.getElementById("aturn").hasAttribute("data-tema-latest")) {
      window.__errors.push("gpt: newest reply was not stamped data-tema-latest");
    }

    // Thinking lifecycle: while .result-thinking is on the body the turn must
    // stay unstamped (the frame would wrap an empty window); the stamp lands
    // when the class drops and real text exists.
    const think = document.createElement("section");
    think.setAttribute("data-turn", "assistant");
    think.setAttribute("data-testid", "conversation-turn-3");
    think.innerHTML = "<div data-message-author-role='assistant'>" +
      "<div class='markdown prose result-thinking'><p></p></div></div>";
    document.getElementById("aturn").after(think);
    await wait(600);
    if (think.hasAttribute("data-tema-reply")) {
      window.__errors.push("gpt: thinking turn was stamped data-tema-reply mid-thinking");
    }
    // No stop button, no streaming class — the turn shell alone must carry
    // the working stamp. Losing it mid-think is the "Mog blinks out" bug.
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gpt: thinking turn (no stop button present) was not stamped data-tema-working");
    }
    if (document.getElementById("aturn").hasAttribute("data-tema-working")) {
      window.__errors.push("gpt: a settled turn (action row mounted) was stamped data-tema-working");
    }
    const md = think.querySelector(".markdown");
    md.classList.remove("result-thinking");
    md.querySelector("p").textContent = "The answer arrives.";
    await wait(600);
    if (!think.hasAttribute("data-tema-reply")) {
      window.__errors.push("gpt: settled turn was never stamped data-tema-reply");
    }
    if (!think.hasAttribute("data-tema-latest")) {
      window.__errors.push("gpt: latest tag did not move to the newest reply");
    }
    // Text has landed but the action row hasn't — every mode has a stretch
    // shaped exactly like this (reasoning headers, search progress, plain
    // streaming), and Mog must stay through all of it.
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gpt: working stamp dropped between thinking and the action row — Mog would vanish mid-run");
    }
    const actions = document.createElement("button");
    actions.setAttribute("data-testid", "copy-turn-action-button");
    think.append(actions);
    // The hysteresis hold (1.5s) is expected to keep the stamp briefly; the
    // failure mode is it surviving PAST the hold.
    await wait(2100);
    if (document.querySelector("[data-tema-working]")) {
      window.__errors.push("gpt: working stamp survived the action row mounting past the hold — Mog would hop forever");
    }

    // The Pro build PRE-mounts the action row with the turn shell, so its
    // presence alone must not read as settled: with the row mounted, an
    // in-flight class (streaming here) must still stamp the turn.
    // Class flips ride along with text churn in a real stream (the observer
    // is childList-driven), so the fixture streams a token with each flip.
    think.querySelector(".markdown").classList.add("streaming-animation");
    think.querySelector(".markdown p").append(" more tokens");
    await wait(600);
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gpt: streaming turn with a pre-mounted action row was not stamped — Mog gone on the Pro build");
    }
    think.querySelector(".markdown").classList.remove("streaming-animation");
    think.querySelector(".markdown p").append(" done.");
    // Inside the hold window the stamp MUST still be there — that is the
    // whole point of the hysteresis (phase hand-offs with no signal).
    await wait(500);
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gpt: stamp dropped instantly in a signal gap — the hysteresis is not holding");
    }
    await wait(1800);
    if (document.querySelector("[data-tema-working]")) {
      window.__errors.push("gpt: working stamp stuck after streaming class removal past the hold");
    }

    // Chocobo parkour: sky bird on <body>, box bird on the form, party trips.
    choco("a", 900);
    await wait(750);
    if (!document.querySelector("form[data-type='unified-composer'] .ff-choco-a")) {
      window.__errors.push("gpt choco A: box bird not mounted on the composer form");
    }
    if (!document.querySelector("body > .ff-choco-sky")) {
      window.__errors.push("gpt choco A: sky bird not mounted on body");
    }
    if (![...document.querySelectorAll(".ff-party-member")].some((m) => m.dataset.pose === "fall")) {
      window.__errors.push("gpt choco A: no party member fell");
    }
    await wait(2100);
    if (document.querySelector(".ff-choco, .ff-choco-sky")) {
      window.__errors.push("gpt choco A: sprite left behind after the run");
    }

    // Variant B must clip inside the composer SURFACE (where the paint lives),
    // not the form — a form-level clip would hide behind the surface fill.
    choco("b", 600);
    await wait(300);
    const clip = document.querySelector(".ff-choco-clip");
    if (!clip || !clip.parentElement.hasAttribute("data-composer-surface")) {
      window.__errors.push("gpt choco B: clip wrapper not mounted on [data-composer-surface]");
    }
    await wait(800);

    // The banner hunter stands down on chatgpt: the decoy keeps its exact
    // inline style through every pass.
    const decoy = document.getElementById("gpt-decoy");
    if (decoy.getAttribute("style") !== "width:600px;height:24px") {
      window.__errors.push("gpt: banner hunter styled the decoy -> " + decoy.getAttribute("style"));
    }

    // Anthropicons adoption is claude-only; the glyph must NOT be marked here.
    const fakeMenu = document.createElement("div");
    fakeMenu.setAttribute("role", "menu");
    fakeMenu.innerHTML = "<button role=menuitem><span></span><span>Routines</span></button>";
    document.body.append(fakeMenu);
    await wait(250);
    if (fakeMenu.querySelector("span").dataset.temaIcon) {
      window.__errors.push("gpt: PUA glyph was marked on chatgpt (claude-only mechanism)");
    }
    fakeMenu.remove();

    // Theme off and back on through this site's entry.
    wear({ chatgpt: null });
    await wait(400);
    if (root.getAttribute("data-tema")) {
      window.__errors.push("gpt: clearing sites.chatgpt did not clear the attribute");
    }
    if (document.querySelector(".ff-party")) {
      window.__errors.push("gpt: party left behind after the theme was cleared");
    }
    wear({ chatgpt: "final-fantasy" });
    await wait(500);
    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("gpt: switching back did not restore the attribute");
    }
    // Another site's entry must mean nothing here.
    wear({ claude: null, chatgpt: "final-fantasy", gemini: null });
    await wait(300);
    if (root.getAttribute("data-tema") !== "final-fantasy" || !document.querySelector(".ff-party")) {
      window.__errors.push("gpt: a write to the other sites changed the chatgpt tab's theme");
    }

    if (window.__audioCtxCount !== 0) {
      window.__errors.push("gpt: AudioContext constructed without user activation (" +
        window.__audioCtxCount + "x)");
    }
    return window.__errors;
  };
  window.__drive().then((errs) => {
    document.title = "SMOKE:" + (errs.length ? errs.join(" | ") : "clean");
  });
</script>
</body>
</html>`;

// chatgpt.com's 2026-09 "app shell" rebuild, probed live 2026-09-27: no
// data-testids anywhere, a turn is div[data-turn-key] holding the user unit
// AND the assistant unit, the reply body is [data-markdown-text-style], and
// the composer is form[data-chatgpt-composer] with the above-composer portal
// at its top and the visual box ([data-composer-surface-variant]) below it.
// The lifecycle below replays the live run the recorder captured: status row
// (aria-busy) -> body streaming (data-markdown-animated) -> action row.
const GPT_SHELL_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>smoke-gpt-shell</title>
<script>
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ chatgpt: "final-fantasy" }));
  window.__TEMA_TEST_SITE = "chatgpt";
  window.__audioCtxCount = 0;
  const RealAC = window.AudioContext;
  window.AudioContext = function (...a) { window.__audioCtxCount++; return new RealAC(...a); };
</script>
</head>
<body>
<aside class="app-shell-left-panel"><div id="app-shell-sidebar">
  <nav role="navigation" aria-label="Chat history">
    <div class="header"><div data-appearance="plain"><div>
      <button type="button" class="sidebar-item"><div><span class="icon-leading-slot"><svg></svg></span><span>New chat</span></div></button>
    </div></div></div>
    <div data-app-action-sidebar-scroll><div data-appearance="plain">
      <button type="button" class="sidebar-item" data-sidebar-destination="builtin:library"><div><span class="icon-leading-slot"><svg></svg></span><span>Library</span></div></button>
    </div></div>
  </nav>
</div></aside>

<main data-app-shell-main-surface="browser">
  <div class="thread-scroll-container"><div data-chatgpt-conversation-selection-target="true"><div id="turns">
    <div data-turn-key="t1" id="turn1"><div data-content-search-turn-key="fallback-turn-0">
      <div class="contents"><div class="contents"><div class="group flex flex-col">
        <div class="flex flex-col">
          <div class="block">
            <div class="group/user-message" data-chatgpt-search-unit-key="fallback-turn-0:0:user" id="uunit1">
              <div data-user-message-bubble="true">hello there</div>
              <div class="flex turn-action-controls"><button type="button" aria-label="Copy message"></button></div>
              <!-- an inline edit composer, EARLIER in the DOM than the thread one -->
              <form data-chatgpt-composer data-composer-placement="edit" id="editform">
                <div id="editstage"><div data-composer-surface-variant="inline"><div class="ProseMirror" contenteditable="true"></div></div></div>
              </form>
            </div>
          </div>
          <div class="block">
            <span hidden data-chatgpt-agent-turn-start></span>
            <div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" id="aunit1">
              <h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>
              <div class="group flex min-w-0 flex-col"><div data-markdown-text-style="assistant-message"><p>A filled reply.</p></div></div>
            </div>
          </div>
        </div>
        <div class="flex turn-action-controls"><div><button type="button" aria-label="Copy"></button></div></div>
      </div></div></div>
    </div></div>
  </div></div></div>

  <div data-thread-scroll-footer="true"><div data-pip-obstacle="thread-footer">
    <form data-chatgpt-composer data-composer-placement="thread" id="composer" style="position:relative;width:640px">
      <div data-above-composer-portal="true" id="portal"></div>
      <div class="relative w-full flex-col gap-2 flex" id="stage" style="position:relative">
        <div class="ComposerModeSurface">
          <div class="ComposerLayoutRoot" data-composer-surface-variant="default" style="position:relative;height:52px">
            <div data-composer-body><div class="ProseMirror" contenteditable="true" data-composer-markdown aria-label="Ask ChatGPT"></div></div>
            <button type="button" aria-label="Start Voice"></button>
          </div>
        </div>
      </div>
    </form>
  </div></div>
</main>

<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.join(" ")); realError(...a); };
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
  // How the popup talks to a page: which theme each site wears (sync), and
  // one-shot button presses (local). Same writes, same keys.
  const wear = (sites) => chrome.storage.sync.set({ sites });
  const choco = (variant, dur) => chrome.storage.local.set({ action: {
    theme: "final-fantasy", name: "choco", arg: dur ? { variant, dur } : variant, at: performance.now() } });
  window.__drive = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    const $ = (id) => document.getElementById(id);
    await wait(500);

    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("shell: sites.chatgpt did not reach the html attribute");
    }
    // The stage is the form child around the surface: standing on the form
    // itself would put the party on top of whatever the portal shows.
    if (!document.querySelector("#stage > .ff-party")) {
      window.__errors.push("shell: party did not mount on the composer stage (the form child around the surface)");
    }
    if (document.querySelector("#editform .ff-party, #composer > .ff-party")) {
      window.__errors.push("shell: party mounted on the edit composer or the bare form");
    }
    if (!$("aunit1").hasAttribute("data-tema-reply")) {
      window.__errors.push("shell: filled assistant unit was not stamped data-tema-reply");
    }
    if ($("uunit1").hasAttribute("data-tema-reply")) {
      window.__errors.push("shell: USER unit was stamped data-tema-reply");
    }
    if (!$("aunit1").hasAttribute("data-tema-latest")) {
      window.__errors.push("shell: newest reply was not stamped data-tema-latest");
    }
    if ($("turn1").hasAttribute("data-tema-working")) {
      window.__errors.push("shell: a settled turn (action row mounted) was stamped data-tema-working");
    }

    // A new prompt: the turn mounts with the user unit and a status row, the
    // send slot turns into Stop. The user bubble's own hover row shares the
    // action row's class and must NOT read as settled.
    const turn = document.createElement("div");
    turn.setAttribute("data-turn-key", "t2");
    turn.innerHTML = "<div data-content-search-turn-key='fallback-turn-1'>" +
      "<div class='contents'><div class='contents'><div class='group flex flex-col'><div class='flex flex-col'>" +
      "<div class='block'><div class='group/user-message' data-chatgpt-search-unit-key='fallback-turn-1:0:user'>" +
      "<div data-user-message-bubble='true'>next question</div>" +
      "<div class='flex turn-action-controls'><button type='button' aria-label='Copy message'></button></div>" +
      "</div></div></div></div></div></div>" +
      "<div class='min-w-0' id='status'><span aria-busy='true' role='status'><span class='sr-only'>ChatGPT is responding</span>" +
      "<span class='pulsing-dot'></span></span></div></div>";
    $("turns").append(turn);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.setAttribute("aria-label", "Stop");
    $("composer").querySelector("[data-composer-surface-variant]").append(stop);
    await wait(600);
    if (!turn.hasAttribute("data-tema-working")) {
      window.__errors.push("shell: a turn showing only its status row was not stamped data-tema-working");
    }
    if ($("turn1").hasAttribute("data-tema-working")) {
      window.__errors.push("shell: the working stamp stayed on the previous turn");
    }
    if (turn.querySelector("[data-tema-reply]")) {
      window.__errors.push("shell: a reply stamp landed before any reply body existed");
    }

    // The body mounts streaming.
    turn.querySelector("#status").remove();
    const col = turn.querySelector(".flex.flex-col .flex.flex-col");
    const block = document.createElement("div");
    block.className = "block";
    block.innerHTML = "<span hidden data-chatgpt-agent-turn-start></span>" +
      "<div data-chatgpt-search-unit-key='fallback-turn-1:2:assistant' id='aunit2'>" +
      "<h4 class='sr-only' data-conversation-role='assistant'>ChatGPT said:</h4>" +
      "<div class='group flex min-w-0 flex-col'><div data-markdown-text-style='assistant-message' data-markdown-animated>" +
      "<p>The answer arrives.</p></div></div></div>";
    col.append(block);
    await wait(600);
    const unit2 = $("aunit2");
    if (!unit2.hasAttribute("data-tema-reply")) {
      window.__errors.push("shell: the streaming reply unit was never stamped data-tema-reply");
    }
    if (!unit2.hasAttribute("data-tema-latest") || $("aunit1").hasAttribute("data-tema-latest")) {
      window.__errors.push("shell: latest tag did not move to the newest reply");
    }
    if (!turn.hasAttribute("data-tema-working")) {
      window.__errors.push("shell: working stamp dropped while the body streamed — Mog would vanish mid-run");
    }

    // Settle: the body stops animating, Stop goes back to Send, the action
    // row mounts. The hold keeps the stamp briefly; past it, it must clear.
    unit2.querySelector("[data-markdown-text-style]").removeAttribute("data-markdown-animated");
    stop.remove();
    const row = document.createElement("div");
    row.className = "flex turn-action-controls";
    row.innerHTML = "<div><button type='button' aria-label='Copy'></button></div>";
    turn.querySelector(".group.flex.flex-col").append(row);
    await wait(2100);
    if (document.querySelector("[data-tema-working]")) {
      window.__errors.push("shell: working stamp survived the action row mounting past the hold — Mog would hop forever");
    }

    // The Stop button alone still reads as a run (a turn can pre-mount its
    // row), and the hold rides out a gap between signals.
    $("composer").querySelector("[data-composer-surface-variant]").append(stop);
    unit2.querySelector("p").append(" more tokens");
    await wait(600);
    if (!turn.hasAttribute("data-tema-working")) {
      window.__errors.push("shell: the Stop button alone did not stamp the newest turn");
    }
    stop.remove();
    unit2.querySelector("p").append(" done.");
    await wait(500);
    if (!turn.hasAttribute("data-tema-working")) {
      window.__errors.push("shell: stamp dropped instantly in a signal gap — the hysteresis is not holding");
    }
    await wait(1800);
    if (document.querySelector("[data-tema-working]")) {
      window.__errors.push("shell: working stamp stuck after the Stop button left, past the hold");
    }

    // Chocobo parkour: sky bird on <body>, box bird on the stage, party trips.
    choco("a", 900);
    await wait(750);
    if (!document.querySelector("#stage .ff-choco-a")) {
      window.__errors.push("shell choco A: box bird not mounted on the composer stage");
    }
    if (!document.querySelector("body > .ff-choco-sky")) {
      window.__errors.push("shell choco A: sky bird not mounted on body");
    }
    if (![...document.querySelectorAll(".ff-party-member")].some((m) => m.dataset.pose === "fall")) {
      window.__errors.push("shell choco A: no party member fell");
    }
    await wait(2100);
    if (document.querySelector(".ff-choco, .ff-choco-sky")) {
      window.__errors.push("shell choco A: sprite left behind after the run");
    }

    // Variant B clips inside the SURFACE, where the window paint lives.
    choco("b", 600);
    await wait(300);
    const clip = document.querySelector(".ff-choco-clip");
    if (!clip || !clip.parentElement.hasAttribute("data-composer-surface-variant")) {
      window.__errors.push("shell choco B: clip wrapper not mounted on [data-composer-surface-variant]");
    }
    await wait(800);

    // Theme off and back on through the gpt slot.
    wear({ chatgpt: null });
    await wait(400);
    if (root.getAttribute("data-tema")) {
      window.__errors.push("shell: clearing sites.chatgpt did not clear the attribute");
    }
    if (document.querySelector(".ff-party, [data-tema-reply], [data-tema-latest], [data-tema-working]")) {
      window.__errors.push("shell: party or stamps left behind after the theme was cleared");
    }
    wear({ chatgpt: "final-fantasy" });
    await wait(500);
    if (root.getAttribute("data-tema") !== "final-fantasy" || !document.querySelector("#stage > .ff-party")) {
      window.__errors.push("shell: switching back did not restore the theme and the party");
    }

    if (window.__audioCtxCount !== 0) {
      window.__errors.push("shell: AudioContext constructed without user activation (" +
        window.__audioCtxCount + "x)");
    }
    return window.__errors;
  };
  window.__drive().then((errs) => {
    document.title = "SMOKE:" + (errs.length ? errs.join(" | ") : "clean");
  });
</script>
</body>
</html>`;

// The same machinery against gemini.google.com's shape (the signed-in Pro
// build, 2026-08-11). Angular custom elements throughout; the composer pill
// is fieldset.input-area-container, turns are .conversation-container with
// <user-query> and <model-response>, thinking rides .thoughts-container and
// the skeleton/thinking-banner loaders.
const GEMINI_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>smoke-gemini</title>
<script>
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ gemini: "final-fantasy" }));
  window.__TEMA_TEST_SITE = "gemini";
  window.__audioCtxCount = 0;
  const RealAC = window.AudioContext;
  window.AudioContext = function (...a) { window.__audioCtxCount++; return new RealAC(...a); };
</script>
</head>
<body class="dark-theme">
<bard-sidenav><side-navigation-content>
  <gem-nav-list-item><a href="/app"><mat-icon></mat-icon>New chat</a></gem-nav-list-item>
</side-navigation-content></bard-sidenav>

<main>
  <div id="chat-history"><infinite-scroller data-test-id="chat-history-container">
    <div class="conversation-container">
      <user-query id="uturn"><span class="user-query-bubble-with-background">hello there</span></user-query>
      <model-response id="aturn"><div class="response-container">
        <div class="response-container-content"><message-content><div class="markdown"><p>A filled reply.</p></div></message-content></div>
      </div><message-actions><button aria-label="Copy"></button></message-actions></model-response>
    </div>
  </infinite-scroller></div>

  <div id="footer">
    <!-- shaped like a usage banner; the hunter must NEVER touch it on gemini -->
    <div id="gem-decoy" style="width:600px;height:24px">You have 3 messages left today</div>
    <input-container><fieldset class="input-area-container" style="position:relative;width:640px;height:52px">
      <input-area-v2><div class="input-area">
        <rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>
      </div></input-area-v2>
    </fieldset></input-container>
  </div>
</main>

<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.join(" ")); realError(...a); };
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
  // How the popup talks to a page: which theme each site wears (sync), and
  // one-shot button presses (local). Same writes, same keys.
  const wear = (sites) => chrome.storage.sync.set({ sites });
  const choco = (variant, dur) => chrome.storage.local.set({ action: {
    theme: "final-fantasy", name: "choco", arg: dur ? { variant, dur } : variant, at: performance.now() } });
  window.__drive = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const root = document.documentElement;
    await wait(500);

    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("gemini: sites.gemini did not reach the html attribute");
    }
    if (!document.querySelector("fieldset.input-area-container > .ff-party")) {
      window.__errors.push("gemini: party did not mount on the composer pill");
    }
    if (!document.getElementById("aturn").hasAttribute("data-tema-reply")) {
      window.__errors.push("gemini: filled reply was not stamped data-tema-reply");
    }
    if (document.getElementById("uturn").hasAttribute("data-tema-reply")) {
      window.__errors.push("gemini: USER query was stamped data-tema-reply");
    }
    if (!document.getElementById("aturn").hasAttribute("data-tema-latest")) {
      window.__errors.push("gemini: newest reply was not stamped data-tema-latest");
    }

    // Thinking lifecycle: reasoning streams into .thoughts-container while the
    // visible body is still empty — the reply must stay unstamped (no empty
    // framed window, no crystal) but MUST carry the working stamp so Mog hops.
    const conv = document.createElement("div");
    conv.className = "conversation-container";
    conv.innerHTML = "<user-query><span class='user-query-bubble-with-background'>q2</span></user-query>" +
      "<model-response id='thinker'><div class='response-container'>" +
      "<div class='response-container-content'>" +
      "<model-thoughts><div class='thoughts-container'><div class='thoughts-content'>streamed reasoning…</div></div></model-thoughts>" +
      "<div class='skeleton-loader-container in-progress'></div>" +
      "<message-content><div class='markdown'></div></message-content>" +
      "</div></div></model-response>";
    document.querySelector("infinite-scroller").append(conv);
    await wait(600);
    const think = document.getElementById("thinker");
    if (think.hasAttribute("data-tema-reply")) {
      window.__errors.push("gemini: thoughts-only reply was stamped data-tema-reply mid-thinking");
    }
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gemini: thinking reply (skeleton mounted, no actions row) was not stamped data-tema-working");
    }
    if (document.getElementById("aturn").hasAttribute("data-tema-working")) {
      window.__errors.push("gemini: a settled reply (actions mounted) was stamped data-tema-working");
    }

    // The answer lands; loaders unmount; the stamp must flip to reply/latest
    // while working holds until the actions row mounts.
    think.querySelector(".skeleton-loader-container").remove();
    think.querySelector(".markdown").innerHTML = "<p>The answer arrives.</p>";
    await wait(600);
    if (!think.hasAttribute("data-tema-reply")) {
      window.__errors.push("gemini: answered reply was never stamped data-tema-reply");
    }
    if (!think.hasAttribute("data-tema-latest")) {
      window.__errors.push("gemini: latest tag did not move to the newest reply");
    }
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gemini: working stamp dropped between thinking and the actions row — Mog would vanish mid-run");
    }
    const actions = document.createElement("message-actions");
    actions.innerHTML = "<button aria-label='Copy'></button>";
    think.append(actions);
    await wait(2100);
    if (document.querySelector("[data-tema-working]")) {
      window.__errors.push("gemini: working stamp survived the actions row mounting past the hold — Mog would hop forever");
    }

    // Signal-gap hysteresis: a shimmer flips on and off; the stamp must ride
    // through the gap and clear only past the hold.
    think.querySelector(".markdown").classList.add("gem-shimmer-active");
    think.querySelector(".markdown p").append(" more tokens");
    await wait(600);
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gemini: shimmering reply with a mounted actions row was not stamped working");
    }
    think.querySelector(".markdown").classList.remove("gem-shimmer-active");
    think.querySelector(".markdown p").append(" done.");
    await wait(500);
    if (!think.hasAttribute("data-tema-working")) {
      window.__errors.push("gemini: stamp dropped instantly in a signal gap — the hysteresis is not holding");
    }
    await wait(1800);
    if (document.querySelector("[data-tema-working]")) {
      window.__errors.push("gemini: working stamp stuck after the shimmer cleared past the hold");
    }

    // Chocobo parkour: sky bird on <body>, box bird on the pill, party trips.
    choco("a", 900);
    await wait(750);
    if (!document.querySelector("fieldset.input-area-container .ff-choco-a")) {
      window.__errors.push("gemini choco A: box bird not mounted on the composer pill");
    }
    if (!document.querySelector("body > .ff-choco-sky")) {
      window.__errors.push("gemini choco A: sky bird not mounted on body");
    }
    if (![...document.querySelectorAll(".ff-party-member")].some((m) => m.dataset.pose === "fall")) {
      window.__errors.push("gemini choco A: no party member fell");
    }
    await wait(2100);
    if (document.querySelector(".ff-choco, .ff-choco-sky")) {
      window.__errors.push("gemini choco A: sprite left behind after the run");
    }

    // Variant B clips inside the pill itself — that is where the paint lives.
    choco("b", 600);
    await wait(300);
    const clip = document.querySelector(".ff-choco-clip");
    if (!clip || !clip.parentElement.classList.contains("input-area-container")) {
      window.__errors.push("gemini choco B: clip wrapper not mounted on the composer pill");
    }
    await wait(800);

    // The banner hunter stands down on gemini: the decoy keeps its style.
    const decoy = document.getElementById("gem-decoy");
    if (decoy.getAttribute("style") !== "width:600px;height:24px") {
      window.__errors.push("gemini: banner hunter styled the decoy -> " + decoy.getAttribute("style"));
    }

    // Anthropicons adoption is claude-only; the glyph must NOT be marked here.
    const fakeMenu = document.createElement("div");
    fakeMenu.setAttribute("role", "menu");
    fakeMenu.innerHTML = "<button role=menuitem><span></span><span>Routines</span></button>";
    document.body.append(fakeMenu);
    await wait(250);
    if (fakeMenu.querySelector("span").dataset.temaIcon) {
      window.__errors.push("gemini: PUA glyph was marked on gemini (claude-only mechanism)");
    }
    fakeMenu.remove();

    // Theme off and back on through this site's entry; others mean nothing.
    wear({ gemini: null });
    await wait(400);
    if (root.getAttribute("data-tema")) {
      window.__errors.push("gemini: clearing sites.gemini did not clear the attribute");
    }
    if (document.querySelector(".ff-party")) {
      window.__errors.push("gemini: party left behind after the theme was cleared");
    }
    wear({ gemini: "final-fantasy" });
    await wait(500);
    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("gemini: switching back did not restore the attribute");
    }
    wear({ claude: null, chatgpt: "final-fantasy", gemini: "final-fantasy" });
    await wait(300);
    if (root.getAttribute("data-tema") !== "final-fantasy") {
      window.__errors.push("gemini: a write to the other sites changed the gemini tab's theme");
    }

    if (window.__audioCtxCount !== 0) {
      window.__errors.push("gemini: AudioContext constructed without user activation (" +
        window.__audioCtxCount + "x)");
    }
    return window.__errors;
  };
  window.__drive().then((errs) => {
    document.title = "SMOKE:" + (errs.length ? errs.join(" | ") : "clean");
  });
</script>
</body>
</html>`;


// The Gemini 4 build (2026-10): .input-area-container is a DIV now, not a
// fieldset, and in zero state it also holds the Chat/Task toggle. The paint
// sweep that turns Gemini's scroll fades into night sky exempted our own
// window by the old tag, so on this build it repainted the composer itself
// (it is wide, low on the screen and painted, exactly what the sweep hunts).
// The composer here carries its window fill inline, the way the theme paints
// it, and must keep it; the real fade beside it must still be swept.
const GEMINI4_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>smoke-gemini4</title>
<script>
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ gemini: "final-fantasy" }));
  window.__TEMA_TEST_SITE = "gemini";
</script>
<style>
  html, body { margin: 0; width: 800px; height: 600px; }
  .input-area-container { position: fixed; left: 80px; bottom: 16px; width: 640px; height: 60px;
    display: flex; flex-direction: column; }
  .fade { position: fixed; left: 0; right: 0; bottom: 84px; height: 40px;
    background: linear-gradient(180deg, transparent, #0f0f0f); }
  /* Stock paint comes from stylesheets on the real page, never inline. */
  .send-button-container { background: rgb(40, 60, 140); }
</style>
</head>
<body class="dark-theme">
<main>
  <div id="chat-history"><infinite-scroller>
    <div class="conversation-container">
      <user-query><span class="user-query-bubble-with-background">hello</span></user-query>
      <model-response id="aturn"><div class="response-container">
        <div class="response-container-content"><message-content><div class="markdown"><p>A reply.</p></div></message-content></div>
      </div><message-actions><button aria-label="Copy"></button></message-actions></model-response>
    </div>
  </infinite-scroller></div>
  <input-container>
    <div class="fade" id="fade"></div>
    <div class="input-area-container is-zero-state" id="pill" style="background: linear-gradient(180deg, #2f47a8, #0b1240)">
      <input-area-v2><div class="input-area">
        <rich-textarea><div class="ql-editor" contenteditable="true">hi</div></rich-textarea>
        <div class="send-button-container" data-test-id="send-button-container" id="sendbox">
          <gem-icon-button class="send-button"><button aria-label="Send message"><mat-icon>send</mat-icon></button></gem-icon-button>
        </div>
      </div></input-area-v2>
      <chat-spark-toggle><gem-segmented-button-row role="group"></gem-segmented-button-row></chat-spark-toggle>
    </div>
  </input-container>
</main>
<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.join(" ")); realError(...a); };
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
  const wear = (sites) => chrome.storage.sync.set({ sites });
  window.__drive = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pill = document.getElementById("pill");
    const fade = document.getElementById("fade");
    const sendbox = document.getElementById("sendbox");
    await wait(700);

    if (!document.querySelector("div.input-area-container > .ff-party")) {
      window.__errors.push("gemini4: party did not mount on the div composer");
    }
    if (pill.dataset.ffShellClear || !/2f47a8|47, 71, 168/.test(pill.style.background)) {
      window.__errors.push("gemini4: the paint sweep repainted the composer window -> " + pill.style.background);
    }
    if (!fade.dataset.ffShellClear) {
      window.__errors.push("gemini4: the scroll fade beside the composer was not swept");
    }
    if (!document.querySelector("input-container").dataset.ffShellClear) {
      window.__errors.push("gemini4: input-container's own fill was not cleared");
    }
    if (!sendbox.dataset.ffSendClear) {
      window.__errors.push("gemini4: the send slot was not stripped");
    }

    // Off: every inline change comes back out, so stock Gemini looks stock.
    wear({ gemini: null });
    await wait(500);
    const left = document.querySelectorAll("[data-ff-shell-clear], [data-ff-send-clear], .ff-party");
    if (left.length) {
      window.__errors.push("gemini4: " + left.length + " theme stamps left behind after the theme went off");
    }
    if (getComputedStyle(sendbox).backgroundColor !== "rgb(40, 60, 140)") {
      window.__errors.push("gemini4: the send slot's own fill was not restored -> " +
        getComputedStyle(sendbox).backgroundColor);
    }
    if (fade.style.background) {
      window.__errors.push("gemini4: the scroll fade kept the theme's paint -> " + fade.style.background);
    }
    return window.__errors;
  };
  window.__drive().then((errs) => {
    document.title = "SMOKE:" + (errs.length ? errs.join(" | ") : "clean");
  });
</script>
</body>
</html>`;

// claude.ai's rebuilt transcript (2026-10, live markup 2026-10-14): turns are
// div[data-cds="UserMessage"] / div[data-cds="AssistantMessage"], the reply
// still carries data-is-streaming, its body is [data-transcript-engine-root]
// > .prose, the thinking summary is a TurnStatus row marked
// data-find-omitted, the action row sits inside the reply, and there is no
// empty next-turn placeholder.
const CLAUDE_CDS_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>smoke-claude-cds</title>
<script>
  localStorage.clear();
  localStorage.setItem("sync:sites", JSON.stringify({ claude: "final-fantasy" }));
  window.__TEMA_TEST_SITE = "claude";
</script>
</head>
<body class="font-ui">
<main class="dframe-content"><div data-testid="transcript-list"><div role="feed" id="feed">
  <div data-testid="transcript-row"><div role="article"><div data-transcript-row>
    <div data-cds="UserMessage" data-turn-key><div class="relative flex"><div><div class="cds-user-message-body">
      <div data-testid="user-message"><div class="contents"><p>whats pikas full name</p></div></div>
    </div></div></div><div data-cds="MessageActions" role="toolbar"><button data-cds="Button" aria-label="Edit"></button></div></div>
  </div></div></div>
  <div data-testid="transcript-row"><div role="article"><div data-transcript-row><div data-reply-scope>
    <div data-cds="AssistantMessage" data-testid="assistant-message" data-turn-key data-is-streaming="false" id="first">
      <h2 class="sr-only" data-find-omitted>Claude said:</h2>
      <div class="flex min-w-0 flex-col">
        <div data-cds="TurnStatus" data-find-omitted data-state="done"><span>Figuring out what Pika means.</span></div>
        <div class="min-w-0"><div class="grid"><div data-transcript-engine-root class="contents">
          <div class="prose"><div class="standard-markdown"><p>Pika could mean a few things.</p></div></div>
        </div></div></div>
      </div>
      <div class="print:mt-xs"><div data-cds="MessageActions" role="toolbar" data-testid="message-actions">
        <button data-cds="Button" aria-label="Copy"></button><span role="status" class="sr-only"></span>
      </div></div>
    </div>
  </div></div></div></div>
</div></div></main>
<script>
  window.__errors = [];
  addEventListener("error", (e) => window.__errors.push("error: " + (e.message || e)));
  addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__errors.push("console.error: " + a.join(" ")); realError(...a); };
</script>
<script src="../lib/ext-shim.js"></script>
<script src="../../src/registry.js"></script>
<script src="../../src/settings.js"></script>
<script src="../../src/content/core.js"></script>
<script src="../../src/content/signals.js"></script>
<script src="../../themes/final-fantasy/runtime.js"></script>
<script>
  const wear = (sites) => chrome.storage.sync.set({ sites });
  window.__drive = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const err = (m) => window.__errors.push("claude-cds: " + m);
    const first = document.getElementById("first");
    await wait(600);

    if (!first.hasAttribute("data-tema-reply")) err("a settled reply was not stamped data-tema-reply — no window, no crystal, no font");
    if (!first.hasAttribute("data-tema-latest")) err("the newest reply was not stamped data-tema-latest — Mog has no perch");
    if (first.hasAttribute("data-tema-working")) err("a settled reply was stamped working");

    // A new turn: the reply mounts streaming, thinking first. Its summary
    // row already holds text (marked data-find-omitted) and its body is
    // empty, so it must be WORKING but not yet a reply (no window yet).
    const row = document.createElement("div");
    row.setAttribute("data-testid", "transcript-row");
    row.innerHTML =
      '<div role="article"><div data-transcript-row><div data-reply-scope>' +
      '<div data-cds="AssistantMessage" data-testid="assistant-message" data-turn-key data-is-streaming="true" id="next">' +
      '<h2 class="sr-only" data-find-omitted>Claude said:</h2>' +
      '<div class="flex min-w-0 flex-col">' +
      '<div data-cds="TurnStatus" data-find-omitted data-state="thinking"><span>Thinking about moogles</span></div>' +
      '<div class="min-w-0"><div class="grid"><div data-transcript-engine-root class="contents"></div></div></div>' +
      '</div></div></div></div></div>';
    document.getElementById("feed").append(row);
    const next = document.getElementById("next");
    await wait(600);
    if (!next.hasAttribute("data-tema-working")) err("a streaming reply was not stamped working — Mog would not hop");
    if (next.hasAttribute("data-tema-reply")) err("the thinking summary stamped the reply — an empty window would open mid-thinking");
    if (first.hasAttribute("data-tema-working")) err("the previous reply was stamped working");

    // The answer streams into the body.
    next.querySelector("[data-transcript-engine-root]").innerHTML =
      '<div class="prose"><div class="standard-markdown"><p>Mog.</p></div></div>';
    await wait(600);
    if (!next.hasAttribute("data-tema-reply")) err("streamed answer text did not stamp the reply");
    if (!next.hasAttribute("data-tema-latest") || first.hasAttribute("data-tema-latest")) err("latest did not move to the new reply");
    if (!next.hasAttribute("data-tema-working")) err("working dropped while the reply still streams");

    // Done: the stamp holds through the grace window, then clears.
    next.setAttribute("data-is-streaming", "false");
    await wait(2400);
    if (next.hasAttribute("data-tema-working")) err("working outlived the run by more than the grace window");
    if (!next.hasAttribute("data-tema-reply") || !next.hasAttribute("data-tema-latest")) err("the finished reply lost its stamps");

    wear({ claude: null });
    await wait(500);
    const left = document.querySelectorAll("[data-tema-reply], [data-tema-latest], [data-tema-working]");
    if (left.length) err(left.length + " stamps left behind after the theme went off");
    return window.__errors;
  };
  window.__drive().then((errs) => {
    document.title = "SMOKE:" + (errs.length ? errs.join(" | ") : "clean");
  });
</script>
</body>
</html>`;

let failed = 0;

async function drivePage(label, html, budget) {
  const file = resolve(ROOT, "tools/tests/.smoke.html");
  await writeFile(file, html, "utf8");
  const { stdout } = await run(CHROME, [
    "--headless", "--disable-gpu", "--allow-file-access-from-files",
    "--virtual-time-budget=" + budget, "--dump-dom",
    "file://" + file,
  ], { maxBuffer: 40 * 1024 * 1024 });
  await rm(file, { force: true });

  const m = /<title>SMOKE:([\s\S]*?)<\/title>/.exec(stdout);
  if (!m) {
    failed++;
    console.log(`${label}: FAILED — the driver never completed (a throw at load time stops everything)`);
    const early = /Uncaught[^<\n]*/.exec(stdout);
    if (early) console.log("  " + early[0]);
    return;
  }
  const result = m[1].trim();
  if (result === "clean") {
    console.log(`${label}: clean — the content scripts ran through every state with no errors`);
    return;
  }
  failed++;
  console.log(`${label} FAILED:`);
  for (const e of result.split(" | ")) console.log("  " + e);
}

await drivePage("smoke (claude)", PAGE, 22000);
await drivePage("smoke (claude 2026-10 transcript)", CLAUDE_CDS_PAGE, 9000);
await drivePage("smoke (chatgpt)", GPT_PAGE, 24000);
await drivePage("smoke (chatgpt app shell)", GPT_SHELL_PAGE, 26000);
await drivePage("smoke (gemini)", GEMINI_PAGE, 24000);
await drivePage("smoke (gemini 4)", GEMINI4_PAGE, 8000);
process.exit(failed ? 1 : 0);
