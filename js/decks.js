/* Two-deck DJ mixer (inside the Mix Studio): independent decks, crossfader, cue, loop, sync, tempo, bass cut, key check, auto mix. */
(function(){
  var AV = window.AV = window.AV || {}, U = AV.util, clamp = U.clamp;
  var pane, cv, ctx, raf = 0, active = false, D = [null, null], x = .5, fadeSecs = 8, anim = 0, bassSwap = true, refs = {}, lastSlow = 0, lastDraw = 0, drag = null, pickFn = null;
  var LOOPS = [1, 2, 4, 8];
  function F(){ return AV.fx; }
  function fmt(s){ s = Math.max(0, s || 0); var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mkDeck(){ return { t: null, el: null, w: null, an: null, cue: 0, loop: null, loopN: 2, vol: 1, kill: false }; }
  function bi(d){ var a = d.an; if (!a || !a.bpm) return null; var near = d.el && d.el.duration && d.el.currentTime > d.el.duration / 2 && a.p1 != null; return { bpm: a.bpm, p: near ? a.p1 : (a.p0 || 0) }; }
  function toast(m){ try { AV.ui.toast(m, 2600); } catch (e) {} }

  /* crossfader: song 1 full on the left half, song 2 full on the right half, both full in the middle, smooth equal-power fades between */
  function curve(v){ return v >= .5 ? 1 : Math.sin(v * Math.PI); }
  function apply(){
    if (!D[0] || !D[1]) return;
    [0, 1].forEach(function(i){ var d = D[i]; if (d.el) F().deckGain(d.el, d.vol * (i === 0 ? curve(1 - x) : curve(x))); });
    if (refs.xf) refs.xf.value = Math.round(x * 1000);
  }
  function setX(v){ x = clamp(v, 0, 1); apply(); }
  function setKill(i, on){ var d = D[i]; d.kill = on; F().deckKill(d.el, on); paintButtons(); }

  function load(i, t){
    var d = D[i]; stopLoop(i); if (d.el) try { d.el.pause(); } catch (e) {}
    d.t = t; d.w = null; d.an = F().analysisOf(t.id); d.cue = 0; d.kill = false; paintCards();
    AV.player.deck.load(i, t).then(function(el){
      d.el = el; apply(); F().deckKill(el, false);
      d.an = F().analysisOf(t.id); d.cue = d.an && d.an.st ? d.an.st : 0; el.currentTime = d.cue; paintCards(); paintButtons();
    }, function(){ toast('That song cannot be loaded'); });
    F().wave(t).then(function(w){ if (D[i].t === t) D[i].w = w; });
    try { F().analyseMany([t]); } catch (e) {}
  }
  function stopLoop(i){ D[i].loop = null; }
  function toggleLoop(i){
    var d = D[i]; if (!d.el) return;
    if (d.loop){ d.loop = null; paintButtons(); return; }
    var b = bi(d), beat = b ? 60 / b.bpm : .5, t = d.el.currentTime;
    if (b) t = b.p + Math.round((t - b.p) / beat) * beat;                                  /* start on a beat */
    d.loop = { s: Math.max(0, t), e: Math.max(0, t) + d.loopN * beat }; paintButtons();
  }
  function togglePlay(i){
    var d = D[i]; if (!d.el) return;
    if (d.el.paused){ var p = d.el.play(); if (p && p.catch) p.catch(function(){}); } else d.el.pause(); paintButtons();
  }
  function sync(slave){
    var m = D[1 - slave], s = D[slave], bm = bi(m), bs = bi(s); if (!m.el || !s.el) return;
    if (!bm || !bs){ toast('Sync needs a steady beat in both songs'); return; }
    var target = bm.bpm * m.el.playbackRate, c = [bs.bpm * .5, bs.bpm, bs.bpm * 2], cb = c[1], e = 9, i;
    for (i = 0; i < 3; i++){ var q = Math.abs(Math.log(c[i] / target)); if (q < e){ e = q; cb = c[i]; } }
    var rate = clamp(target / cb, .92, 1.08); s.el.playbackRate = rate;
    var pm = 60 / bm.bpm, ps = 60 / cb, fr = function(v){ return v - Math.floor(v); };
    var phM = fr((m.el.currentTime - bm.p) / pm), phS = fr((s.el.currentTime - bs.p) / ps), diff = phM - phS;
    if (diff > .5) diff -= 1; if (diff < -.5) diff += 1;
    try { s.el.currentTime = Math.max(0, s.el.currentTime + diff * ps); } catch (er) {}
    if (Math.abs(rate - 1) < .0005) rate = 1;
    paintTempo(slave);
    toast('Synced · ' + (bm.bpm * m.el.playbackRate).toFixed(1) + ' BPM');
  }
  function setTempo(i, pct){ var d = D[i]; if (!d.el) return; d.el.playbackRate = 1 + clamp(pct, -8, 8) / 100; paintTempo(i); }
  function paintTempo(i){
    var d = D[i], r = refs['t' + i]; if (!r || !d.el) return; var pct = (d.el.playbackRate - 1) * 100; r.range.value = Math.round(pct * 10);
    var b = d.an && d.an.bpm; r.out.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' + (b ? ' · ' + (b * d.el.playbackRate).toFixed(1) : '');
  }
  function autoMix(){
    if (!D[0].el || !D[1].el){ toast('Load a song on both decks first'); return; }
    cancelAnimationFrame(anim);
    var pa = !D[0].el.paused, pb = !D[1].el.paused, to = pa && !pb ? 1 : pb && !pa ? 0 : (x < .5 ? 1 : 0), src = D[1 - to], tgt = D[to];
    if (src.el.paused){ togglePlay(1 - to); }
    if (tgt.el.paused){ sync(to); var p = tgt.el.play(); if (p && p.catch) p.catch(function(){}); }
    var dur = fadeSecs * 1000, t0 = performance.now(), x0 = x, swapped = false;
    if (bassSwap){ setKill(to, true); }
    (function step(now){
      var k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setX(x0 + (to - x0) * e);
      if (bassSwap && !swapped && k >= .5){ swapped = true; setKill(to, false); setKill(1 - to, true); }
      if (k < 1) anim = requestAnimationFrame(step);
      else { try { src.el.pause(); } catch (er) {} if (bassSwap) setKill(1 - to, false); paintButtons(); }
    })(t0);
    toast('Mixing over ' + fadeSecs + ' s');
  }
  function suggest(){
    var P = AV.player, base = D[0].t || D[1].t; if (!base){ toast('Load a song first'); return; }
    var slot = D[0].t && !D[1].t ? 1 : (D[0].t && D[1].t ? 1 : 0), other = D[1 - slot].t || base, best = null, bs = -1e9, taken = [D[0].t, D[1].t];
    AV.store.tracks.forEach(function(c){ if (taken.indexOf(c) >= 0) return; var s = P.compat(other, c) + Math.random() * .2; if (s > bs){ bs = s; best = c; } });
    if (!best){ toast('No other songs to suggest'); return; }
    load(slot, best); toast('Suggested: ' + best.title);
  }

  /* ---------- screen ---------- */
  function cardHTML(i){
    var d = D[i], t = d.t, a = d.an, sp = a && a.sp;
    if (!t) return '<div class="st-art"></div><div class="st-ti"><b>Deck ' + (i ? 'B' : 'A') + '</b><small>Tap to choose a song</small></div>';
    var al = AV.store.album(t.albumId), pal = al ? AV.palette(al) : null, c = sp && sp.camelot, hue = c ? (parseInt(c, 10) * 30 + 200) % 360 : 0;
    return '<div class="st-art" style="background:linear-gradient(135deg,' + (pal ? pal.bar : '#888') + ',' + (pal ? pal.deep : '#333') + ')"></div><div class="st-ti"><b>' + esc(t.title) + '</b><small>' + esc(t.artist || (al && al.artist) || '') + '</small></div>' +
      '<div class="st-meta"><span>' + (a && a.bpm ? Math.round(a.bpm) + ' bpm' : '— bpm') + '</span><span><i class="st-key" style="background:' + (c ? 'hsl(' + hue + ',75%,62%)' : 'rgba(255,255,255,.2)') + '">' + (c || '—') + '</i>' + fmt(d.el && d.el.duration || (a && a.d) || t.dur) + '</span></div>';
  }
  function paintCards(){ [0, 1].forEach(function(i){ if (refs['c' + i]) refs['c' + i].innerHTML = cardHTML(i); }); paintKey(); }
  function paintKey(){
    var a = D[0].an && D[0].an.sp, b = D[1].an && D[1].an.sp, el = refs.key; if (!el) return;
    if (!a || !b){ el.className = 'dk-key'; el.textContent = D[0].t && D[1].t ? 'Measuring the songs…' : 'Load a song on each deck to check the key'; return; }
    var h = F().harmony(a, b), ok = h >= .85, mid = h >= .45;
    el.className = 'dk-key ' + (ok ? 'ok' : mid ? 'mid' : 'bad');
    var tip = ok ? 'Compatible: these keys blend smoothly.' : mid ? 'Risky: try a short mix or cut the bass.' : 'Clash: keep the mix short, or tap Suggest.';
    el.textContent = a.camelot + ' + ' + b.camelot + ' · ' + tip;
  }
  function paintButtons(){
    [0, 1].forEach(function(i){
      var d = D[i], r = refs['b' + i]; if (!r) return;
      r.play.classList.toggle('on', !!(d.el && !d.el.paused)); r.play.querySelector('span').textContent = d.el && !d.el.paused ? 'Pause' : 'Play';
      r.loop.classList.toggle('on', !!d.loop); r.loop.querySelector('span').textContent = (d.loopN) + (d.loopN === 1 ? ' beat' : ' beats');
      r.bass.classList.toggle('on', d.kill);
    });
    if (refs.swap) refs.swap.classList.toggle('on', bassSwap);
  }
  function deckControls(i){
    var col = document.createElement('div'); col.className = 'dk-col';
    col.innerHTML = '<div class="dk-row"><button data-a="play"><span>Play</span></button><button data-a="cue"><span>Cue</span></button><button data-a="setcue"><span>Set cue</span></button></div>' +
      '<div class="dk-row"><button data-a="loop"><span>2 beats</span></button><button data-a="bass"><span>Bass cut</span></button><button data-a="sync"><span>Sync</span></button></div>' +
      '<label class="dk-sl"><span>Volume</span><input type="range" min="0" max="100" value="100" data-a="vol"></label>' +
      '<label class="dk-sl"><span>Tempo</span><input type="range" min="-80" max="80" step="1" value="0" data-a="tempo"><output>0%</output></label>';
    var q = function(a){ return col.querySelector('[data-a="' + a + '"]'); };
    refs['b' + i] = { play: q('play'), loop: q('loop'), bass: q('bass') }; refs['t' + i] = { range: q('tempo'), out: col.querySelector('output') };
    col.addEventListener('click', function(e){
      var b = e.target.closest('button'); if (!b) return; var d = D[i]; if (!d.el) { toast('Choose a song for this deck first'); return; }
      switch (b.getAttribute('data-a')){
        case 'play': togglePlay(i); break;
        case 'cue': d.el.currentTime = d.cue; break;
        case 'setcue': d.cue = d.el.currentTime; toast('Cue point set'); break;
        case 'loop': toggleLoop(i); break;
        case 'bass': setKill(i, !d.kill); break;
        case 'sync': sync(i); break;
      }
      paintButtons();
    });
    /* a long press on the loop button changes the loop length */
    var lp = q('loop'), th = 0;
    lp.addEventListener('pointerdown', function(){ th = setTimeout(function(){ th = -1; var d = D[i]; d.loopN = LOOPS[(LOOPS.indexOf(d.loopN) + 1) % LOOPS.length]; if (d.loop && d.el){ var b = bi(d), beat = b ? 60 / b.bpm : .5; d.loop.e = d.loop.s + d.loopN * beat; } paintButtons(); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){ lp.addEventListener(ev, function(){ clearTimeout(th); }); });
    lp.addEventListener('click', function(e){ if (th === -1){ th = 0; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    col.addEventListener('input', function(e){
      var a = e.target.getAttribute('data-a'), d = D[i];
      if (a === 'vol'){ d.vol = e.target.value / 100; apply(); }
      if (a === 'tempo' && d.el){ d.el.playbackRate = 1 + e.target.value / 1000; paintTempo(i); }
    });
    return col;
  }
  function geo(){ var w = cv.clientWidth, h = cv.clientHeight; return { w: w, h: h, span: 20, pxs: w / 20 }; }
  function lane(i, y0, h, g){
    var d = D[i]; if (!d.el) return; var W = d.w, t = d.el.currentTime, dur = d.el.duration || 0, rate = d.el.playbackRate || 1, cy = y0 + h / 2, amp = h * .45, px;
    for (px = 0; px < g.w; px += 3){
      var tt = t + (px - g.w / 2) / g.pxs * rate; if (tt < 0 || tt > dur || !W) continue;
      var b = Math.min(W.n - 1, Math.floor(tt / W.d * W.n)), hi = W.hi[b] * amp, lo = W.lo[b] * amp, past = px < g.w / 2;
      var lw = Math.min(hi, lo * 1.05);
      ctx.fillStyle = past ? '#7a4a22' : '#c47a35'; ctx.fillRect(px, cy - hi, 2, hi * 2);
      ctx.fillStyle = past ? '#1a2680' : '#2a3fd6'; ctx.fillRect(px, cy - lw, 2, lw * 2);
      ctx.fillStyle = past ? '#968f86' : '#f6efe2'; ctx.fillRect(px, cy - hi * .38, 2, hi * .76);
    }
    var b0 = bi(d);
    if (b0){ var beat = 60 / b0.bpm, first = Math.ceil((t - g.w / 2 / g.pxs * rate - b0.p) / beat); ctx.fillStyle = 'rgba(255,255,255,.28)';
      for (var k = first; ; k++){ var bt = b0.p + k * beat, xx = g.w / 2 + (bt - t) / rate * g.pxs; if (xx > g.w) break; if (xx >= 0) ctx.fillRect(xx, y0, k % 4 === 0 ? 1.6 : .8, h * (k % 4 === 0 ? 1 : .18)); } }
    if (d.loop){ var xs = g.w / 2 + (d.loop.s - t) / rate * g.pxs, xe = g.w / 2 + (d.loop.e - t) / rate * g.pxs; ctx.fillStyle = 'rgba(61,255,122,.18)'; ctx.fillRect(xs, y0, xe - xs, h); }
    var xc = g.w / 2 + (d.cue - t) / rate * g.pxs; if (xc > -2 && xc < g.w + 2){ ctx.fillStyle = '#ffa23d'; ctx.fillRect(xc - 1, y0, 2.5, h); }
  }
  function draw(now){
    raf = requestAnimationFrame(draw); if (!active || !cv.clientWidth) return;
    if (now - lastDraw < 30) return; lastDraw = now;                  /* about 30 pictures a second is plenty and keeps the phone cool */
    var dpr = 1, g = geo(); if (cv.width !== Math.round(g.w * dpr)){ cv.width = Math.round(g.w * dpr); cv.height = Math.round(g.h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.w, g.h);
    var hh = g.h / 2; lane(0, 0, hh, g); lane(1, hh, hh, g);
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(0, hh - .5, g.w, 1);
    ctx.fillStyle = '#3dff7a'; ctx.fillRect(g.w / 2 - 1, 0, 2, g.h);
    [0, 1].forEach(function(i){ var d = D[i];
      if (d.loop && d.el && !d.el.paused && d.el.currentTime >= d.loop.e - .015){ try { d.el.currentTime = d.loop.s; } catch (e) {} }
    });
    if (now - lastSlow > 1000){ lastSlow = now; [0, 1].forEach(function(i){ var d = D[i]; if (d.t && (!d.an || d.an.v < 3)){ var a = F().analysisOf(d.t.id); if (a && a.v >= 3){ d.an = a; paintCards(); paintTempo(i); } } if (d.el && refs['t' + i] && document.activeElement !== refs['t' + i].range) paintTempo(i); }); paintButtons(); }
  }

  var AD = { open: function(container, pick){
    pane = container; pickFn = pick; active = true;
    if (!refs.built){
      pane.innerHTML = '<button class="st-card" id="dk-c0" type="button"></button><div class="st-stage dk-stage"><canvas id="dk-cv"></canvas></div><button class="st-card" id="dk-c1" type="button"></button>' +
        '<div class="dk-key" id="dk-key"></div><div class="dk-ctl" id="dk-ctl"></div>' +
        '<div class="dk-xf"><div class="dk-xl"><b>A</b><input type="range" id="dk-xf" min="0" max="1000" value="500" aria-label="Crossfader"><b>B</b></div>' +
        '<div class="dk-xr"><button id="dk-auto" type="button">Auto mix</button><button id="dk-len" type="button">8 s</button><button id="dk-swap" type="button" class="on">Bass swap</button><button id="dk-sug" type="button">Suggest</button></div></div>';
      cv = pane.querySelector('#dk-cv'); ctx = cv.getContext('2d');
      refs.c0 = pane.querySelector('#dk-c0'); refs.c1 = pane.querySelector('#dk-c1'); refs.key = pane.querySelector('#dk-key'); refs.xf = pane.querySelector('#dk-xf');
      var ctl = pane.querySelector('#dk-ctl'); ctl.appendChild(deckControls(0)); ctl.appendChild(deckControls(1));
      refs.c0.addEventListener('click', function(){ pickFn('Deck A: choose a song', function(t){ load(0, t); }); });
      refs.c1.addEventListener('click', function(){ pickFn('Deck B: choose a song', function(t){ load(1, t); }); });
      refs.xf.addEventListener('input', function(){ cancelAnimationFrame(anim); setX(refs.xf.value / 1000); });
      pane.querySelector('#dk-auto').addEventListener('click', autoMix);
      refs.swap = pane.querySelector('#dk-swap'); refs.swap.addEventListener('click', function(){ bassSwap = !bassSwap; paintButtons(); });
      var len = pane.querySelector('#dk-len'); len.addEventListener('click', function(){ var o = [4, 8, 16, 32]; fadeSecs = o[(o.indexOf(fadeSecs) + 1) % o.length]; len.textContent = fadeSecs + ' s'; });
      pane.querySelector('#dk-sug').addEventListener('click', suggest);
      /* drag the waveform to move through a song */
      cv.addEventListener('pointerdown', function(e){ var r = cv.getBoundingClientRect(), i = (e.clientY - r.top) < r.height / 2 ? 0 : 1; if (!D[i].el) return; drag = { i: i, x: e.clientX, t: D[i].el.currentTime, was: !D[i].el.paused }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
      cv.addEventListener('pointermove', function(e){ if (!drag) return; var d = D[drag.i], g = geo(); d.el.currentTime = clamp(drag.t - (e.clientX - drag.x) / g.pxs * (d.el.playbackRate || 1), 0, (d.el.duration || 1) - .1); });
      var up = function(){ drag = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      refs.built = true;
    }
    D = [mkDeck(), mkDeck()]; x = 0; refs.xf.value = 0;
    AV.player.deck.enter(); paintCards(); paintButtons();
    /* start with what is playing and the best match for it */
    var P = AV.player, cur = P.cur(); var all = AV.store.tracks;
    if (cur){ load(0, cur); var best = null, bs = -1e9; all.forEach(function(c){ if (c === cur) return; var s = P.compat(cur, c) + Math.random() * .2; if (s > bs){ bs = s; best = c; } }); if (best) load(1, best); }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  }, close: function(){
    active = false; cancelAnimationFrame(raf); cancelAnimationFrame(anim); D = [mkDeck(), mkDeck()];
    try { AV.player.deck.leave(); } catch (e) {}
  } };
  AV.decks = AD;
})();
