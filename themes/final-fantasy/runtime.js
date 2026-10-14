// Tema — Final Fantasy behaviour.
//
// Everything the theme DOES, as opposed to how it looks (that is the three
// site stylesheets beside this file): the four-person party standing on the
// message box, the chocobo drive-bys, menu sounds, shooting stars, Mog's
// tooltip name, and the Gemini paint fixes no stylesheet can win.
//
// Tema's core starts this when Final Fantasy goes on in a tab and stops it
// when it goes off, so nothing here runs, listens or leaves anything behind
// while another theme (or none) is on. The reply, working and icon stamps
// the CSS also keys on come from the engine's page signals (src/content/
// signals.js), declared in theme.json.
(() => {
  "use strict";

  const T = globalThis.Tema;
  if (!T) return;
  const SITE = T.site;
  const THEME = "final-fantasy";

  let on = false;          // the theme is on in this tab
  let ctx = null;          // { site, theme, options, has } from the core
  const isOn = () => on && T.alive();

  // Sound pipeline state. See the menu sounds section.
  let audioCtx = null;
  let soundGain = null;
  let soundBuffers = null;   // { name: AudioBuffer } once decoded
  let soundBytes = null;     // collected wav bytes, waiting for a context
  let soundState = "idle";   // idle -> priming -> ready | failed

  const api = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  /* ------------------------------------------------------------- chocobo */

  // Drive-by easter egg: every 5-10 minutes (first one 60-120s after the
  // theme goes on, so it can actually be seen), one of three runs:
  //   a — across the top of the composer, knocking the party over one by one
  //   b — behind the composer text, right to left, revealed edge-first
  //   c — same as b, left to right
  // CSS owns all movement; this module only spawns elements, schedules the
  // party falls to the moment the bird reaches each member, and cleans up.
  const CHOCO_FIRST = [60e3, 120e3];
  const CHOCO_GAP = [300e3, 600e3];
  let chocoTimer = null;
  let chocoActive = false;
  let chocoAbort = null;   // tears down a run mid-flight (theme off, extension reload)

  function scheduleChoco(first) {
    clearTimeout(chocoTimer);
    const [lo, hi] = first ? CHOCO_FIRST : CHOCO_GAP;
    chocoTimer = setTimeout(() => {
      if (isOn() && !document.hidden &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        runChoco("abc"[Math.floor(Math.random() * 3)]);
      }
      if (on) scheduleChoco(false);
    }, lo + Math.random() * (hi - lo));
  }

  function runChoco(variant, dur) {
    if (!isOn() || chocoActive) return;
    const host = composer();
    if (!host) return;
    chocoActive = true;
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));

    // Run audio. Same option gate as the UI blips; the autoplay rules still
    // apply, so a run before the page's first click is simply silent.
    let stepTimer = null;
    if (soundsOn()) {
      primeSounds();
      ensureSounds();
      playSound("chirp", false);
    }
    const startSteps = (quietWindows) => {
      if (!soundsOn()) return;
      let n = 0, elapsed = 0;
      // 220ms = one gait cycle. Alternating playback rate gives two feet
      // without a second file; the quiet windows silence the taps mid-leap,
      // where feet touch nothing.
      stepTimer = setInterval(() => {
        elapsed += 220; n++;
        if (quietWindows && quietWindows.some(([a, b]) => elapsed >= a && elapsed <= b)) return;
        playSound("step", false, n % 2 ? 1 : 1.14);
      }, 220);
    };
    const stopSteps = () => { clearInterval(stepTimer); stepTimer = null; };

    if (variant === "a") {
      // The parkour route: in along the screen bottom, leap onto the
      // composer, cross it tripping the party, leap off the right edge, out
      // along the bottom. All geometry is measured NOW, in VIEWPORT
      // coordinates, so any window and composer size produce a correct path.
      //
      // Two birds play the one chocobo. claude.ai wraps the app in
      // overflow-hidden containers that clip a composer-child the moment it
      // leaves the content column, so the ground and leap segments belong to
      // a position:fixed "sky" bird on <body> (immune to ancestor clipping),
      // while the crossing segment belongs to a composer-child bird at z 39
      // so it still passes BEHIND the party (z 40). They swap at the leap
      // landings, where both stand on the same pixel.
      const C = host.getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      const w2 = (parseFloat(cs.getPropertyValue("--ff-art-choco-w")) || 16) * 2;
      const h2 = (parseFloat(cs.getPropertyValue("--ff-art-choco-h")) || 16) * 2;

      const ground = innerHeight - h2 - 10;               // viewport y, feet near the bottom
      const boxTop = C.top - h2;                          // viewport y, feet on the composer
      const JUMP_DX = 92;

      // Waypoint x's (viewport space), clamped strictly increasing — slim
      // margins can fold the ideal takeoff past the entry point, and WAAPI
      // rejects non-monotonic offsets outright.
      const xs = [
        -w2 - 8,                                          // off screen left
        C.left + 6 - JUMP_DX,                             // takeoff
        C.left + 6,                                       // on the box, left edge
        C.right - w2 - 6,                                 // far edge
        C.right + 74,                                     // touchdown
        innerWidth + w2 + 8,                              // off screen right
      ];
      for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 12);
      const ys = [ground, ground, boxTop, boxTop, ground, ground];

      const L = xs[5] - xs[0];
      const speed = dur ? L / dur : 0.185;                // px per ms
      const total = L / speed;
      const T = xs.map((x) => (x - xs[0]) / speed);       // waypoint times

      const leap = (i, peak, frames) => {
        for (let k = 1; k <= 4; k++) {
          const f = k / 4;
          frames.push({
            transform: `translate(${xs[i] + (xs[i + 1] - xs[i]) * f}px, ` +
                       `${ys[i] + (ys[i + 1] - ys[i]) * f - peak * 4 * f * (1 - f)}px)`,
            offset: Math.min((T[i] + (T[i + 1] - T[i]) * f) / total, 1),
          });
        }
      };

      // Sky bird: the full route (its crossing stretch is spent hidden).
      const frames = [{ transform: `translate(${xs[0]}px, ${ys[0]}px)`, offset: 0 }];
      frames.push({ transform: `translate(${xs[1]}px, ${ys[1]}px)`, offset: T[1] / total });
      leap(1, 34, frames);                                // up onto the box
      frames.push({ transform: `translate(${xs[3]}px, ${ys[3]}px)`, offset: T[3] / total });
      leap(3, 26, frames);                                // off the far edge
      frames.push({ transform: `translate(${xs[5]}px, ${ys[5]}px)`, offset: 1 });

      const mkBird = (cls) => {
        const b = document.createElement("div");
        b.className = cls;
        b.setAttribute("aria-hidden", "true");
        const sprite = document.createElement("div");
        sprite.className = "ff-choco";
        b.append(sprite);
        return b;
      };

      const sky = mkBird("ff-choco-sky");
      document.body.append(sky);
      const skyAnim = sky.animate(frames, { duration: total, easing: "linear", fill: "forwards" });

      // Box bird: exists only for the crossing, in composer-local coords.
      const el = mkBird("ff-choco-a");
      el.style.visibility = "hidden";
      host.append(el);
      let boxAnim = null;
      later(() => {
        sky.style.visibility = "hidden";
        el.style.visibility = "";
        boxAnim = el.animate([
          { transform: `translate(${xs[2] - C.left}px, ${-h2}px)` },
          { transform: `translate(${xs[3] - C.left}px, ${-h2}px)` },
        ], { duration: T[3] - T[2], easing: "linear", fill: "forwards" });
      }, T[2]);
      later(() => {
        el.style.visibility = "hidden";
        sky.style.visibility = "";
      }, T[3]);

      startSteps([[T[1], T[2]], [T[3], T[4]]]);
      if (soundsOn()) {
        later(() => playSound("jump", false), T[1]);
        later(() => playSound("jump", false, 0.94), T[3]);   // heavier second leap
      }

      const members = [...host.querySelectorAll(".ff-party-member")];
      // Fall voices in party order: A4, A5, A6, then A4 again for the fourth.
      const FALL_SOUNDS = ["fall-1", "fall-2", "fall-3", "fall-1"];
      members.forEach((m, mi) => {
        const r = m.getBoundingClientRect();
        const x = r.left + r.width / 2 - w2;              // bird's head reaches them
        if (x <= xs[2] || x >= xs[3]) return;
        later(() => {
          if (m.dataset.pose === "idle") {
            m.dataset.pose = "fall";
            m.style.setProperty("--pose", String(FALL_POSE));
            playSound(FALL_SOUNDS[mi % FALL_SOUNDS.length], false);
          }
        }, T[2] + (x - xs[2]) / speed);
      });

      const standUp = () => members.forEach((m, i) => later(() => {
        if (m.dataset.pose === "fall") {
          m.style.removeProperty("--pose");
          m.dataset.pose = "idle";
        }
      }, i * 150));
      later(standUp, T[4] + 120);

      later(() => {
        sky.remove();
        el.remove();
        stopSteps();
        later(() => { chocoActive = false; chocoAbort = null; }, 240 + members.length * 150);
      }, total + 60);

      chocoAbort = () => {
        timers.forEach(clearTimeout);
        stopSteps();
        skyAnim.cancel();
        if (boxAnim) boxAnim.cancel();
        sky.remove();
        el.remove();
        for (const m of members) {
          if (m.dataset.pose === "fall") {
            m.style.removeProperty("--pose");
            m.dataset.pose = "idle";
          }
        }
        chocoActive = false; chocoAbort = null;
      };
    } else {
      dur = dur || 4200;
      const clip = document.createElement("div");
      clip.className = "ff-choco-clip";
      clip.setAttribute("aria-hidden", "true");
      const el = document.createElement("div");
      el.className = "ff-choco " + (variant === "c" ? "ff-choco-c" : "ff-choco-b");
      clip.append(el);
      // The reveal trick needs the element whose background the bird hides
      // behind. On claude that IS the composer host; on chatgpt the paint
      // lives on the [data-composer-surface] child of the form (on the
      // app-shell build, [data-composer-surface-variant] under the stage),
      // so the clip mounts there (the theme grants it a stacking context for
      // the z:-1).
      const clipHost = SITE === "chatgpt"
        ? host.querySelector("[data-composer-surface-variant], [data-composer-surface]") || host
        : host;
      clipHost.append(clip);
      // Measured after append — clientWidth is 0 before layout knows it.
      el.style.setProperty("--choco-dist", clip.clientWidth + "px");
      el.style.setProperty("--choco-dur", dur + "ms");

      startSteps(null);
      later(() => { clip.remove(); stopSteps(); chocoActive = false; chocoAbort = null; }, dur + 120);
      chocoAbort = () => {
        timers.forEach(clearTimeout);
        stopSteps();
        clip.remove();
        chocoActive = false; chocoAbort = null;
      };
    }
  }

  /* ---------------------------------------------------------- menu sounds */

  // The FF menu cursor blip on hover (and keyboard focus — the d-pad case),
  // and the confirm chime on click. Gated on the per-theme "menu-sounds"
  // option, so nothing below runs for other themes or when toggled off.
  //
  // Web Audio rather than <audio>: hover can fire in quick bursts, and
  // buffer-source playback is the only way overlapping blips stay clean.
  const SOUND_OPT = "menu-sounds";
  const SOUND_DIR = "themes/final-fantasy/assets/sounds/";
  const SOUND_FILES = {
    hover: "hover.wav",
    select: "select.wav",
    "fall-1": "fall-1.wav",     // A4 — 1st and 4th party fall
    "fall-2": "fall-2.wav",     // A5 — 2nd
    "fall-3": "fall-3.wav",     // A6 — 3rd
    chirp: "chirp.wav",         // chocobo announcing itself
    step: "step.wav",           // synthesized tap  (tools/gen-chip-sfx.py)
    jump: "jump.wav",           // synthesized boing (tools/gen-chip-sfx.py)
  };

  // Relative loudness. Every file is normalized to the same −6 dB peak, so
  // "subtle" is decided HERE, in one tweakable place, not baked into audio
  // files that would need regenerating: the gag sounds sit well under the UI
  // blips by design.
  const SOUND_VOLUMES = {
    // The UI blips fire far more often than anything else, so they sit well
    // below full scale — tuned down twice by ear (master cut, then this).
    hover: 0.35, select: 0.35,
    "fall-1": 0.4, "fall-2": 0.4, "fall-3": 0.4,
    chirp: 0.45,
    step: 0.22,
    jump: 0.3,
  };

  let lastBlipEl = null;     // dedupe: one blip per entered control
  let lastBlipAt = 0;

  const soundsOn = () => isOn() && !!ctx && ctx.has(SOUND_OPT);

  // Controls that should blip. Deliberately close to what a JRPG menu would
  // call a "row": links, buttons and menu-ish roles. Text inputs excluded —
  // brushing past the composer is not a menu move.
  const SOUND_TARGETS = 'a[href], button, [role="button"], [role="menuitem"],' +
    ' [role="option"], [role="tab"], [role="radio"], [role="checkbox"], [role="link"], summary';

  /**
   * Stage 1: collect the wav bytes. Needs no gesture, so it runs on the first
   * hover — but NO AudioContext is constructed here. Chrome's autoplay policy
   * logs "The AudioContext was not allowed to start" the moment one is
   * created before the page has seen a user gesture, and that line lands in
   * the extension's error panel looking exactly like a bug.
   *
   * The files are web-accessible resources of the extension (theme.json
   * "files"), fetched once per tab, the first time a sound is wanted.
   */
  function primeSounds() {
    if (soundState !== "idle") return;
    soundState = "priming";
    const grab = (name) =>
      fetch(api.runtime.getURL(SOUND_DIR + SOUND_FILES[name]))
        .then((r) => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); });
    const names = Object.keys(SOUND_FILES);
    // allSettled, not all: one missing file should not silence every other
    // sound with it.
    Promise.allSettled(names.map((n) => grab(n)))
      .then((results) => {
        soundBytes = {};
        let any = false;
        results.forEach((r, i) => {
          if (r.status === "fulfilled") { soundBytes[names[i]] = r.value; any = true; }
        });
        if (!any) { soundState = "failed"; return; }
        maybeDecode();
      });
    // Decode at the first real gesture — pointerdown leads click by enough
    // that even the very first select chime has its buffer ready.
    const onGesture = () => ensureSounds();
    document.addEventListener("pointerdown", onGesture, { capture: true, once: true });
    document.addEventListener("keydown", onGesture, { capture: true, once: true });
  }

  /**
   * Stage 2: construct the context — only once the page holds sticky
   * activation, which is precisely Chrome's own "allowed to start" test.
   * Before that this is a silent no-op and hover blips simply don't play,
   * which is the same behaviour as before minus the scary panel entry.
   */
  function ensureSounds() {
    if (audioCtx || soundState === "failed") return;
    if (!navigator.userActivation || !navigator.userActivation.hasBeenActive) return;
    try {
      audioCtx = new AudioContext();
      soundGain = audioCtx.createGain();
      // 0.6 originally; dropped 20% on request — one number scales every
      // sound uniformly, per-sound balance stays in SOUND_VOLUMES.
      soundGain.gain.value = 0.48;
      soundGain.connect(audioCtx.destination);
    } catch {
      soundState = "failed";   // no Web Audio here; stay silent forever
      return;
    }
    maybeDecode();
  }

  /** Bytes and context arrive in either order; decode when both exist. */
  function maybeDecode() {
    if (!audioCtx || !soundBytes || soundBuffers || soundState === "failed") return;
    const names = Object.keys(soundBytes);
    Promise.allSettled(names.map((n) => audioCtx.decodeAudioData(soundBytes[n].slice(0))))
      .then((results) => {
        soundBuffers = {};
        let any = false;
        results.forEach((r, i) => {
          if (r.status === "fulfilled") { soundBuffers[names[i]] = r.value; any = true; }
        });
        soundState = any ? "ready" : "failed";
      });
  }

  function playSound(name, isGesture, rate) {
    if (soundState !== "ready") return;
    const go = () => {
      // The context can wind down between plays; re-check rather than throw.
      if (!soundBuffers || !soundBuffers[name] || audioCtx.state !== "running") return;
      const src = audioCtx.createBufferSource();
      src.buffer = soundBuffers[name];
      if (rate) src.playbackRate.value = rate;
      // Per-sound trim on its own gain node, so one map entry adjusts a
      // sound without touching the files or the master level.
      const g = audioCtx.createGain();
      g.gain.value = SOUND_VOLUMES[name] != null ? SOUND_VOLUMES[name] : 1;
      src.connect(g);
      g.connect(soundGain);
      src.start();
    };
    if (audioCtx.state === "suspended") {
      // Autoplay policy: the context stays suspended until a user gesture.
      // A click IS one, so resuming inside it works and the select chime
      // plays from the very first click. Hover is NOT a gesture — those
      // blips are skipped until the first click unlocks the context.
      if (isGesture) audioCtx.resume().then(go).catch(() => {});
      else audioCtx.resume().catch(() => {});
      return;
    }
    go();
  }

  function blipTarget(e) {
    const t = e.target;
    if (!(t instanceof Element)) return null;
    const el = t.closest(SOUND_TARGETS);
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return null;
    return el;
  }

  // Capture phase throughout: the app stops propagation on plenty of its
  // controls, and a sound hook should observe, never depend on bubbling.
  // Attached while the theme is on (see the wiring at the bottom).
  function onBlipOver(e) {
    if (!soundsOn()) return;
    const el = blipTarget(e);
    if (!el || el === lastBlipEl) return;   // crossing child boundaries re-fires
    lastBlipEl = el;
    const now = performance.now();
    if (now - lastBlipAt < 35) return;      // sweeping a menu still blips per row
    lastBlipAt = now;
    primeSounds();
    ensureSounds();
    playSound("hover", false);
  }

  function onBlipOut(e) {
    if (!lastBlipEl) return;
    const to = e.relatedTarget;
    // Only clear when truly leaving the control, so wandering across its own
    // children doesn't re-blip.
    if (!(to instanceof Element) || !lastBlipEl.contains(to)) lastBlipEl = null;
  }

  // Keyboard navigation is the authentic case — the original sound IS a
  // cursor-move sound. Shares lastBlipEl with hover so the focus a click
  // causes doesn't double-blip.
  function onBlipFocus(e) {
    if (!soundsOn()) return;
    const el = blipTarget(e);
    if (!el || el === lastBlipEl) return;
    lastBlipEl = el;
    primeSounds();
    ensureSounds();
    playSound("hover", false);
  }

  function onBlipClick(e) {
    if (!soundsOn()) return;
    if (!blipTarget(e)) return;
    primeSounds();
    ensureSounds();
    playSound("select", true);
  }

  const BLIP_LISTENERS = [
    ["mouseover", onBlipOver], ["mouseout", onBlipOut],
    ["focusin", onBlipFocus], ["click", onBlipClick],
  ];

  /* ------------------------------------------------------ party injection */

  // The Final Fantasy theme draws its party as a single ::before on the
  // composer, which is enough to animate but can never be clicked — a
  // pseudo-element has no box in the hit-test tree. To make each member
  // react individually they have to be real elements, so the theme injects
  // four of them here and CSS suppresses the pseudo-element fallback via
  // [data-ff-party="dom"] on <html>.
  const PARTY_ATTR = "data-ff-party";
  const PARTY_CLASS = "ff-party";
  const MEMBERS = 4;
  const POSES = 6;        // frames per strip: 2 idle + 3 click poses + 1 fall
  const IDLE_POSES = 2;
  const CLICK_POSES = 3;  // random pool for taps — excludes the fall frame
  const FALL_POSE = 5;    // knocked flat; reserved for the chocobo drive-by

  const composer = () => {
    if (SITE === "gemini") {
      // The visual pill every Gemini surface shares (Chat and Spark alike) is
      // .input-area-container — a <fieldset> inside <input-container> wrapping
      // input-area-v2. The party stands on it and the chocobo stages off it.
      // Fallback: the input-area div inside input-area-v2 for builds that
      // drop the fieldset.
      return document.querySelector("input-container .input-area-container") ||
        document.querySelector("input-area-v2 .input-area") ||
        null;
    }
    if (SITE === "chatgpt") {
      // App-shell build (2026-09): form[data-chatgpt-composer] also carries
      // the above-composer portal (notices, chips) at its top, so the stage
      // is the form's child that wraps the visual box (ComposerLayoutRoot,
      // the one [data-composer-surface-variant]) — the party stands on the
      // box, not on whatever the portal shows. The thread/home composer is
      // preferred by placement, so an inline edit composer earlier in the
      // DOM never steals the party.
      const surface =
        document.querySelector('form[data-chatgpt-composer]:is([data-composer-placement="thread"], [data-composer-placement="home"]) [data-composer-surface-variant]') ||
        document.querySelector("form[data-chatgpt-composer] [data-composer-surface-variant]");
      if (surface) return surface.closest("form > *");
      // The unified composer <form> wraps the visual box ([data-composer-
      // surface]) and nothing else of consequence, and it survives the
      // Chat/Work tabs alike. The fallback walks up from the surface for any
      // future variant that renames the form's data-type.
      return document.querySelector('form[data-type="unified-composer"]') ||
        document.querySelector("[data-composer-surface]")?.closest("form") ||
        null;
    }
    // Home tab first, then the code tab's epitaxy prompt — the party, the
    // chocobo routes and the banner logic all stage off whichever exists.
    return document.querySelector('div[class*="cursor-text"]:has([data-testid="chat-input"])') ||
      document.querySelector('.epitaxy-prompt:not([class*="prompt-compact-bg"])');
  };

  function buildParty(host) {
    const row = document.createElement("div");
    row.className = PARTY_CLASS;
    // Purely decorative: unlabelled clickable divs would otherwise land in the
    // accessibility tree. aria-hidden does not affect pointer hit-testing.
    row.setAttribute("aria-hidden", "true");
    // Injected rather than styled from the sheet so the markup stays inert:
    // no links, no focusable controls, nothing the app's own key handling
    // could trip over.
    for (let i = 0; i < MEMBERS; i++) {
      const m = document.createElement("div");
      m.className = PARTY_CLASS + "-member";
      m.dataset.member = String(i);
      m.dataset.pose = "idle";
      // The members sit inside claude.ai's click-to-focus surface, so a bare
      // click listener would blur the composer and drop the caret mid-sentence.
      m.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      m.addEventListener("click", (e) => { e.stopPropagation(); playPose(m); });
      row.append(m);
    }
    host.append(row);
    return row;
  }

  /** One-shot reaction: hold a random action frame, then fall back to idle. */
  function playPose(member) {
    // "fall" guards the chocobo gag: a click mid-fall would stand the member
    // up early and desync the row.
    if (member.dataset.pose === "busy" || member.dataset.pose === "fall") return;
    const pose = IDLE_POSES + Math.floor(Math.random() * CLICK_POSES);
    member.dataset.pose = "busy";
    member.style.setProperty("--pose", String(pose));
    clearTimeout(member._poseTimer);
    member._poseTimer = setTimeout(() => {
      member.style.removeProperty("--pose");
      member.dataset.pose = "idle";
    }, 460);
  }

  /**
   * Keep transient banners clear of the party.
   *
   * These come and go ("You've used 75% of your weekly limit", notification
   * prompts) and their markup is generated, so there is no stable class to
   * target from CSS — every selector guess so far has missed. Measuring at
   * runtime sidesteps that entirely: find whatever box sits directly above the
   * composer and overlaps the sprites horizontally, and pad its right edge so
   * its text AND its close button end before they do.
   */
  const PADDED = "ffPartyPad";
  const WRAP = "ffBannerWrap";
  let styledBanner = null;

  function padBannersForParty(host) {
    // The banner hunt is a HOME-tab notion: usage warnings mount in the
    // sticky strip around that composer. On the code tab the element its
    // geometry likes best is the repo/branch chip row above the prompt —
    // which promptly got dressed as a menu window. No epitaxy surface needs
    // this treatment; clear and stand down. chatgpt.com and gemini have no
    // banner band at all, so they stand down the same way rather than
    // dressing whatever sits above the composer.
    if (SITE !== "claude") { clearBannerPadding(); return; }
    if (host.classList.contains("epitaxy-prompt")) { clearBannerPadding(); return; }
    // Every bail-out path clears first. Returning early used to leave the cap
    // and frame frozen on whatever was styled — so shrinking the window below
    // the party breakpoint, or navigating while the composer was unmounted,
    // stranded a narrowed banner permanently.
    const row = host.querySelector(":scope > ." + PARTY_CLASS);
    if (!row) { clearBannerPadding(); return; }
    const rowBox = row.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();
    if (!rowBox.width || !hostBox.width) { clearBannerPadding(); return; }

    // Resolve the strip by identity, not by counting hops. A fixed 5-hop walk
    // silently lands somewhere else the moment claude.ai adds or removes a
    // wrapper — potentially on the conversation scroller, turning this into a
    // whole-document crawl on every pass.
    const strip = host.closest('div[class*="sticky"][class*="bottom-0"]') || host.parentElement;
    if (!strip) { clearBannerPadding(); return; }

    // Exactly ONE element is ever styled, chosen here and painted with inline
    // styles. This used to tag a set and let a CSS attribute rule paint them,
    // which meant any second element that slipped through the filter — a
    // wrapper sharing the banner's geometry and text — got its own frame too.
    // Picking a single winner makes a doubled border structurally impossible.
    const cap = Math.max(0, Math.round(rowBox.left - hostBox.left - 12));

    let best = null;
    let bestScore = Infinity;
    for (const el of strip.querySelectorAll("div,section,aside")) {
      if (el === host || el.contains(host) || host.contains(el)) continue;
      // Never anything belonging to the conversation itself.
      if (el.closest('[role="article"]') || el.querySelector('[role="article"]')) continue;
      if (el.closest("[data-is-streaming]") || el.querySelector("[data-is-streaming]")) continue;

      const already = el === styledBanner;
      const b = el.getBoundingClientRect();

      // Retention tests — cheap, and NOT perturbed by anything the styling
      // does. Everything below this line only gates INITIAL selection.
      if (!(b.bottom <= hostBox.top + 6 && b.bottom > hostBox.top - 70)) continue;
      if ((el.textContent || "").trim().length <= 3) continue;

      // The height gate used to live outside this guard, and that was the same
      // oscillation as the width one: capping the box rewraps its text and the
      // frame adds 2px, so the element grows past 72px, fails, gets unstyled,
      // shrinks back, and re-qualifies — a strobe at the debounce rate. Both
      // axes the styling can move are now initial-selection only.
      if (!already) {
        if (!(b.height >= 16 && b.height <= 72)) continue;
        const natural = Math.max(b.width, el.scrollWidth);
        if (!(b.left + natural > rowBox.left && natural > 240)) continue;
      }

      // Prefer the incumbent, then the row closest to the composer (siblings
      // stacked in the band are both plausible), then the smallest box.
      const area = b.width * b.height;
      const score = already ? -Infinity : -b.bottom * 1e6 + area;
      if (score < bestScore) { best = el; bestScore = score; }
    }

    if (styledBanner && styledBanner !== best) unstyleBanner(styledBanner);
    if (!best) { styledBanner = null; return; }

    styledBanner = best;

    // Claude wraps the banner in an "alert band": div.w-full ... bg-surface-1
    // rounded-t-[20px] with an inset shadow, ~629x59 around a 397x22 banner.
    // It is opaque dark grey and untouched by the theme, so it reads as a
    // second box around the themed one — which is what looked like a doubled
    // border. Neutralise it rather than trying to style it: it is pure
    // scaffolding, and its own rounding/shadow fight the frame underneath.
    let wrap = best.parentElement;
    for (let i = 0; i < 3 && wrap; i++, wrap = wrap.parentElement) {
      if (wrap === host || wrap.contains(host)) break;
      // Never neutralise the banner itself. If `best` ever moves deeper, the
      // previously-styled element becomes an ancestor on the next pass and
      // would be handed background:transparent — clearing its blue fill and
      // letting Claude's dark bg-surface-1 show through the white frame.
      if (wrap === best || wrap === styledBanner) continue;
      const wcs = getComputedStyle(wrap);
      const opaque = wcs.backgroundColor !== "rgba(0, 0, 0, 0)" || wcs.boxShadow !== "none";
      if (!opaque) continue;
      wrap.dataset[WRAP] = "1";
      wrap.style.setProperty("background", "transparent", "important");
      wrap.style.setProperty("box-shadow", "none", "important");
      wrap.style.setProperty("border-color", "transparent", "important");
    }

    const st = best.style;
    const capPx = cap + "px";
    // !important: the theme also carries a blanket max-width rule for this
    // strip, and a plain inline value loses to it — the banner would be capped
    // by the wrong number and never framed.
    if (st.maxWidth !== capPx) st.setProperty("max-width", capPx, "important");
    // Re-asserted every pass, not just on first tag: setting it once meant any
    // later clear (a re-tag, an unstyle mid-flight) left the frame behind with
    // no fill.
    if (!best.dataset[PADDED] || !st.backgroundImage) {
      best.dataset[PADDED] = "1";
      st.setProperty("background", "linear-gradient(180deg,#1a2568 0%,#0e1442 60%,#070b2a 100%)", "important");
      st.setProperty("border", "2px solid #ffffff", "important");
      st.setProperty("border-bottom", "0", "important");
      st.setProperty("border-radius", "7px 7px 0 0", "important");
      st.setProperty("color", "#ffffff", "important");
      // The element is a bare flex row — its horizontal padding lived on the
      // wrapper we just neutralised, so without this the text sits flush
      // against the new border. box-sizing is border-box app-wide, so this
      // costs no extra width against the cap.
      st.setProperty("padding", "4px 12px", "important");
      st.setProperty("box-sizing", "border-box", "important");
    }
  }

  function unstyleBanner(el) {
    if (!el) return;
    for (const w of document.querySelectorAll("[data-ff-banner-wrap]")) {
      w.style.removeProperty("background");
      w.style.removeProperty("box-shadow");
      w.style.removeProperty("border-color");
      delete w.dataset[WRAP];
    }
    for (const prop of ["max-width", "background", "border", "border-bottom",
                        "border-radius", "color", "padding", "padding-right",
                        "box-sizing"]) {
      el.style.removeProperty(prop);
    }
    delete el.dataset[PADDED];
  }

  function clearBannerPadding() {
    document.querySelectorAll("[data-ff-party-pad]").forEach(unstyleBanner);
    styledBanner = null;
  }

  /**
   * gemini only: input-container ships an opaque #0f0f0f of its own that
   * reads as a black band across the viewport bottom. Its utility classes
   * shift between builds (input-gradient / ui-improvements-phase-1 / …), and
   * at least one build beat every stylesheet-level override live — inline
   * importance is the one paint-proof lever, so the stamp happens here.
   * Cleared when the theme goes off (clearGeminiPaint), like every other
   * injected change.
   */
  let geminiSweepAt = -Infinity;   // throttle for the wide geometric sweep below

  function syncGeminiShell() {
    if (SITE !== "gemini") return;
    // input-container's own #0f0f0f, by name — the known offender.
    const ic = document.querySelector("input-container");
    if (ic && !ic.dataset.ffShellClear) {
      ic.style.setProperty("background", "transparent", "important");
      ic.dataset.ffShellClear = "1";
    }
    // And a measured sweep for whatever else paints the bottom strip: the
    // app fades the chat into the composer with generated gradient divs
    // whose classes shift per build, and on the transparent theme those
    // fades render as a black band. Probe the strip, pin any WIDE painter
    // found there — same philosophy as the claude banner hunter: geometry
    // over class-name guessing. Our own window (.input-area-container, a
    // fieldset before the 2026-10 Gemini 4 build and a div since) and
    // everything inside it are exempt, as is anything this script made;
    // inline importance wins every cascade war, so a miss here would wipe
    // the composer's own window fill.
    // The scroll-fade: the overlay strip the chat disappears behind at the
    // bottom. elementFromPoint can NEVER find it — overlay fades are
    // pointer-events:none and hit-testing skips them — which is how it
    // survived three rounds of point-probing. So it is found by geometry
    // instead: any wide, short element sitting in the viewport's lower
    // third whose computed paint is a gradient or an opaque dark gets
    // repainted as a night-sky fade (gradients) or glass (solids). Rects
    // are checked before computed styles so the wide sweep stays cheap,
    // and the whole scan is throttled.
    const now = performance.now();
    if (now - geminiSweepAt > 500) {
      geminiSweepAt = now;
      const FADE = "linear-gradient(180deg, rgba(8, 10, 36, 0) 0%, rgba(8, 10, 36, 0.55) 60%, rgba(8, 10, 36, 0.8) 100%)";
      for (const el of document.querySelectorAll("bard-sidenav-content div, bard-sidenav-content span, input-container, input-container div")) {
        if (el.dataset.ffShellClear) continue;
        if (el.closest(".input-area-container") || /(^|\s)ff-/.test(String(el.className))) continue;
        const r = el.getBoundingClientRect();
        if (r.width < innerWidth * 0.35 || r.height < 8 || r.height > 280) continue;
        if (r.top < innerHeight * 0.55 || r.bottom > innerHeight + 4) continue;
        const cs = getComputedStyle(el);
        const grad = cs.backgroundImage !== "none" && cs.backgroundImage.includes("gradient");
        const solid = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
        if (!grad && !solid) continue;
        el.style.setProperty("background", grad ? FADE : "transparent", "important");
        el.dataset.ffShellClear = "1";
      }
    }

    // The send/submit slot. The box behind the select hand is painted by
    // the bare gem-icon-button WRAPPER (a blue fill fed by our own token
    // overrides — neither "stock dark" nor a gradient, which is how two
    // colour-tested sweeps missed it), and the label is "Submit" on some
    // builds, "Send message" on others, sometimes not on the button at
    // all. So: no colour tests, no label tests — every fill in the known
    // send containers is stripped unconditionally. The stop state opts
    // back out: while a stop button occupies the slot, the strip is undone
    // so the gold stop chip can show.
    const sendRoots = document.querySelectorAll(
      '[data-test-id="send-button-container"], gem-icon-button.send-button, .send-button-container');
    for (const root of sendRoots) {
      const els = [root, ...root.querySelectorAll("*")];
      if (root.querySelector('button[aria-label*="stop" i]')) {
        for (const el of els) {
          if (el.dataset.ffSendClear) {
            el.style.removeProperty("background");
            el.style.removeProperty("border");
            el.style.removeProperty("box-shadow");
            delete el.dataset.ffSendClear;
          }
        }
        continue;
      }
      for (const el of els) {
        if (el.tagName === "MAT-ICON" || el.dataset.ffSendClear) continue;
        el.dataset.ffSendClear = "1";
        el.style.setProperty("background", "transparent", "important");
        el.style.setProperty("border", "0", "important");
        el.style.setProperty("box-shadow", "none", "important");
      }
    }
    // Label-pattern walk. Runs even when the container sweep already
    // stamped the button: the sweep covers the root DOWNWARD, and skipping
    // here left the root's own ANCESTORS painted on one build — the walk
    // is what pins upward.
    for (const b of document.querySelectorAll("input-container button, input-area-v2 button")) {
      const label = b.getAttribute("aria-label") || "";
      if (!/send|submit/i.test(label) || /stop/i.test(label)) continue;
      let el = b;
      for (let i = 0; el && i < 5; i++, el = el.parentElement) {
        if (el.tagName === "INPUT-AREA-V2" || el.classList.contains("trailing-actions-wrapper")) break;
        if (!el.dataset.ffSendClear) {
          el.dataset.ffSendClear = "1";
          el.style.setProperty("background", "transparent", "important");
          el.style.setProperty("border", "0", "important");
          el.style.setProperty("box-shadow", "none", "important");
        }
      }
    }

    // Stamped overlay cards: children keep mounting after the one-shot
    // dress (lazy menu groups), so every pass re-glasses them.
    for (const card of document.querySelectorAll("mat-card[data-ff-menu]")) {
      glassStockDark(card);
    }

    // User bubbles: the truncation affordance draws a dark fade plus a grey
    // chip behind its arrow — both alien inside a menu window. Sweep any
    // painted descendant of the bubble to glass; the arrow glyph survives.
    for (const b of document.querySelectorAll("user-query .user-query-bubble-with-background")) {
      for (const el of b.querySelectorAll("*")) {
        if (el.dataset.ffShellClear) continue;
        const cs = getComputedStyle(el);
        if ((cs.backgroundImage !== "none" && cs.backgroundImage.includes("gradient")) ||
            (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent")) {
          el.style.setProperty("background", "transparent", "important");
          el.dataset.ffShellClear = "1";
        }
      }
    }
  }

  /** Undo every inline change the Gemini sweeps and menu dressing made. */
  function clearGeminiPaint() {
    for (const el of document.querySelectorAll("[data-ff-shell-clear]")) {
      el.style.removeProperty("background");
      delete el.dataset.ffShellClear;
    }
    for (const el of document.querySelectorAll("[data-ff-send-clear]")) {
      el.style.removeProperty("background");
      el.style.removeProperty("border");
      el.style.removeProperty("box-shadow");
      delete el.dataset.ffSendClear;
    }
    for (const el of document.querySelectorAll("[data-ff-menu-glass]")) {
      el.style.removeProperty("background-color");
      delete el.dataset.ffMenuGlass;
    }
    for (const el of document.querySelectorAll("[data-ff-menu]")) {
      el.style.removeProperty("background");
      el.style.removeProperty("opacity");
      delete el.dataset.ffMenu;
    }
  }

  /* ---------------------------------------------------------------- pass */

  // Runs on the core's debounced page pass (DOM changes, scrolls, resizes).
  // The composer is torn down and rebuilt on navigation, so the party is
  // re-homed here rather than injected once.
  function pass() {
    if (!isOn()) return;
    syncGeminiShell();
    // The attribute means "this script is managing the party", not "the
    // party is mounted right now": clearing it while the composer is briefly
    // unmounted during navigation would un-suppress the CSS fallback party
    // and flash a second, static one.
    document.documentElement.setAttribute(PARTY_ATTR, "dom");
    const host = composer();
    watchHost(host);
    if (!host) return;
    // Rebuilt only when the composer itself was replaced, so a member mid-
    // pose on a living composer keeps its animation.
    if (!host.querySelector(":scope > ." + PARTY_CLASS)) {
      document.querySelectorAll("." + PARTY_CLASS).forEach((n) => n.remove());
      buildParty(host);
    }
    // Every pass, not just on build: banners come and go on their own.
    padBannersForParty(host);
  }

  // Resizing the composer (sidebar collapse, a growing input) moves the
  // party's footing without any DOM mutation or window resize.
  const hostRO = new ResizeObserver(() => { if (isOn()) T.schedule(); });
  let observedHost = null;
  function watchHost(h) {
    if (h === observedHost) return;
    if (observedHost) hostRO.unobserve(observedHost);
    if (h) hostRO.observe(h);
    observedHost = h;
  }

  /* ------------------------------------------------------ moogle tooltip */

  // Claude's hover card for the working glyph introduces itself by name. With
  // a moogle standing in, the name should match. Deliberately narrow: it only
  // rewrites that one phrase, and only inside a live tooltip — no blanket
  // find-and-replace over the app's text.
  const MOOGLE_NAME = "Mog";

  function renameInTooltip(node) {
    // "I'm Claude" appears nowhere on chatgpt.com; skip the walk entirely.
    if (SITE !== "claude" || !isOn() || !node || node.nodeType !== 1) return;
    const tips = node.matches?.('[role="tooltip"]') ? [node] : node.querySelectorAll?.('[role="tooltip"]');
    for (const tip of tips || []) {
      const walker = document.createTreeWalker(tip, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = walker.nextNode())) {
        if (/\bI'm Claude\b/.test(t.nodeValue)) {
          t.nodeValue = t.nodeValue.replace(/\bI'm Claude\b/g, "I'm " + MOOGLE_NAME);
        }
      }
    }
  }

  /* ------------------------------------------------------- gemini menus */

  // Gemini's overlay menus (the composer's + menu and its flyouts) are
  // mat-cards whose dark fill comes from a literal rule in a cross-origin
  // sheet, and whose row/label class names drift between A/B builds — CSS
  // kept winning one build and losing the next. So the moment a card mounts
  // in the overlay, it gets the window fill INLINE (unbeatable) and any
  // child that paints its own opaque fill goes glass. The label font rides
  // a data-ff-menu stamp in the stylesheet, where coverage — not the
  // cascade — was ever the problem.
  // Google's neutral surface family (#0f0f0f…#333537) — the fills that read
  // as "unthemed hole". Colours with real hue (selection blues, badge reds)
  // are left alone.
  function isStockDark(c) {
    const m = /^rgba?\((\d+), (\d+), (\d+)/.exec(c || "");
    return !!m && +m[1] < 64 && +m[2] < 64 && +m[3] < 64;
  }

  const OVERLAY_SURFACES = "mat-card, .mat-mdc-dialog-surface, .mdc-dialog__surface";

  /** Glass every stock-dark child of a dressed surface. Re-run freely. */
  function glassStockDark(card) {
    for (const el of card.querySelectorAll("*")) {
      if (el.dataset.ffMenuGlass) continue;
      const cs = getComputedStyle(el);
      if (isStockDark(cs.backgroundColor)) {
        el.dataset.ffMenuGlass = "1";
        el.style.setProperty("background-color", "transparent", "important");
      }
    }
  }

  function dressGeminiMenus(node) {
    if (SITE !== "gemini" || !isOn() || !node || node.nodeType !== 1) return;
    const surfaces = [];
    if (node.matches?.(OVERLAY_SURFACES)) surfaces.push(node);
    node.querySelectorAll?.(OVERLAY_SURFACES).forEach((c) => surfaces.push(c));
    for (const card of surfaces) {
      if (!card.closest(".cdk-overlay-container")) continue;
      if (card.dataset.ffMenu) continue;
      card.dataset.ffMenu = "1";
      const dress = () => {
        card.style.setProperty("background",
          "linear-gradient(180deg, #2f47a8 0%, #16225e 58%, #0b1240 100%)", "important");
        glassStockDark(card);
      };
      // Held invisible until the first fully-dressed frame: dress now (pre
      // paint), then once more a frame later for late classes, THEN reveal.
      // The CSS veil covers the pre-stamp gap; this covers the settling one.
      card.style.setProperty("opacity", "0", "important");
      dress();
      requestAnimationFrame(() => {
        dress();
        requestAnimationFrame(() => {
          dress();
          card.style.removeProperty("opacity");
        });
      });
    }
  }

  /* ------------------------------------------------------- shooting stars */

  // CSS can stagger but it can't randomise: a pure-CSS version would replay the
  // same handful of paths on a fixed cycle, which reads as a loop rather than
  // as weather. Spawning from JS gives a genuinely different angle, position,
  // length and speed each time.
  const STAR_CLASS = "ff-shooting-star";
  const STAR_MIN_GAP = 9000;
  const STAR_MAX_GAP = 27000;

  let starTimer = null;

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function spawnShootingStar() {
    if (!isOn()) return;
    if (document.hidden) return; // don't pile up while the tab is backgrounded
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const star = document.createElement("div");
    star.className = STAR_CLASS;

    // Two families of path so they don't all fall the same way. Each starts
    // off the edge it travels away from, so the entry isn't a pop-in.
    const goRight = Math.random() < 0.5;
    const angle = goRight ? rand(18, 42) : rand(138, 162);
    const startX = goRight ? rand(-15, 55) : rand(45, 115);
    const startY = rand(-8, 28);

    star.style.setProperty("--ang", angle.toFixed(2) + "deg");
    star.style.setProperty("--len", Math.round(rand(90, 220)) + "px");
    star.style.setProperty("--travel", Math.round(rand(70, 130)) + "vw");
    star.style.setProperty("--dur", rand(0.9, 2.1).toFixed(2) + "s");
    star.style.left = startX.toFixed(2) + "vw";
    star.style.top = startY.toFixed(2) + "vh";

    star.addEventListener("animationend", () => star.remove(), { once: true });
    document.body.append(star);
    // Belt and braces: if the animation never fires (tab switch mid-flight),
    // don't leak the node.
    setTimeout(() => star.remove(), 6000);
  }

  function scheduleShootingStar() {
    clearTimeout(starTimer);
    starTimer = setTimeout(() => {
      spawnShootingStar();
      // Occasionally a pair, the way real ones cluster.
      if (Math.random() < 0.18) setTimeout(spawnShootingStar, rand(400, 1400));
      scheduleShootingStar();
    }, rand(STAR_MIN_GAP, STAR_MAX_GAP));
  }

  function syncShootingStars() {
    if (isOn()) {
      if (!starTimer) scheduleShootingStar();
    } else {
      clearTimeout(starTimer);
      starTimer = null;
      document.querySelectorAll("." + STAR_CLASS).forEach((n) => n.remove());
    }
  }

  /* -------------------------------------------------------------- wiring */

  T.register(THEME, {
    start(c) {
      ctx = c;
      on = true;
      for (const [type, fn] of BLIP_LISTENERS) document.addEventListener(type, fn, true);
      scheduleChoco(true);
      syncShootingStars();
    },

    stop() {
      on = false;
      for (const [type, fn] of BLIP_LISTENERS) document.removeEventListener(type, fn, true);
      lastBlipEl = null;
      clearTimeout(chocoTimer);
      chocoTimer = null;
      if (chocoAbort) chocoAbort();
      syncShootingStars();   // clears the timer and any star in flight
      document.querySelectorAll("." + PARTY_CLASS).forEach((n) => n.remove());
      document.documentElement.removeAttribute(PARTY_ATTR);
      clearBannerPadding();
      clearGeminiPaint();
      watchHost(null);
    },

    update(c) {
      ctx = c;   // option changes are read live (soundsOn) or by CSS
    },

    pass,

    added(el) {
      renameInTooltip(el);
      dressGeminiMenus(el);
      // Children of an already-dressed surface mount in waves (menu groups
      // arrive after the card). Glassing them here, in the observer's
      // microtask BEFORE the browser paints, keeps them from flashing their
      // stock dark for a beat.
      const card = el.closest && el.closest("[data-ff-menu]");
      if (card) glassStockDark(card);
    },

    // The popup's chocobo buttons: arg is a variant ("a" | "b" | "c") or
    // { variant, dur } (the smoke tests shorten the run).
    action(name, arg) {
      if (name !== "choco") return;
      const v = arg && typeof arg === "object" ? arg : { variant: arg };
      runChoco(v.variant || "abc"[Math.floor(Math.random() * 3)], v.dur);
    },
  });
})();
