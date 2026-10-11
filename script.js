(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EVENT_START = Date.parse("2026-12-27T18:00:00+05:30");
  var VOLUME = 0.4;

  var envScreen = document.getElementById("envelopeScreen");
  var envelope = document.getElementById("envelope");
  var main = document.getElementById("main");
  var musicBtn = document.getElementById("musicBtn");
  var song = document.getElementById("song");

  /* ================= Music ================= */
  var ctx = null, master = null, mode = null, playing = false, wantPlaying = false;
  var synth = { timer: null, next: 0, step: 0, drone: [] };

  function fadeTo(value, seconds) {
    if (!master) return;
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(value, t + seconds);
  }

  function setupContext() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    // unlock iOS with a silent buffer inside the user gesture
    var b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, 22050);
    b.connect(ctx.destination);
    b.start(0);
    if (ctx.resume) ctx.resume();
    return true;
  }

  function startMusic() {
    var hasCtx = setupContext();
    var mediaSource = null;
    if (hasCtx) {
      try { mediaSource = ctx.createMediaElementSource(song); mediaSource.connect(master); } catch (e) { mediaSource = null; }
    }
    if (!mediaSource) song.volume = 0; // no Web Audio: fade with element volume

    var p = song.play();
    var onOk = function () {
      mode = "file";
      setPlaying(true);
      if (mediaSource) fadeTo(VOLUME, 2.5); else fadeElement(VOLUME, 2500);
    };
    var onFail = function () {
      if (!hasCtx || mode === "synth") return;
      mode = "synth";
      startSynth();
      setPlaying(true);
      fadeTo(VOLUME, 3);
    };
    if (p && p.then) p.then(onOk, onFail); else onOk();
    song.addEventListener("error", onFail, { once: true });
  }

  function fadeElement(target, ms) {
    var from = song.volume, t0 = performance.now();
    (function tick(now) {
      var k = Math.min(1, (now - t0) / ms);
      song.volume = from + (target - from) * k;
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  /* Fallback: soft Raag Bhupali (pentatonic) phrases over a tanpura-like drone */
  var SA = 293.66; // D4
  var SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  var PHRASES = [
    [0, 1, 2, 3, 2, 1, 0, -1],
    [2, 3, 4, 5, 4, 3, 2, -1],
    [5, 4, 3, 2, 3, 2, 1, 0],
    [0, 2, 3, 4, 6, 5, 4, -1],
    [5, 6, 7, 6, 5, 4, 3, 2],
    [3, 2, 1, 0, 1, 2, 0, -1]
  ];
  var BEAT = 0.62;

  function freq(deg, octave) { return SA * Math.pow(2, (SCALE[deg] + 12 * (octave || 0)) / 12); }

  function buildEcho() {
    var delay = ctx.createDelay(2);
    delay.delayTime.value = BEAT * 1.5;
    var fb = ctx.createGain(); fb.gain.value = 0.32;
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
    delay.connect(lp); lp.connect(fb); fb.connect(delay);
    var wet = ctx.createGain(); wet.gain.value = 0.35;
    lp.connect(wet); wet.connect(master);
    return delay;
  }

  function pluck(f, when, dur, level, echo) {
    var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o1.type = "sine"; o1.frequency.value = f;
    o2.type = "triangle"; o2.frequency.value = f * 2;
    var g2 = ctx.createGain(); g2.gain.value = 0.18;
    o1.connect(g); o2.connect(g2); g2.connect(g);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    g.connect(master); g.connect(echo);
    o1.start(when); o2.start(when); o1.stop(when + dur + 0.05); o2.stop(when + dur + 0.05);
  }

  function startSynth() {
    var echo = buildEcho();
    // drone: low Sa, Pa and Sa
    [[SA / 2, 0.05], [SA * 0.75, 0.03], [SA, 0.025]].forEach(function (d, i) {
      var o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = "sine"; o.frequency.value = d[0];
      g.gain.value = d[1];
      lfo.frequency.value = 0.12 + i * 0.05; lg.gain.value = d[1] * 0.5;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(master);
      o.start(); lfo.start();
      synth.drone.push(o, lfo);
    });
    synth.next = ctx.currentTime + 0.3;
    synth.timer = setInterval(function () {
      while (synth.next < ctx.currentTime + 1.2) {
        var phrase = PHRASES[Math.floor(synth.step / 8) % PHRASES.length];
        var deg = phrase[synth.step % 8];
        if (deg >= 0) {
          var len = (synth.step % 8 === 7 || synth.step % 8 === 6) ? 2.6 : 1.5;
          pluck(freq(deg), synth.next, len, 0.16 + Math.random() * 0.04, echo);
        }
        synth.step++;
        // gentle rubato and a breath at each phrase end
        synth.next += BEAT * (synth.step % 8 === 0 ? 2 : 1) * (0.94 + Math.random() * 0.12);
      }
    }, 200);
  }

  function setPlaying(on) {
    playing = on; wantPlaying = on;
    musicBtn.setAttribute("aria-pressed", on ? "true" : "false");
    musicBtn.setAttribute("aria-label", on ? "Pause music" : "Play music");
  }

  function pauseMusic() {
    if (mode === "file") {
      if (master) { fadeTo(0, 0.4); setTimeout(function () { if (!playing) song.pause(); }, 420); }
      else song.pause();
    } else if (mode === "synth") {
      fadeTo(0, 0.4); setTimeout(function () { if (!playing) ctx.suspend(); }, 420);
    }
  }

  function resumeMusic() {
    if (ctx && ctx.state === "suspended") ctx.resume();
    if (mode === "file") { song.play(); if (master) fadeTo(VOLUME, 1); else song.volume = VOLUME; }
    else if (mode === "synth") fadeTo(VOLUME, 1);
  }

  musicBtn.addEventListener("click", function () {
    if (!mode) return;
    if (playing) { setPlaying(false); pauseMusic(); }
    else { setPlaying(true); resumeMusic(); }
  });

  // pause when the tab/app goes to the background, resume when back
  document.addEventListener("visibilitychange", function () {
    if (!mode || !wantPlaying) return;
    if (document.hidden) { playing = false; pauseMusic(); }
    else { playing = true; resumeMusic(); }
  });

  /* ================= Envelope ================= */
  var opened = false;
  function openEnvelope() {
    if (opened) return;
    opened = true;
    startMusic(); // inside the tap: satisfies autoplay rules
    envelope.classList.add("is-open");
    envScreen.classList.add("is-opening");
    var wait = reduceMotion ? 150 : 1900;
    setTimeout(function () {
      envScreen.classList.add("is-gone");
      document.body.classList.remove("is-locked");
      main.removeAttribute("aria-hidden");
      main.classList.add("is-visible");
      musicBtn.hidden = false;
      window.scrollTo(0, 0);
      startPetals();
      setTimeout(function () { envScreen.remove(); }, 1000);
    }, wait);
  }
  envelope.addEventListener("click", openEnvelope);

  /* ================= Petals ================= */
  function startPetals() {
    if (reduceMotion) return;
    var box = document.getElementById("petals");
    var count = window.innerWidth < 500 ? 10 : 16;
    for (var i = 0; i < count; i++) {
      var p = document.createElement("span");
      p.className = "petal";
      var size = 8 + Math.random() * 8;
      p.style.left = (Math.random() * 100) + "vw";
      p.style.width = size + "px";
      p.style.height = (size * 1.3) + "px";
      p.style.opacity = (0.45 + Math.random() * 0.4).toFixed(2);
      p.style.setProperty("--sway", (Math.random() * 80 - 40).toFixed(0) + "px");
      p.style.animationDuration = (11 + Math.random() * 10).toFixed(1) + "s";
      p.style.animationDelay = (-Math.random() * 20).toFixed(1) + "s";
      box.appendChild(p);
    }
  }

  /* ================= Reveal on scroll ================= */
  var reveals = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ================= Countdown ================= */
  var els = {
    d: document.getElementById("cd-d"), h: document.getElementById("cd-h"),
    m: document.getElementById("cd-m"), s: document.getElementById("cd-s")
  };
  var timerBox = document.getElementById("timer"), begun = document.getElementById("begun");
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function tickCountdown() {
    var diff = EVENT_START - Date.now();
    if (diff <= 0) {
      timerBox.hidden = true; begun.hidden = false;
      clearInterval(cdTimer);
      return;
    }
    var s = Math.floor(diff / 1000);
    els.d.textContent = Math.floor(s / 86400);
    els.h.textContent = pad(Math.floor(s % 86400 / 3600));
    els.m.textContent = pad(Math.floor(s % 3600 / 60));
    els.s.textContent = pad(s % 60);
  }
  var cdTimer = setInterval(tickCountdown, 1000);
  tickCountdown();

  /* ================= Add to Calendar (.ics) ================= */
  document.getElementById("calBtn").addEventListener("click", function () {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Ghosh Family//Wedding Reception//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:sayon-gabrielle-reception-20261227@ghoshfamily",
      "DTSTAMP:" + stamp,
      "DTSTART:20261227T123000Z", // 18:00 IST
      "DTEND:20261227T163000Z",   // 22:00 IST
      "SUMMARY:Wedding Reception — Sayon & Gabrielle",
      "LOCATION:Barokuthi Rajbari\\, 64/B\\, Khudiram Bose Sarani\\, Near SBI Bank\\, Milk Colony\\, Belgachia\\, Kolkata – 700037",
      "DESCRIPTION:Wedding Reception (Bou Bhaat) of Sayon & Gabrielle Ghosh. 6:00 PM onwards.\\nDirections: https://www.google.com/maps/search/?api=1&query=Barokuthi+Rajbari+Belgachia+Kolkata\\nContact: 9903912505 / 9007939890",
      "BEGIN:VALARM",
      "TRIGGER:-PT3H",
      "ACTION:DISPLAY",
      "DESCRIPTION:Sayon & Gabrielle's Wedding Reception this evening",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "Sayon-Gabrielle-Reception.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });
})();
