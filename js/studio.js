/* Mix Studio (hidden: press and hold the MIX switch). Pick two songs, slide each one under the blend window, choose how long it lasts, preview it, save it. */
(function(){
  var AV = window.AV = window.AV || {}, U = AV.util, clamp = U.clamp;
  var lastDr = 0, root, cv, ctx, mode = 'blend', pickCb = null, A = null, B = null, WA = null, WB = null, o = { a: 0, b: 0, beats: 32, rc: null }, saved = false, raf = 0, openS = false, pickFor = null;
  var els = {}, zoom = 1, ptrs = {}, pinch = null, lockG = null, hist = { u: [], r: [], orig: null }, tuneTab = 'time', editKey = null, nodeDrag = null, lastTap = { t: 0, i: -1, l: '' };
  var BARS = [2, 4, 8, 16];
  var OPT = {
    vol: { t: 'Volume', c: '#0a84ff', l: { custom: 'Custom', overlap: 'Overlap', fadefade: 'Fade in fade out', cutfade: 'Cut in fade out', fadecut: 'Fade in cut out', centercut: 'Center cut' } },
    eq: { t: 'EQ', c: '#ffd60a', l: { custom: 'Custom', none: 'None', center: 'Center bass swap', end: 'End bass swap', start: 'Start bass swap', band3: 'Bass fade', quick: 'Quick bass cut' } },
    flt: { t: 'Filter', c: '#bf5af2', l: { custom: 'Custom', none: 'None', lpout: 'Low pass filter out', lpin: 'Low pass filter in', lpinout: 'Low pass filter in low pass filter out', lpinhpout: 'Low pass filter in high pass filter out' } },
    fx: { t: 'Effects', c: '#ff9f0a', l: { auto: 'Auto', none: 'None', light: 'Riser and boom', full: 'Riser, boom and echo' } }
  };
  var PRE = [
    ['auto', 'Auto', null],
    ['fade', 'Fade', { vol: 'overlap', eq: 'none', flt: 'none', fx: 'none' }],
    ['rise', 'Rise', { vol: 'overlap', eq: 'start', flt: 'lpin', fx: 'full' }],
    ['blend', 'Blend', { vol: 'overlap', eq: 'band3', flt: 'none', fx: 'none' }],
    ['cut', 'Cut', { vol: 'centercut', eq: 'quick', flt: 'none', fx: 'none' }]
  ];
  function rcNow(){ return F().recipeOf(o.rc); }
  function sameRc(a, b){ return a.vol === b.vol && a.eq === b.eq && a.flt === b.flt && a.fx === b.fx; }
  function presetOf(){ var c = rcNow(), i; for (i = 0; i < PRE.length; i++) if (sameRc(c, F().recipeOf(PRE[i][2]))) return PRE[i][0]; return 'custom'; }
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
      '<div class="st-top"><button class="st-cancel" id="st-x" type="button" aria-label="Close">Cancel</button><div class="st-tabs"><button type="button" data-m="blend" class="on">Blend</button><button type="button" data-m="decks">Decks</button></div><button class="st-save" id="st-save" type="button">Save</button></div>' +
      '<div class="st-blend" id="st-blend">' +
      '<button class="st-card" id="st-ca" type="button"></button>' +
      '<div class="st-stage"><canvas id="st-cv"></canvas><div class="st-load" id="st-load" hidden>Reading the songs…</div></div>' +
      '<div class="st-tr"><button class="st-bars" id="st-bars" type="button" aria-label="Blend length"></button><button class="st-prev" id="st-prev" type="button" aria-label="Preview"><i class="pv-f"></i><span class="pv-i">▶</span><span class="pv-t">Preview</span></button></div>' +
      '<button class="st-card" id="st-cb" type="button"></button>' +
      '<div class="st-kc" id="st-kc"></div>' +
      '<div class="st-ctl"><div class="st-step"><span>Song 1 leaves</span><div><button type="button" data-k="a-">−1</button><b id="st-ta">0:00</b><button type="button" data-k="a+">+1</button></div></div>' +
      '<div class="st-step"><span>Song 2 enters</span><div><button type="button" data-k="b-">−1</button><b id="st-tb">0:00</b><button type="button" data-k="b+">+1</button></div></div></div>' +
      '<div class="st-pre-h">Presets</div><div class="st-pre" id="st-pre"></div>' +
      '<div class="st-opts" id="st-opts"></div>' +
      '<div class="st-acts" id="st-acts"><button type="button" data-a="undo">↶<small>Undo</small></button><button type="button" data-a="redo">↷<small>Redo</small></button><button type="button" data-a="reset">⟲<small>Reset</small></button><button type="button" data-a="align">♪<small>Align beats</small></button><button type="button" data-a="sync">⇋<small id="st-sy">BPM match</small></button><button type="button" data-a="tune">≡<small>Fine tune</small></button></div></div>' +
      '<div class="st-sheet st-tune" id="st-tune" hidden><div class="st-sh-bg"></div><div class="st-sh"><i class="st-grab"></i><div class="st-tt" id="st-tt"></div><div class="st-tb" id="st-tb2"></div></div></div>' +
      '<div class="st-deckpane" id="st-deckpane" hidden></div>' +
      '<div class="st-sheet" id="st-sheet" hidden><div class="st-sh-bg"></div><div class="st-sh"><i class="st-grab"></i><div class="st-sh-t" id="st-sh-t"></div><div class="st-sh-l" id="st-sh-l"></div></div></div><div class="st-pick" id="st-pick" hidden><div class="st-ph"><b id="st-pt">Pick a song</b><button class="st-auto" id="st-pc" type="button">Cancel</button></div><input id="st-pq" type="search" placeholder="Search songs" autocomplete="off"><div class="st-pl" id="st-pl"></div></div>';
    cv = document.getElementById('st-cv'); ctx = cv.getContext('2d');
    ['st-ca', 'st-cb', 'st-bars', 'st-ta', 'st-tb', 'st-prev', 'st-save', 'st-load', 'st-pick', 'st-pl', 'st-pq', 'st-pt'].forEach(function(id){ els[id] = document.getElementById(id); });
    document.getElementById('st-x').addEventListener('click', close);
    root.querySelector('.st-tabs').addEventListener('click', function(e){ var m = e.target.getAttribute && e.target.getAttribute('data-m'); if (m) setMode(m); });
    els['st-pre'] = document.getElementById('st-pre'); els['st-opts'] = document.getElementById('st-opts'); els['st-sheet'] = document.getElementById('st-sheet');
    els['st-pre'].addEventListener('click', function(e){ var b = e.target.closest && e.target.closest('button[data-p]'); if (!b) return; var k = b.getAttribute('data-p'); mark(); if (k === 'auto'){ autoPlan(); return; } PRE.forEach(function(p){ if (p[0] === k) o.rc = p[2] ? JSON.parse(JSON.stringify(p[2])) : null; }); saved = false; push(); paintRc(); });
    els['st-opts'].addEventListener('click', function(e){ var b = e.target.closest && e.target.closest('button[data-o]'); if (b) openOpt(b.getAttribute('data-o')); });
    els['st-sheet'].addEventListener('click', function(e){
      var b = e.target.closest && e.target.closest('button[data-v]');
      if (b){ mark(); var k = els['st-sheet'].getAttribute('data-o'), v = b.getAttribute('data-v'), c = rcNow(); if (v === 'custom' && k !== 'fx'){ startCustom(k, c); } else { c[k] = v; if (editKey === k) editKey = null; } o.rc = c; saved = false; push(); paintRc(); els['st-sheet'].hidden = true; return; }
      if (e.target.closest && e.target.closest('.st-sh')) return; els['st-sheet'].hidden = true;
    });
    els['st-acts'] = document.getElementById('st-acts'); els['st-kc'] = document.getElementById('st-kc'); els['st-tune'] = document.getElementById('st-tune');
    els['st-acts'].addEventListener('click', function(e){ var b = e.target.closest && e.target.closest('button[data-a]'); if (!b || b.disabled) return; var k = b.getAttribute('data-a'); if (k === 'undo') undo(); else if (k === 'redo') redo(); else if (k === 'reset') reset(); else if (k === 'align') align(); else if (k === 'sync') toggleSync(); else openTune(); });
    els['st-tune'].addEventListener('click', function(e){ var t = e.target.closest && e.target.closest('button[data-t]'); if (t){ tuneTab = t.getAttribute('data-t'); paintTune(); return; } if (e.target.closest && e.target.closest('.st-sh')) return; els['st-tune'].hidden = true; });
    els['st-ca'].addEventListener('click', function(){ openPick('a'); });
    els['st-cb'].addEventListener('click', function(){ openPick('b'); });
    document.getElementById('st-pc').addEventListener('click', function(){ els['st-pick'].hidden = true; });
    els['st-pq'].addEventListener('input', paintPick);
    els['st-bars'].addEventListener('click', function(){ mark(); AV.haptic(); var cur = o.beats / 4, i = BARS.indexOf(cur); o.beats = BARS[(i + 1) % BARS.length] * 4; clampO(); sync(); });
    root.querySelector('.st-ctl').addEventListener('click', function(e){
      var k = e.target.getAttribute && e.target.getAttribute('data-k'); if (!k) return;
      mark(); AV.haptic(); var x = an(k[0] === 'a' ? A : B), pb = x && x.bpm ? 60 / x.bpm : .5, d = k[1] === '+' ? pb : -pb;
      if (k[0] === 'a') o.a += d; else o.b += d; snap(k[0]); clampO(); sync();
    });
    els['st-prev'].addEventListener('click', preview);
    els['st-save'].addEventListener('click', save);
    /* drag a song sideways to choose where it sits under the blend window */
    var drag = null;
    function nodeHit(e){
      var c = rcNow(); if (!editKey || !c.cv || !c.cv[editKey]) return null;
      var r = cv.getBoundingClientRect(), g = geo(), px = e.clientX - r.left, py = e.clientY - r.top, hh = g.h / 2, x0 = g.pad * g.pxs, x1 = (g.pad + g.s) * g.pxs;
      var lane = py < hh ? 'a' : 'b', top = lane === 'a' ? 0 : hh, arr = c.cv[editKey][lane], i, best = -1, bd = 26;
      for (i = 0; i < arr.length; i++){ var d = Math.hypot(x0 + arr[i][0] * (x1 - x0) - px, yOf(editKey, arr[i][1], top, hh) - py); if (d < bd){ bd = d; best = i; } }
      if (best >= 0) return { lane: lane, i: best, arr: arr, top: top, hh: hh, x0: x0, x1: x1 };
      if (px >= x0 && px <= x1){
        var u = (px - x0) / (x1 - x0), j = 1; while (j < arr.length - 1 && arr[j][0] < u) j++;
        var a = arr[j - 1], b = arr[j], v0 = a[1] + (b[1] - a[1]) * ((u - a[0]) / Math.max(1e-6, b[0] - a[0]));
        if (Math.abs(yOf(editKey, v0, top, hh) - py) < 20){ arr.splice(j, 0, [u, v0]); return { lane: lane, i: j, arr: arr, top: top, hh: hh, x0: x0, x1: x1 }; }
      }
      return null;
    }
    var endD = null, lastBeat = null;
    cv.addEventListener('pointerdown', function(e){
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 2){ drag = null; nodeDrag = null; endD = null; lockG = null; var p1 = ptrs[ids[0]], p2 = ptrs[ids[1]]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z: zoom }; return; }
      var nh = nodeHit(e);
      if (nh){
        var now = Date.now(); if (lastTap.l === nh.lane && lastTap.i === nh.i && now - lastTap.t < 380 && nh.i > 0 && nh.i < nh.arr.length - 1){ mark(); nh.arr.splice(nh.i, 1); lastTap = { t: 0, i: -1, l: '' }; saved = false; push(); AV.haptic(); return; }
        mark(); lastTap = { t: now, i: nh.i, l: nh.lane }; nodeDrag = nh; AV.haptic(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} return;
      }
      var r = cv.getBoundingClientRect(), g = geo(), px = e.clientX - r.left, py = e.clientY - r.top, x1 = (g.pad + g.s) * g.pxs;
      if (py < 40 && Math.abs(px - x1) < 30){ mark(); lockG = { pad: g.pad, pxs: g.pxs }; endD = { beats: o.beats }; AV.haptic(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} return; }
      var lane = py < r.height / 2 ? 'a' : 'b'; mark(); lastBeat = null;
      drag = { lane: lane, x: e.clientX, v: lane === 'a' ? o.a : o.b }; try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    });
    cv.addEventListener('pointermove', function(e){
      if (ptrs[e.pointerId]){ ptrs[e.pointerId].x = e.clientX; ptrs[e.pointerId].y = e.clientY; }
      if (pinch){ var ids = Object.keys(ptrs); if (ids.length >= 2){ var p1 = ptrs[ids[0]], p2 = ptrs[ids[1]]; zoom = clamp(pinch.z * Math.hypot(p1.x - p2.x, p1.y - p2.y) / pinch.d, .5, 6); } return; }
      if (nodeDrag){
        var n = nodeDrag, r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, pt = n.arr[n.i];
        if (n.i > 0 && n.i < n.arr.length - 1){ pt[0] = +clamp((px - n.x0) / (n.x1 - n.x0), n.arr[n.i - 1][0] + .01, n.arr[n.i + 1][0] - .01).toFixed(3); }
        pt[1] = +vOf(editKey, py, n.top, n.hh).toFixed(3); saved = false; push(); return;
      }
      if (endD){
        var rr = cv.getBoundingClientRect(), x0 = lockG.pad * lockG.pxs, ax = an(A), pa = ax && ax.bpm ? 60 / ax.bpm : .5, nb = clamp(Math.round(((e.clientX - rr.left) - x0) / lockG.pxs / pa / 4) * 4, 4, 128);
        if (nb !== o.beats){ o.beats = nb; if (nb % 4 === 0) AV.haptic(); clampO(); push(); } return;
      }
      if (!drag) return; var g = geo(), dt = (e.clientX - drag.x) / g.pxs * (drag.lane === 'b' ? rate() : 1);
      if (drag.lane === 'a') o.a = drag.v - dt; else o.b = drag.v - dt; clampO(); push();
      var xx = an(drag.lane === 'a' ? A : B); if (xx && xx.bpm){ var bi = Math.round((drag.lane === 'a' ? o.a : o.b) / (60 / xx.bpm)); if (lastBeat !== null && bi !== lastBeat) AV.haptic(); lastBeat = bi; }
    });
    function up(e){
      if (e && ptrs[e.pointerId]) delete ptrs[e.pointerId];
      if (pinch){ if (Object.keys(ptrs).length < 2) pinch = null; return; }
      if (nodeDrag){ nodeDrag = null; paintRc(); liveTone(); return; }
      if (endD){ endD = null; lockG = null; clampO(); sync(); return; }
      if (!drag) return; var l = drag.lane; drag = null; snap(l); clampO(); sync();
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', function(){ zoom = 1; });
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
  function push(){ if (A && B){ F().setOverride(A.id, B.id, { a: o.a, b: o.b, beats: o.beats, rc: o.rc, keep: !!(F().getOverride(A.id, B.id) || {}).keep }); } paintTexts(); }
  function sync(){ push(); }
  function geo(){
    var s = secs(), dp = Math.min(2, window.devicePixelRatio || 1), w = cv.width / dp, h = cv.height / dp;
    if (lockG) return { s: s, pad: lockG.pad, span: w / lockG.pxs, pxs: lockG.pxs, w: w, h: h };
    var pad0 = Math.max(s * .55, 10), span = (s + 2 * pad0) / zoom, pxs = w / span;
    return { s: s, pad: (span - s) / 2, span: span, pxs: pxs, w: w, h: h };
  }
  /* a tiny tick under the finger: vibration where the browser allows it, the iPhone switch-haptic where it does not */
  var hapEl = null, hapAt = 0;
  AV.haptic = function(){
    var n = Date.now(); if (n - hapAt < 35) return; hapAt = n;
    try { if (navigator.vibrate && navigator.vibrate(7)) return; } catch (e) {}
    try {
      if (!hapEl){ hapEl = document.createElement('label'); hapEl.setAttribute('aria-hidden', 'true'); hapEl.style.cssText = 'position:fixed;left:-99px;top:-99px;opacity:0;pointer-events:none'; var i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); hapEl.appendChild(i); document.body.appendChild(hapEl); }
      hapEl.click();
    } catch (e) {}
  };
  /* ---- undo / redo / reset ---- */
  function snapshot(){ return JSON.stringify({ a: o.a, b: o.b, beats: o.beats, rc: o.rc }); }
  function restore(js){ var v = JSON.parse(js); o = { a: v.a, b: v.b, beats: v.beats, rc: v.rc || null }; editKey = null; clampO(); push(); paintRc(); paintActs(); liveTone(); }
  function mark(){ var j = snapshot(); if (hist.u.length && hist.u[hist.u.length - 1] === j) return; hist.u.push(j); if (hist.u.length > 80) hist.u.shift(); hist.r = []; paintActs(); }
  function undo(){ if (!hist.u.length) return; hist.r.push(snapshot()); restore(hist.u.pop()); AV.haptic(); }
  function redo(){ if (!hist.r.length) return; hist.u.push(snapshot()); restore(hist.r.pop()); AV.haptic(); }
  function reset(){ if (!hist.orig) return; mark(); restore(hist.orig); saved = false; AV.ui.toast('Back to how it was when you opened it', 1800); }
  function paintActs(){
    var a = els['st-acts']; if (!a) return;
    a.querySelector('[data-a=undo]').disabled = !hist.u.length; a.querySelector('[data-a=redo]').disabled = !hist.r.length;
    var c = rcNow(), sy = document.getElementById('st-sy'); if (sy) sy.textContent = 'BPM match ' + (c.sync ? 'on' : 'off'); a.querySelector('[data-a=sync]').classList.toggle('on', c.sync);
  }
  function keyChip(){
    var el = els['st-kc']; if (!el) return; var a = an(A), b = an(B);
    if (!a || !b || !a.sp || !b.sp){ el.className = 'st-kc'; el.textContent = A && B ? 'Reading the keys…' : ''; return; }
    var h = F().harmony(a.sp, b.sp), cls = h >= .85 ? 'ok' : h >= .45 ? 'mid' : 'bad';
    el.className = 'st-kc ' + cls; el.textContent = (a.sp.camelot || '?') + ' + ' + (b.sp.camelot || '?') + ' · ' + (cls === 'ok' ? 'Compatible: these keys blend smoothly.' : cls === 'mid' ? 'Close: a shorter blend works best.' : 'Clash: keep the blend short or cut.');
  }
  function align(){ mark(); snap('a'); snap('b'); clampO(); sync(); AV.haptic(); AV.ui.toast('Beats lined up', 1400); }
  function toggleSync(){ mark(); var c = rcNow(); c.sync = !c.sync; o.rc = c; saved = false; clampO(); push(); paintActs(); AV.haptic(); }
  /* the preview is heard with the fine-tuning at once */
  function liveTone(){
    var P = AV.player, Fx = F(); if (!A || !B) return;
    if (P.ctx === 'Mix Studio' && P.cur()){ var els2 = P.deck.els(), cur = P.el(), oth = els2[0] === cur ? els2[1] : els2[0]; if (P.cur().id === A.id) Fx.setStatic(cur, oth, o.rc); else Fx.setStatic(oth, cur, o.rc); }
  }
  /* ---- big touch sliders ---- */
  function mkSl(host, d){
    var w = document.createElement('div'); w.className = 'sl' + (d.vert ? ' v' : ''); w.innerHTML = '<span class="sl-l">' + d.label + '</span><div class="sl-t"><i class="sl-f"></i><b class="sl-h"></b></div><em class="sl-v"></em>';
    host.appendChild(w); var t = w.querySelector('.sl-t'), f = w.querySelector('.sl-f'), h = w.querySelector('.sl-h'), vv = w.querySelector('.sl-v'), val = d.val, last = null;
    function paint(){ var r = clamp((val - d.min) / (d.max - d.min), 0, 1); if (d.vert){ f.style.height = (r * 100) + '%'; h.style.bottom = 'calc(' + (r * 100) + '% - 18px)'; } else { f.style.width = (r * 100) + '%'; h.style.left = 'calc(' + (r * 100) + '% - 18px)'; } vv.textContent = d.fmt ? d.fmt(val) : Math.round(val); }
    function at(e){ var r = t.getBoundingClientRect(), q = d.vert ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width; var v = d.min + clamp(q, 0, 1) * (d.max - d.min); if (d.step) v = Math.round(v / d.step) * d.step; v = clamp(v, d.min, d.max); if (v !== val){ val = v; paint(); if (last !== v){ last = v; AV.haptic(); } d.on(v); } }
    var on = false;
    t.addEventListener('pointerdown', function(e){ on = true; if (d.start) d.start(); try { t.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); at(e); });
    t.addEventListener('pointermove', function(e){ if (on) at(e); });
    var end = function(){ on = false; if (d.end) d.end(); }; t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
    paint(); return { set: function(v){ val = v; paint(); } };
  }
  function openTune(){ els['st-tune'].hidden = false; paintTune(); }
  function paintTune(){
    var tt = document.getElementById('st-tt'), body = document.getElementById('st-tb2'), tabs = [['time', 'Timing'], ['lvl', 'Levels'], ['eq', 'Tone'], ['flt', 'Filters']];
    tt.innerHTML = tabs.map(function(x){ return '<button type="button" data-t="' + x[0] + '"' + (x[0] === tuneTab ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('');
    body.innerHTML = ''; var c = rcNow(), pa = an(A) && an(A).bpm ? 60 / an(A).bpm : .5;
    var begin = function(){ mark(); }, wr = function(fn){ var q = rcNow(); fn(q); o.rc = q; saved = false; push(); liveTone(); paintActs(); };
    if (tuneTab === 'time'){
      var g = document.createElement('div'); g.className = 'tn-col'; body.appendChild(g);
      mkSl(g, { label: 'Blend length', min: 4, max: 128, step: 4, val: o.beats, fmt: function(v){ return (v / 4) + ' bars · ' + Math.round(v * pa) + ' s'; }, start: begin, on: function(v){ o.beats = v; clampO(); push(); } });
      var r = document.createElement('div'); r.className = 'tn-btns'; r.innerHTML = '<button type="button" data-q="align">Align beats</button><button type="button" data-q="sync" class="' + (c.sync ? 'on' : '') + '">BPM match ' + (c.sync ? 'on' : 'off') + '</button>'; g.appendChild(r);
      r.onclick = function(e){ var q = e.target.getAttribute && e.target.getAttribute('data-q'); if (q === 'align') align(); if (q === 'sync'){ toggleSync(); paintTune(); } };
      var m = document.createElement('p'); m.className = 'tn-note'; m.textContent = 'Drag the left handle on the waveform to choose where song 1 leaves, and the right handle to change the length. Pinch the waveform to zoom.'; g.appendChild(m);
    } else if (tuneTab === 'lvl'){
      var g2 = document.createElement('div'); g2.className = 'tn-row'; body.appendChild(g2);
      var gv = c.g || { a: 1, b: 1 };
      mkSl(g2, { label: 'Song 1', vert: true, min: 0, max: 1.5, step: .05, val: gv.a == null ? 1 : gv.a, fmt: function(v){ return Math.round(v * 100) + '%'; }, start: begin, on: function(v){ wr(function(q){ q.g = q.g || { a: 1, b: 1 }; q.g.a = v; }); } });
      mkSl(g2, { label: 'Song 2', vert: true, min: 0, max: 1.5, step: .05, val: gv.b == null ? 1 : gv.b, fmt: function(v){ return Math.round(v * 100) + '%'; }, start: begin, on: function(v){ wr(function(q){ q.g = q.g || { a: 1, b: 1 }; q.g.b = v; }); } });
    } else if (tuneTab === 'eq'){
      var g3 = document.createElement('div'); g3.className = 'tn-cols'; body.appendChild(g3);
      ['a', 'b'].forEach(function(side){
        var col = document.createElement('div'); col.className = 'tn-col'; col.innerHTML = '<h4>' + (side === 'a' ? 'Song 1' : 'Song 2') + '</h4>'; g3.appendChild(col);
        var t3 = (c.t3 && c.t3[side]) || [0, 0, 0];
        ['Bass', 'Mid', 'Treble'].forEach(function(nm, i){ mkSl(col, { label: nm, min: -24, max: 9, step: 1, val: t3[i] || 0, fmt: function(v){ return (v > 0 ? '+' : '') + v + ' dB'; }, start: begin, on: function(v){ wr(function(q){ q.t3 = q.t3 || { a: [0, 0, 0], b: [0, 0, 0] }; q.t3[side] = (q.t3[side] || [0, 0, 0]).slice(); q.t3[side][i] = v; }); } }); });
      });
    } else {
      var g4 = document.createElement('div'); g4.className = 'tn-col'; body.appendChild(g4);
      mkSl(g4, { label: 'Low-pass (cut the highs)', min: 0, max: 1, step: .02, val: c.lp, fmt: function(v){ return v >= .98 ? 'Off' : Math.round(F().fOfN(v)) + ' Hz'; }, start: begin, on: function(v){ wr(function(q){ q.lp = v; }); } });
      mkSl(g4, { label: 'High-pass (cut the lows)', min: 0, max: 1, step: .02, val: c.hp, fmt: function(v){ return v <= .02 ? 'Off' : Math.round(20 * Math.pow(100, v)) + ' Hz'; }, start: begin, on: function(v){ wr(function(q){ q.hp = v; }); } });
      var m2 = document.createElement('p'); m2.className = 'tn-note'; m2.textContent = 'These apply to both songs for the length of the blend. Press preview to hear them.'; g4.appendChild(m2);
    }
  }

  function badge(t){
    var a = an(t), sp = a && a.sp, c = sp && sp.camelot, hue = c ? (parseInt(c, 10) * 30 + 200) % 360 : 0;
    return '<div class="st-meta"><span>' + (a && a.bpm ? Math.round(a.bpm) + ' bpm' : '— bpm') + '</span><span><i class="st-key" style="background:' + (c ? 'hsl(' + hue + ',75%,62%)' : 'rgba(255,255,255,.2)') + '">' + (c || '—') + '</i>' + fmt(dur(t)) + '</span></div>';
  }
  function card(t, el, hint){
    if (!t){ el.innerHTML = '<div class="st-art"></div><div class="st-ti"><b>' + hint + '</b><small>Tap to choose</small></div>'; return; }
    var al = AV.store.album(t.albumId), pal = al ? AV.palette(al) : null;
    el.innerHTML = '<div class="st-art" style="background:' + (al && al.coverUrl ? 'url(\'' + al.coverUrl + '\') center/cover no-repeat,' : '') + 'linear-gradient(135deg,' + (pal ? pal.bar : '#888') + ',' + (pal ? pal.deep : '#333') + ')"></div><div class="st-ti"><b>' + esc(t.title) + '</b><small>' + esc(t.artist || (al && al.artist) || '') + '</small></div>' + badge(t);
  }
  function paintTexts(){
    if (els['st-ta']){ els['st-ta'].textContent = fmt(o.a); els['st-tb'].textContent = fmt(o.b); els['st-bars'].textContent = (o.beats / 4) + ' bars'; }
  }
  /* hand-drawn curves: start from whatever the current choice looks like, as a handful of points the person can move */
  function startCustom(k, c){
    var Fx = F(), cv = c.cv || {}, pts = function(isIn){ var a = [], i, u; for (i = 0; i <= 4; i++){ u = i / 4; var v;
      if (k === 'vol') v = Fx.volAt(c.vol, u, isIn, c.cv); else if (k === 'eq') v = Fx.bassAt(c.eq, u, isIn, c.cv); else { var q = Fx.filterAt(c.flt, u, isIn, c.cv); v = q && q.type === 'lowpass' ? Fx.nOfF(q.f) : 1; }
      a.push([u, +clamp(v, 0, 1).toFixed(3)]); } return a; };
    if (!cv[k]) cv[k] = { a: pts(false), b: pts(true) };
    c[k] = 'custom'; c.cv = cv; editKey = k;
  }
  function yOf(k, v, top, hh){ var cy = top + hh / 2; if (k === 'vol') return top + 7 + (1 - v) * (hh - 14); if (k === 'eq') return cy + v * hh * .44; return cy + (1 - v) * hh * .44; }
  function vOf(k, y, top, hh){ var cy = top + hh / 2; return clamp(k === 'vol' ? 1 - (y - top - 7) / (hh - 14) : k === 'eq' ? (y - cy) / (hh * .44) : 1 - (y - cy) / (hh * .44), 0, 1); }
  function paintCards(){ card(A, els['st-ca'], 'Song 1'); card(B, els['st-cb'], 'Song 2'); paintTexts(); paintRc(); keyChip(); paintActs(); }
  function paintRc(){
    if (!els['st-pre']) return; var cur = presetOf(), c = rcNow();
    var list = PRE.map(function(p){ return [p[0], p[1]]; }); if (cur === 'custom') list.splice(1, 0, ['custom', 'Custom']);
    els['st-pre'].innerHTML = list.map(function(p){ return '<button type="button" data-p="' + p[0] + '"' + (p[0] === cur ? ' class="on"' : '') + '>' + (p[0] === 'auto' ? '<b>✦</b> ' : '') + p[1] + '</button>'; }).join('');
    els['st-opts'].innerHTML = ['vol', 'eq', 'flt', 'fx'].map(function(k){ return '<button type="button" data-o="' + k + '"><i style="background:' + OPT[k].c + '"></i><span>' + OPT[k].t + '</span><em>' + OPT[k].l[c[k]] + '</em><u>⌄</u></button>'; }).join('');
  }
  function openOpt(k){
    var c = rcNow(), sh = els['st-sheet'], lab = OPT[k].l; sh.setAttribute('data-o', k);
    document.getElementById('st-sh-t').innerHTML = '<i style="background:' + OPT[k].c + '"></i>' + OPT[k].t;
    document.getElementById('st-sh-l').innerHTML = Object.keys(lab).map(function(v){ return '<button type="button" data-v="' + v + '"><span>' + lab[v] + '</span>' + (c[k] === v ? '<u>✓</u>' : '') + '</button>'; }).join('');
    sh.hidden = false;
  }

  /* ---- drawing ---- */
  function lane(W, y0, h, g, startT, dir, rateK, from, isA){
    var d = dur(isA ? A : B), n = W ? W.n : 0, x, px = g.w;
    var cy = y0 + h / 2, amp = h * .46;
    for (x = 0; x < px; x += 3){
      var mixT = x / g.pxs - g.pad, tt = startT + mixT * rateK, inFrame = mixT >= 0 && mixT <= g.s;
      if (tt < 0 || tt > d || !W) continue;
      var bi = Math.min(n - 1, Math.floor(tt / W.d * n)), hi = W.hi[bi] * amp, lo = W.lo[bi] * amp;
      var lw = Math.min(hi, lo * 1.05);
      ctx.fillStyle = inFrame ? '#d1d1d6' : '#5c5c61'; ctx.fillRect(x, cy - hi, 2, hi * 2);
      ctx.fillStyle = inFrame ? '#f2f2f7' : '#767679'; ctx.fillRect(x, cy - lw * .55, 2, lw * 1.1);
    }
    ctx.globalAlpha = 1;
  }
  function Fx2(){ return AV.fx; }
  function rr(x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function draw(){
    raf = requestAnimationFrame(draw); if (!openS || !cv.width || mode !== 'blend') return;
    var tn = performance.now(); if (tn - lastDr < 30) return; lastDr = tn;
    var dpr = Math.min(2, window.devicePixelRatio || 1), g = geo(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.w, g.h);
    var hh = g.h / 2, r = rate();
    var x0 = g.pad * g.pxs, x1 = (g.pad + g.s) * g.pxs;
    ctx.fillStyle = '#2c2c2e'; rr(x0, 4, x1 - x0, g.h - 8, 16); ctx.fill();
    lane(WA, 0, hh, g, o.a, 1, 1, 0, true); lane(WB, hh, hh, g, o.b, 1, r, 0, false);
    [x0, x1].forEach(function(hx, k){ ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(hx, 20, 10, 0, 6.2832); ctx.fillStyle = k ? '#ffffff' : '#30d158'; ctx.fill(); ctx.restore(); ctx.strokeStyle = k ? '#1c1c1e' : '#04200d'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); if (k){ ctx.moveTo(hx - 1.5, 16.5); ctx.lineTo(hx - 5, 20); ctx.lineTo(hx - 1.5, 23.5); ctx.moveTo(hx + 1.5, 16.5); ctx.lineTo(hx + 5, 20); ctx.lineTo(hx + 1.5, 23.5); } else { ctx.moveTo(hx - 2, 15.5); ctx.lineTo(hx + 3, 20); ctx.lineTo(hx - 2, 24.5); } ctx.stroke(); });
    ctx.strokeStyle = 'rgba(120,190,255,.9)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    /* the recipe's curves, per song: volume (blue), bass (yellow), filter (pink); the one being hand-drawn also shows its points */
    var Fx = F(), c = rcNow(), N = 40, i, lanes = [[0, false], [hh, true]];
    if (editKey && c[editKey] !== 'custom') editKey = null;
    var COL = { vol: '#0a84ff', eq: '#ffd60a', flt: '#bf5af2' };
    lanes.forEach(function(L){
      var top = L[0], isIn = L[1];
      
      var path = function(k, fn){ ctx.strokeStyle = COL[k]; ctx.lineWidth = editKey === k ? 3.5 : 2.5; ctx.lineJoin = 'round'; ctx.beginPath(); for (i = 0; i <= N; i++){ var u = i / N; ctx[i ? 'lineTo' : 'moveTo'](x0 + u * (x1 - x0), yOf(k, fn(u), top, hh)); } ctx.stroke(); };
      path('vol', function(u){ return Fx.volAt(c.vol, u, isIn, c.cv); });
      path('eq', function(u){ return Fx.bassAt(c.eq, u, isIn, c.cv); });
      if (c.flt !== 'none' && Fx.filterAt(c.flt, .5, isIn, c.cv)){ path('flt', function(u){ var f = Fx.filterAt(c.flt, u, isIn, c.cv); return f.type === 'highpass' ? 1 - Fx.nOfF(f.f) : Fx.nOfF(f.f); }); }
      if (editKey && c.cv && c.cv[editKey]){
        (c.cv[editKey][isIn ? 'b' : 'a'] || []).forEach(function(pt){ var px = x0 + pt[0] * (x1 - x0), py = yOf(editKey, pt[1], top, hh); ctx.beginPath(); ctx.arc(px, py, 8, 0, 6.2832); ctx.fillStyle = '#05050a'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = COL[editKey]; ctx.stroke(); });
      }
    });
    /* playhead */
    var P = AV.player, cur = P.cur(), el = P.el(), mt = null;
    if (cur && A && B && el && (P.ctx === 'Mix Studio')){
      var mv = P.mixView && P.mixView();
      if (cur.id === A.id) mt = el.currentTime - o.a; else if (cur.id === B.id) mt = (el.currentTime - o.b) / r;
    }
    if (mt != null && mt > -g.pad && mt < g.s + g.pad){ ctx.fillStyle = '#30d158'; ctx.fillRect((mt + g.pad) * g.pxs - 1, 0, 2.5, g.h); }
    var pv = els['st-prev']; if (pv){ var pl = P.playing && P.ctx === 'Mix Studio'; if (!pl && Fx2().previewRc) Fx2().clearStatic();
      if (pv.classList.contains('on') !== pl){ pv.classList.toggle('on', pl); pv.querySelector('.pv-i').textContent = pl ? '■' : '▶'; pv.querySelector('.pv-t').textContent = pl ? 'Stop' : 'Preview'; }
      pv.style.setProperty('--p', pl && mt != null ? clamp(mt / g.s, 0, 1).toFixed(3) : 0); }
  }

  /* ---- actions ---- */
  function autoPlan(){
    if (!A || !B) return; F().clearOverride(A.id, B.id);
    var pl = F().plan(A, B, dur(A));
    if (pl.type === 'dj'){ o = { a: pl.aStart, b: pl.bStart, beats: pl.beats, rc: null }; } else { var a = an(A), pb = a && a.bpm ? 60 / a.bpm : .5; o = { a: Math.max(0, dur(A) - 16 * pb - 4), b: (an(B) && an(B).st) || 0, beats: 32, rc: null }; }
    saved = false; clampO(); push(); paintRc(); AV.ui.toast('Back to the automatic mix', 1800);
  }
  function setSongs(a, b){
    editKey = null; A = a; B = b; saved = false; WA = WB = null;
    if (A && B){
      var ov = F().getOverride(A.id, B.id);
      if (ov){ o = { a: ov.a, b: ov.b, beats: ov.beats || 32, rc: ov.rc || null }; } else autoPlan();
      saved = !!(ov && ov.keep); clampO(); push(); hist = { u: [], r: [], orig: snapshot() }; zoom = 1;
    }
    paintCards();
    els['st-load'].hidden = false; var n = 0, fin = function(){ if (++n === 2) els['st-load'].hidden = true; };
    if (A) F().wave(A).then(function(w){ WA = w; fin(); }); else fin();
    if (B) F().wave(B).then(function(w){ WB = w; fin(); }); else fin();
    var need = [A, B].filter(Boolean); try { F().analyseMany(need); } catch (e) {}
    setTimeout(function(){ if (openS){ paintCards(); if (A && B && !saved){ var ov2 = F().getOverride(A.id, B.id); if (!ov2 || !ov2.keep) autoPlanSoft(); } } }, 3500);
  }
  function autoPlanSoft(){ /* once the songs have been measured, take the automatic choice unless the person already moved things */
    if (!A || !B || !an(A) || !an(B)) return; var pl = F().plan(A, B, dur(A)); if (pl.type === 'dj' && !pl.manual){ o = { a: pl.aStart, b: pl.bStart, beats: pl.beats, rc: o.rc }; clampO(); push(); }
  }
  function preview(){
    var P = AV.player; if (!A || !B) return;
    if (P.playing && P.ctx === 'Mix Studio'){ P.pause(); return; }
    var Fx = F(); if (Fx.settings.xmode !== 'dj') Fx.set({ xmode: 'dj' });
    push(); P.playList([A, B], A, 'Mix Studio', false, true); P.seek(Math.max(0, o.a - 1.5)); setTimeout(liveTone, 350); setTimeout(liveTone, 1200); AV.haptic(); try { document.getElementById('st-blend').scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
  }
  function save(){
    if (!A || !B) return; F().setOverride(A.id, B.id, { a: o.a, b: o.b, beats: o.beats, rc: o.rc, keep: true }); saved = true;
    AV.ui.toast('Saved. Whenever this song is followed by the other, it will blend like this.', 3200);
  }
  function openPick(which){
    pickFor = which; pickCb = null; els['st-pt'].textContent = which === 'a' ? 'Song 1: what plays first' : 'Song 2: what comes next'; els['st-pq'].value = ''; paintPick(); els['st-pick'].hidden = false;
  }
  function pickSong(title, cb){ pickFor = null; pickCb = cb; els['st-pt'].textContent = title; els['st-pq'].value = ''; paintPick(); els['st-pick'].hidden = false; }
  function setMode(m){
    if (m === mode) return; mode = m;
    root.querySelectorAll('.st-tabs button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-m') === m); });
    document.getElementById('st-save').style.visibility = m === 'blend' ? 'visible' : 'hidden';
    var P = AV.player;
    if (m === 'decks'){
      if (P.ctx === 'Mix Studio' && P.playing) P.pause();
      document.getElementById('st-blend').hidden = true; document.getElementById('st-deckpane').hidden = false; AV.decks.open(document.getElementById('st-deckpane'), pickSong);
    } else {
      AV.decks.close(); document.getElementById('st-deckpane').hidden = true; document.getElementById('st-blend').hidden = false; size();
    }
  }
  function paintPick(){
    var q = els['st-pq'].value.trim().toLowerCase(), list = allTracks().filter(function(t){ var al = AV.store.album(t.albumId); return !q || (t.title + ' ' + (t.artist || '') + ' ' + (al ? al.title : '')).toLowerCase().indexOf(q) >= 0; });
    list.sort(function(a, b){ return String(a.title).localeCompare(String(b.title)); });
    els['st-pl'].innerHTML = list.slice(0, 150).map(function(t, i){ var al = AV.store.album(t.albumId); return '<button type="button" data-i="' + i + '"><b>' + esc(t.title) + '</b><small>' + esc((t.artist || (al && al.artist) || '') + (al ? ' · ' + al.title : '')) + '</small></button>'; }).join('') || '<p class="st-none">No songs found</p>';
    els['st-pl'].onclick = function(e){ var b = e.target.closest && e.target.closest('button[data-i]'); if (!b) return; var t = list[+b.getAttribute('data-i')]; els['st-pick'].hidden = true; if (pickCb){ var cb = pickCb; pickCb = null; cb(t); return; } if (pickFor === 'a') setSongs(t, B && B.id !== t.id ? B : null); else setSongs(A && A.id !== t.id ? A : null, t); };
  }
  function open(){
    if (!root) build();
    var P = AV.player, cur = P.cur(), all = allTracks(); if (all.length < 2){ AV.ui.toast('Add some songs first'); return; }
    var nx = null; if (cur){ var i = P.order.indexOf(P.list.indexOf(cur)); var nt = P.list[P.order[i + 1]]; if (nt && nt.id !== cur.id) nx = nt; }
    var a = cur || all[0], b = nx || all.filter(function(t){ return t.id !== a.id; })[0];
    root.hidden = false; void root.offsetWidth; root.classList.add('open'); openS = true; size(); setSongs(a, b); cancelAnimationFrame(raf); draw();
  }
  function close(){
    if (mode === 'decks'){ try { AV.decks.close(); } catch (e) {} mode = 'blend'; root.querySelectorAll('.st-tabs button').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-m') === 'blend'); }); document.getElementById('st-deckpane').hidden = true; document.getElementById('st-blend').hidden = false; document.getElementById('st-save').style.visibility = 'visible'; }
    openS = false; cancelAnimationFrame(raf); root.classList.remove('open'); setTimeout(function(){ if (!openS) root.hidden = true; }, 600);
    var P = AV.player; if (P.ctx === 'Mix Studio' && P.playing) P.pause();
    try { F().clearStatic(); } catch (e) {}
    if (A && B && !saved) F().dropTemp(A.id, B.id);
  }
  AV.studio = { open: open, close: close };
})();
