/* Mix Studio (hidden: press and hold the MIX switch). Pick two songs, slide each one under the blend window, choose how long it lasts, preview it, save it. */
(function(){
  var AV = window.AV = window.AV || {}, U = AV.util, clamp = U.clamp;
  var root, cv, ctx, A = null, B = null, WA = null, WB = null, o = { a: 0, b: 0, beats: 32 }, saved = false, raf = 0, openS = false, pickFor = null;
  var els = {};
  var BARS = [2, 4, 8, 16];
  function F(){ return AV.fx; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(s){ s = Math.max(0, s); var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  function allTracks(){ var l = []; AV.store.albums.forEach(function(a){ l = l.concat(AV.store.tracksOf(a.id)); }); return l; }
  function an(t){ return t ? F().analysisOf(t.id) : null; }
  function dur(t){ var a = an(t); return (a && a.d) || (t && t.dur) || 0; }
  function secs(){ var a = an(A); return o.beats * (a && a.bpm ? 60 / a.bpm : .5); }
  function rate(){ var pl = A && B ? F().planFor(A, B, o, dur(A)) : null; return pl && pl.rate || 1; }

  function build(){
    root = document.getElementById('studio');
    root.innerHTML =
      '<div class="st-top"><button class="round" id="st-x" type="button" aria-label="Close"><svg class="ic"><use href="#i-x"/></svg></button><b>Mix Studio</b><button class="st-auto" id="st-auto" type="button">Auto</button></div>' +
      '<button class="st-card" id="st-ca" type="button"></button>' +
      '<div class="st-stage"><canvas id="st-cv"></canvas><div class="st-load" id="st-load" hidden>Reading the songs…</div><button class="st-bars" id="st-bars" type="button"></button></div>' +
      '<button class="st-card" id="st-cb" type="button"></button>' +
      '<div class="st-ctl"><div class="st-step"><span>Song 1 leaves at</span><div><button type="button" data-k="a-">−1 beat</button><b id="st-ta">0:00</b><button type="button" data-k="a+">+1 beat</button></div></div>' +
      '<div class="st-step"><span>Song 2 comes in at</span><div><button type="button" data-k="b-">−1 beat</button><b id="st-tb">0:00</b><button type="button" data-k="b+">+1 beat</button></div></div></div>' +
      '<div class="st-bot"><button class="st-prev" id="st-prev" type="button"><svg class="ic fill"><use href="#i-play"/></svg><span>Preview</span></button><button class="st-save" id="st-save" type="button">Save mix</button></div>' +
      '<div class="st-pick" id="st-pick" hidden><div class="st-ph"><b id="st-pt">Pick a song</b><button class="st-auto" id="st-pc" type="button">Cancel</button></div><input id="st-pq" type="search" placeholder="Search songs" autocomplete="off"><div class="st-pl" id="st-pl"></div></div>';
    cv = document.getElementById('st-cv'); ctx = cv.getContext('2d');
    ['st-ca', 'st-cb', 'st-bars', 'st-ta', 'st-tb', 'st-prev', 'st-save', 'st-load', 'st-pick', 'st-pl', 'st-pq', 'st-pt'].forEach(function(id){ els[id] = document.getElementById(id); });
    document.getElementById('st-x').addEventListener('click', close);
    document.getElementById('st-auto').addEventListener('click', autoPlan);
    els['st-ca'].addEventListener('click', function(){ openPick('a'); });
    els['st-cb'].addEventListener('click', function(){ openPick('b'); });
    document.getElementById('st-pc').addEventListener('click', function(){ els['st-pick'].hidden = true; });
    els['st-pq'].addEventListener('input', paintPick);
    els['st-bars'].addEventListener('click', function(){ var cur = o.beats / 4, i = BARS.indexOf(cur); o.beats = BARS[(i + 1) % BARS.length] * 4; clampO(); sync(); });
    root.querySelector('.st-ctl').addEventListener('click', function(e){
      var k = e.target.getAttribute && e.target.getAttribute('data-k'); if (!k) return;
      var x = an(k[0] === 'a' ? A : B), pb = x && x.bpm ? 60 / x.bpm : .5, d = k[1] === '+' ? pb : -pb;
      if (k[0] === 'a') o.a += d; else o.b += d; snap(k[0]); clampO(); sync();
    });
    els['st-prev'].addEventListener('click', preview);
    els['st-save'].addEventListener('click', save);
    /* drag a song sideways to choose where it sits under the blend window */
    var drag = null;
    cv.addEventListener('pointerdown', function(e){
      var r = cv.getBoundingClientRect(), lane = (e.clientY - r.top) < r.height / 2 ? 'a' : 'b';
      drag = { lane: lane, x: e.clientX, v: lane === 'a' ? o.a : o.b }; try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    });
    cv.addEventListener('pointermove', function(e){
      if (!drag) return; var g = geo(), dt = (e.clientX - drag.x) / g.pxs * (drag.lane === 'b' ? rate() : 1);
      if (drag.lane === 'a') o.a = drag.v - dt; else o.b = drag.v - dt; clampO(); push();
    });
    function up(){ if (!drag) return; var l = drag.lane; drag = null; snap(l); clampO(); sync(); }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    if (window.ResizeObserver) new ResizeObserver(size).observe(cv.parentNode);
  }
  function size(){ var r = cv.parentNode.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; }
  function snap(l){
    var x = an(l === 'a' ? A : B); if (!x || !x.bpm) return; var pb = 60 / x.bpm, p = l === 'a' ? x.p1 : x.p0; if (p == null) return;
    if (l === 'a') o.a = p + Math.round((o.a - p) / pb) * pb; else o.b = p + Math.round((o.b - p) / pb) * pb;
  }
  function clampO(){
    if (!A || !B) return; var s = secs(), r = rate();
    var bpmOK = an(A) && an(A).bpm; if (!bpmOK){ o.beats = o.beats; }
    o.a = clamp(o.a, 0, Math.max(0, dur(A) - s - .3)); o.b = clamp(o.b, 0, Math.max(0, dur(B) - s * r - .3));
  }
  function push(){ if (A && B){ F().setOverride(A.id, B.id, { a: o.a, b: o.b, beats: o.beats, keep: !!(F().getOverride(A.id, B.id) || {}).keep }); } paintTexts(); }
  function sync(){ push(); }
  function geo(){ var s = secs(), pad = Math.max(s * .55, 10), span = s + 2 * pad, w = cv.width / (Math.min(2, window.devicePixelRatio || 1)); return { s: s, pad: pad, span: span, pxs: w / span, w: w, h: cv.height / (Math.min(2, window.devicePixelRatio || 1)) }; }

  function badge(t){
    var a = an(t), sp = a && a.sp, c = sp && sp.camelot, hue = c ? (parseInt(c, 10) * 30 + 200) % 360 : 0;
    return '<div class="st-meta"><span>' + (a && a.bpm ? Math.round(a.bpm) + ' bpm' : '— bpm') + '</span><span><i class="st-key" style="background:' + (c ? 'hsl(' + hue + ',75%,62%)' : 'rgba(255,255,255,.2)') + '">' + (c || '—') + '</i>' + fmt(dur(t)) + '</span></div>';
  }
  function card(t, el, hint){
    if (!t){ el.innerHTML = '<div class="st-art"></div><div class="st-ti"><b>' + hint + '</b><small>Tap to choose</small></div>'; return; }
    var al = AV.store.album(t.albumId), pal = al ? AV.palette(al) : null;
    el.innerHTML = '<div class="st-art" style="background:linear-gradient(135deg,' + (pal ? pal.bar : '#888') + ',' + (pal ? pal.deep : '#333') + ')"></div><div class="st-ti"><b>' + esc(t.title) + '</b><small>' + esc(t.artist || (al && al.artist) || '') + '</small></div>' + badge(t);
  }
  function paintTexts(){
    if (els['st-ta']){ els['st-ta'].textContent = fmt(o.a); els['st-tb'].textContent = fmt(o.b); els['st-bars'].textContent = (o.beats / 4) + ' bars'; }
  }
  function paintCards(){ card(A, els['st-ca'], 'Song 1'); card(B, els['st-cb'], 'Song 2'); paintTexts(); }

  /* ---- drawing ---- */
  function lane(W, y0, h, g, startT, dir, rateK, from, isA){
    var d = dur(isA ? A : B), n = W ? W.n : 0, x, px = g.w;
    var cy = y0 + h / 2, amp = h * .46;
    for (x = 0; x < px; x += 2){
      var mixT = x / g.pxs - g.pad, tt = startT + mixT * rateK, inFrame = mixT >= 0 && mixT <= g.s;
      if (tt < 0 || tt > d || !W) continue;
      var bi = Math.min(n - 1, Math.floor(tt / W.d * n)), hi = W.hi[bi] * amp, lo = W.lo[bi] * amp;
      ctx.globalAlpha = inFrame ? 1 : .42;
      ctx.fillStyle = '#c47a35'; ctx.fillRect(x, cy - hi, 1.6, hi * 2);
      ctx.fillStyle = '#2a3fd6'; ctx.fillRect(x, cy - Math.min(hi, lo * 1.05), 1.6, Math.min(hi, lo * 1.05) * 2);
      ctx.fillStyle = '#f6efe2'; ctx.fillRect(x, cy - hi * .38, 1.6, hi * .76);
    }
    ctx.globalAlpha = 1;
  }
  function draw(){
    raf = requestAnimationFrame(draw); if (!openS || !cv.width) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), g = geo(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.w, g.h);
    var hh = g.h / 2, r = rate();
    lane(WA, 0, hh, g, o.a, 1, 1, 0, true); lane(WB, hh, hh, g, o.b, 1, r, 0, false);
    var x0 = g.pad * g.pxs, x1 = (g.pad + g.s) * g.pxs;
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x0, 0, x1 - x0, g.h);
    ctx.strokeStyle = 'rgba(120,190,255,.9)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    /* faders: song 1 goes down, song 2 comes up; bass swaps at the middle */
    var N = 28, i, ya = function(v, top){ return top + (1 - v) * (hh - 14) + 7; };
    ctx.beginPath(); for (i = 0; i <= N; i++){ var u = i / N, v = Math.cos(u * Math.PI / 2); ctx[i ? 'lineTo' : 'moveTo'](x0 + u * (x1 - x0), ya(v, 0)); } ctx.stroke();
    ctx.beginPath(); for (i = 0; i <= N; i++){ var u2 = i / N, v2 = Math.sin(u2 * Math.PI / 2); ctx[i ? 'lineTo' : 'moveTo'](x0 + u2 * (x1 - x0), ya(v2, hh)); } ctx.stroke();
    var xm = (x0 + x1) / 2; ctx.strokeStyle = 'rgba(120,190,255,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, ya(1, 0) + 2); ctx.lineTo(xm, ya(1, 0) + 2); ctx.lineTo(xm, ya(.05, 0)); ctx.lineTo(x1, ya(.05, 0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, ya(.05, hh)); ctx.lineTo(xm, ya(.05, hh)); ctx.lineTo(xm, ya(1, hh) + 2); ctx.lineTo(x1, ya(1, hh) + 2); ctx.stroke();
    /* playhead */
    var P = AV.player, cur = P.cur(), el = P.el(), mt = null;
    if (cur && A && B && el && (P.ctx === 'Mix Studio')){
      var mv = P.mixView && P.mixView();
      if (cur.id === A.id) mt = el.currentTime - o.a; else if (cur.id === B.id) mt = (el.currentTime - o.b) / r;
    }
    if (mt != null && mt > -g.pad && mt < g.s + g.pad){ ctx.fillStyle = '#3dff7a'; ctx.shadowColor = '#3dff7a'; ctx.shadowBlur = 8; ctx.fillRect((mt + g.pad) * g.pxs - 1, 0, 2.5, g.h); ctx.shadowBlur = 0; }
    var pv = els['st-prev']; if (pv){ var pl = P.playing && P.ctx === 'Mix Studio'; pv.classList.toggle('on', pl); pv.querySelector('span').textContent = pl ? 'Stop' : 'Preview'; }
  }

  /* ---- actions ---- */
  function autoPlan(){
    if (!A || !B) return; F().clearOverride(A.id, B.id);
    var pl = F().plan(A, B, dur(A));
    if (pl.type === 'dj'){ o = { a: pl.aStart, b: pl.bStart, beats: pl.beats }; } else { var a = an(A), pb = a && a.bpm ? 60 / a.bpm : .5; o = { a: Math.max(0, dur(A) - 16 * pb - 4), b: (an(B) && an(B).st) || 0, beats: 32 }; }
    saved = false; clampO(); push(); AV.ui.toast('Back to the automatic mix', 1800);
  }
  function setSongs(a, b){
    A = a; B = b; saved = false; WA = WB = null;
    if (A && B){
      var ov = F().getOverride(A.id, B.id);
      if (ov){ o = { a: ov.a, b: ov.b, beats: ov.beats || 32 }; } else autoPlan();
      saved = !!(ov && ov.keep); clampO(); push();
    }
    paintCards();
    els['st-load'].hidden = false; var n = 0, fin = function(){ if (++n === 2) els['st-load'].hidden = true; };
    if (A) F().wave(A).then(function(w){ WA = w; fin(); }); else fin();
    if (B) F().wave(B).then(function(w){ WB = w; fin(); }); else fin();
    var need = [A, B].filter(Boolean); try { F().analyseMany(need); } catch (e) {}
    setTimeout(function(){ if (openS){ paintCards(); if (A && B && !saved){ var ov2 = F().getOverride(A.id, B.id); if (!ov2 || !ov2.keep) autoPlanSoft(); } } }, 3500);
  }
  function autoPlanSoft(){ /* once the songs have been measured, take the automatic choice unless the person already moved things */
    if (!A || !B || !an(A) || !an(B)) return; var pl = F().plan(A, B, dur(A)); if (pl.type === 'dj' && !pl.manual){ o = { a: pl.aStart, b: pl.bStart, beats: pl.beats }; clampO(); push(); }
  }
  function preview(){
    var P = AV.player; if (!A || !B) return;
    if (P.playing && P.ctx === 'Mix Studio'){ P.pause(); return; }
    var Fx = F(); if (Fx.settings.xmode !== 'dj') Fx.set({ xmode: 'dj' });
    push(); P.playList([A, B], A, 'Mix Studio', false, true); P.seek(Math.max(0, o.a - 9));
  }
  function save(){
    if (!A || !B) return; F().setOverride(A.id, B.id, { a: o.a, b: o.b, beats: o.beats, keep: true }); saved = true;
    AV.ui.toast('Saved. Whenever this song is followed by the other, it will blend like this.', 3200);
  }
  function openPick(which){
    pickFor = which; els['st-pt'].textContent = which === 'a' ? 'Song 1: what plays first' : 'Song 2: what comes next'; els['st-pq'].value = ''; paintPick(); els['st-pick'].hidden = false;
  }
  function paintPick(){
    var q = els['st-pq'].value.trim().toLowerCase(), list = allTracks().filter(function(t){ var al = AV.store.album(t.albumId); return !q || (t.title + ' ' + (t.artist || '') + ' ' + (al ? al.title : '')).toLowerCase().indexOf(q) >= 0; });
    list.sort(function(a, b){ return String(a.title).localeCompare(String(b.title)); });
    els['st-pl'].innerHTML = list.slice(0, 150).map(function(t, i){ var al = AV.store.album(t.albumId); return '<button type="button" data-i="' + i + '"><b>' + esc(t.title) + '</b><small>' + esc((t.artist || (al && al.artist) || '') + (al ? ' · ' + al.title : '')) + '</small></button>'; }).join('') || '<p class="st-none">No songs found</p>';
    els['st-pl'].onclick = function(e){ var b = e.target.closest && e.target.closest('button[data-i]'); if (!b) return; var t = list[+b.getAttribute('data-i')]; els['st-pick'].hidden = true; if (pickFor === 'a') setSongs(t, B && B.id !== t.id ? B : null); else setSongs(A && A.id !== t.id ? A : null, t); };
  }
  function open(){
    if (!root) build();
    var P = AV.player, cur = P.cur(), all = allTracks(); if (all.length < 2){ AV.ui.toast('Add some songs first'); return; }
    var nx = null; if (cur){ var i = P.order.indexOf(P.list.indexOf(cur)); var nt = P.list[P.order[i + 1]]; if (nt && nt.id !== cur.id) nx = nt; }
    var a = cur || all[0], b = nx || all.filter(function(t){ return t.id !== a.id; })[0];
    root.hidden = false; void root.offsetWidth; root.classList.add('open'); openS = true; size(); setSongs(a, b); cancelAnimationFrame(raf); draw();
  }
  function close(){
    openS = false; cancelAnimationFrame(raf); root.classList.remove('open'); setTimeout(function(){ if (!openS) root.hidden = true; }, 600);
    var P = AV.player; if (P.ctx === 'Mix Studio' && P.playing) P.pause();
    if (A && B && !saved) F().dropTemp(A.id, B.id);
  }
  AV.studio = { open: open, close: close };
})();
