/*
  Playback and the turntable screen.
  The queue, shuffle, repeat and media-session controls live here; so does the vinyl:
  the record spins while music plays, the tonearm can be lifted and set down anywhere on the record,
  and turning the record by hand scrubs the song.
*/
(function(){
  var AV = window.AV = window.AV || {};
  var U = AV.util, $ = U.$, S = AV.store, clamp = U.clamp, fmt = U.fmt;
  var audio, audioA, audioB, fading = null, fadingId = null, pendId = null, xfBusy = false, xfToken = 0, xfTimer = 0, listeners = [];
  var pre = null, mix = null, ease = null, tickT = 0, LAT = .09;
  var P = AV.player = { list: [], order: [], pos: 0, playing: false, shuffle: false, repeat: 'off', ctx: '', want: false, mix: false };
  var urls = {}, urlOrder = [], loadedId = null;

  function emit(w){ listeners.forEach(function(f){ try { f(w); } catch (e) {} }); }
  P.on = function(f){ listeners.push(f); };
  P.cur = function(){ return P.list[P.order[P.pos]] || null; };
  P.time = function(){ var t = P.cur(); return t && loadedId === t.id && audio ? audio.currentTime : 0; };
  P.length = function(){
    var t = P.cur(); if (!t) return 0;
    return (audio && loadedId === t.id && isFinite(audio.duration) && audio.duration > 0) ? audio.duration : (t.dur || 0);
  };

  /* ---------- sources ---------- */
  function urlFor(t){
    if (urls[t.id]) return urls[t.id];
    var blob = t.synth ? AV.synthWav(t.synth) : t.blob;
    if (!blob) return '';
    urls[t.id] = URL.createObjectURL(blob); urlOrder.push(t.id);
    if (urlOrder.length > 4){
      for (var k = 0; k < urlOrder.length; k++){
        var old = urlOrder[k];
        if (old !== loadedId && old !== t.id && old !== fadingId && old !== pendId){ URL.revokeObjectURL(urls[old]); delete urls[old]; urlOrder.splice(k, 1); break; }
      }
    }
    return urls[t.id];
  }
  function load(){
    var t = P.cur(); if (!t) return false;
    if (loadedId !== t.id){
      var u = urlFor(t); if (!u) return false;
      abortPre(); audio.src = u; loadedId = t.id; try { audio.playbackRate = 1; } catch (e) {} ease = null;
      try { AV.fx.onTrack(audio, t); } catch (e) {}
    }
    return true;
  }

  /* ---------- transport ---------- */
  /* a mixed queue should hop between albums: avoid two songs from the same album in a row whenever other albums are available */
  function spread(o){
    var albums = {}, n = 0; P.list.forEach(function(t){ if (!albums[t.albumId]){ albums[t.albumId] = 1; n++; } });
    if (n < 3) return;
    function al(k){ var t = P.list[o[k]]; return t && t.albumId; }
    for (var i = 1; i < o.length; i++){
      if (al(i) !== al(i - 1)) continue;
      for (var j = i + 1; j < o.length; j++){
        if (al(j) !== al(i - 1) && (i + 1 >= o.length || al(j) !== al(i + 1))){ var x = o[i]; o[i] = o[j]; o[j] = x; break; }
      }
    }
  }
  function buildOrder(first){
    var n = P.list.length, o = [], i;
    for (i = 0; i < n; i++) o.push(i);
    if (P.shuffle){
      for (i = n - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)), x = o[i]; o[i] = o[j]; o[j] = x; }
      if (first >= 0){ var at = o.indexOf(first); o[at] = o[0]; o[0] = first; }
      spread(o); P.pos = 0;
    } else P.pos = first >= 0 ? first : 0;
    P.order = o;
  }
  P.playList = function(tracks, start, ctx, shuffle, raw){
    if (!tracks.length) return;
    P.raw = !!raw;
    if (P.mix && !raw){   /* Mix is on: whatever you start, the songs after it come from every album */
      var all = allTracks(); if (all.length > 1){ if (!start) start = tracks[0]; tracks = all; ctx = 'Mix · all albums'; shuffle = true; }
    }
    endCross(); P.list = tracks.slice(); P.ctx = ctx || '';
    if (shuffle !== undefined) P.shuffle = !!shuffle;
    var first = Math.max(0, start ? tracks.indexOf(start) : 0);
    if (shuffle && !start) first = Math.floor(Math.random() * tracks.length);
    buildOrder(first);
    save(); emit('track'); P.play();
  };
  /* ---------- crossfade: the next song starts on the second player while this one fades out ---------- */
  function other(){ return audio === audioA ? audioB : audioA; }
  function nextIdx(){ refill(); return P.pos + 1 < P.order.length ? P.pos + 1 : (P.repeat === 'all' && !P.shuffle && P.order.length > 1 ? 0 : -1); }
  function nextTr(){ var np = nextIdx(); return np < 0 ? null : (P.list[P.order[np]] || null); }
  function rate1(a){ try { a.playbackRate = 1; a.defaultPlaybackRate = 1; } catch (e) {} }
  function abortPre(){ if (pre){ try { pre.el.pause(); } catch (e) {} rate1(pre.el); pre = null; } pendId = null; }
  function endCross(){
    xfToken++; clearTimeout(xfTimer); abortPre();
    if (mix){ try { (mix.swapped ? mix.oldEl : mix.o).pause(); } catch (e) {} rate1(mix.oldEl); if (!mix.swapped) rate1(mix.o); mix = null; }
    ease = null; if (audio && audio.playbackRate !== 1) rate1(audio);
    if (fading && fading !== audio){ try { fading.pause(); } catch (e) {} }
    fading = null; fadingId = null;
    if (xfBusy){ xfBusy = false; try { AV.fx.endMix(); } catch (e) {} }
  }

  /* how the current song will flow into the next one (shown on the Sound page) */
  P.el = function(){ return audio; };
  P.mixInfo = function(){
    var F = AV.fx, t = P.cur(), n = nextTr(); if (!t || !n || P.repeat === 'one') return '';
    if (F.settings.xmode === 'off') return '';
    return F.describe(F.plan(t, n, audio && isFinite(audio.duration) ? audio.duration : 0));
  };

  /* ---------- MIX: every song from every album, each next song chosen as the best DJ match for the one playing ---------- */
  function allTracks(){ var all = []; AV.store.albums.forEach(function(a){ all = all.concat(AV.store.tracksOf(a.id)); }); return all; }
  function refill(){
    if (!P.mix || P.raw || P.list.length < 2 || P.pos + 1 < P.order.length) return;
    var cur = P.order[P.pos], o = [], i;
    for (i = 0; i < P.list.length; i++) if (i !== cur) o.push(i);
    for (i = o.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)), x = o[i]; o[i] = o[j]; o[j] = x; }
    P.order = P.order.concat(o);
  }
  /* how good a mix a→b would be: same tempo family, similar loudness and tone, a different album, plus a little luck so it stays surprising */
  function mixScore(F, cur, cand, D){
    var A = F.analysisOf(cur.id), B = F.analysisOf(cand.id), s = Math.random() * .8;
    if (F.hasOverride(cur, cand)) return 100 + s;           /* a pair you set up yourself always wins */
    if (cand.albumId !== cur.albumId) s += 1.5;
    if (!A || !B) return s + 3;
    var pl = F.plan(cur, cand, D);
    s += pl.type === 'dj' ? 10 - Math.abs(pl.rate - 1) * 40 : 2;
    var a = A.sp, b = B.sp;
    if (a && b){
      s += F.harmony(a, b) * 7;                                           /* Camelot wheel: same key, neighbour, relative */
      s += (1 - Math.abs(a.energy - b.energy)) * 2.2;                      /* keep the energy flowing */
      s += (1 - Math.abs(a.danceability - b.danceability)) * 1.2;
      s += (1 - Math.abs(a.valence - b.valence)) * 1.2;
      s += (1 - Math.abs(a.acousticness - b.acousticness)) * .8;
      s += (1 - Math.abs(a.instrumentalness - b.instrumentalness)) * .6;
      s += (1 - Math.abs(a.speechiness - b.speechiness)) * .4;
      s += a.timeSignature === b.timeSignature ? 1 : -4;                   /* 3/4 into 4/4 never feels right */
    }
    if (A.lv != null && B.lv != null) s -= Math.abs(A.lv - B.lv) * .15;
    return s;
  }
  var primedFor = null, pickedFor = null, pickedAt = null, lastPick = 0;
  function pickBest(D){
    var F = AV.fx, cur = P.cur(); if (!cur || P.order.length < 3 || pre || xfBusy) return;
    refill();
    var from = P.pos + 1, to = Math.min(P.order.length, from + 60), best = -1e9, bi = -1, k;
    for (k = from; k < to; k++){
      var cand = P.list[P.order[k]]; if (!cand) continue;
      var s = mixScore(F, cur, cand, D); if (s > best){ best = s; bi = k; }
    }
    if (bi > from){ var x = P.order[from]; P.order[from] = P.order[bi]; P.order[bi] = x; }
    if (bi >= 0) emit('queue');
  }
  P.setMix = function(on){
    on = !!on; if (on === P.mix) return;
    P.mix = on; save(); emit('mix');                  /* the switch answers at once; the queue is rebuilt as soon as no blend is in progress */
    try { var F0 = AV.fx; if (F0.prepare()) F0.unlockSecond(); } catch (e) {}
    if (on && AV.fx.settings.xmode !== 'dj') AV.fx.set({ xmode: 'dj' });
    applyMix(on);
  };
  function applyMix(on){
    if (P.mix !== on) return;
    if (xfBusy || mix){ setTimeout(function(){ applyMix(on); }, 600); return; }
    var F = AV.fx, cur = P.cur();
    if (on){
      var all = allTracks();
      if (all.length < 2) return;
      try { F.analyseMany(all); } catch (e) {}
      if (cur && loadedId){
        abortPre(); P.raw = false; P.list = all; P.ctx = 'Mix · all albums'; P.shuffle = true;
        buildOrder(all.indexOf(cur)); primedFor = pickedFor = pickedAt = null; emit('track');
      } else { P.playList(all, null, 'Mix · all albums', true); }
    } else if (cur){
      abortPre(); var al = AV.store.tracksOf(cur.albumId), a = AV.store.album(cur.albumId);
      if (al.length){ P.raw = false; P.list = al; P.ctx = a ? a.title : ''; P.shuffle = false; buildOrder(al.indexOf(cur)); emit('track'); }
    }
  }
  P.mixView = function(){
    var F = AV.fx, cur = P.cur(), nx = nextTr(); if (!P.mix || !cur) return { on: P.mix };
    var D = audio && isFinite(audio.duration) ? audio.duration : 0, pl = nx ? F.plan(cur, nx, D) : null;
    var v = { on: true, cur: cur, next: nx, pl: pl, t: audio ? audio.currentTime : 0, D: D, prog: -1 };
    if (mix){ v.prog = Math.max(0, Math.min(1, (mix.oldEl.currentTime - mix.pl.aStart) / mix.pl.secs)); v.pl = mix.pl; v.next = mix.t; v.cur = P.list[P.order[P.pos]] || cur; }
    return v;
  };

  /* one timer drives everything: when to load the next song, when to start it, and keeping it in step */
  function tick(){
    var F = AV.fx;
    if (mix) return mixTick();
    if (ease){
      var q = Math.min(1, (performance.now() - ease.t0) / 8000), r = ease.from + (1 - ease.from) * q;
      if (ease.el === audio){ try { audio.playbackRate = r; } catch (e) {} }
      if (q >= 1 || ease.el !== audio){ if (ease.el === audio) rate1(audio); ease = null; }
      return;
    }
    if (xfBusy || !P.playing || dragging || !audio || !F.canFade() || P.repeat === 'one') return;
    var D = audio.duration; if (!isFinite(D) || D < 20) return;
    if (P.mix && P.order.length > 2){
      if (pickedAt !== loadedId){ pickedAt = loadedId; pickBest(D); }
      if (primedFor !== loadedId && audio.currentTime > 3){ primedFor = loadedId; for (var q = 8; q >= 1; q--){ var pt = P.list[P.order[P.pos + q]]; if (pt) F.wantNext(pt); } }
      /* keep choosing as more songs get measured, until the next one is locked in for the mix */
      var nowMs = performance.now();
      if (nowMs - lastPick > 4000 && D - audio.currentTime > 14){ lastPick = nowMs; pickBest(D); }
    }
    var np = nextIdx(), nt = np < 0 ? null : P.list[P.order[np]]; if (!nt) return;
    var cur = audio.currentTime, rem = D - cur, pl = F.plan(P.cur(), nt, D);
    if (F.settings.xmode === 'dj') F.wantNext(nt);
    if (pl.type === 'dj'){
      if (cur > pl.aStart + 1.2 && !pre){ pl = { type: 'smooth', secs: Math.min(6, Math.max(2, rem - .3)) }; }
      else {
        if (cur >= pl.aStart - 8 && cur < pl.aStart + 1.2 && (!pre || pre.id !== nt.id)) preload(nt, np, pl);
        if (pre && pre.ready && cur >= pl.aStart - LAT) startDJ();
        else if (pre && cur > pl.aStart + 1.2){ abortPre(); }
        return;
      }
    }
    /* plain smooth fade */
    var x = pl.secs; if (!(x > 0) || D < x * 2 + 2) return;
    if (rem > x + .1 || rem < .4) return;
    startSmooth(nt, np, Math.min(x, rem));
  }
  function preload(nt, np, pl){
    var u = urlFor(nt); if (!u) return;
    abortPre(); var o = other(); pendId = nt.id;
    var p = pre = { id: nt.id, np: np, pl: pl, el: o, ready: false, t: nt };
    o.src = u; o.defaultPlaybackRate = pl.rate; o.playbackRate = pl.rate;
    try { o.preservesPitch = true; o.webkitPreservesPitch = true; o.mozPreservesPitch = true; } catch (e) {}
    var go = function(){
      if (pre !== p) return;
      var done = function(){ if (pre === p) p.ready = true; };
      try { o.addEventListener('seeked', done, { once: true }); o.currentTime = pl.bStart; } catch (e) { done(); }
      setTimeout(function(){ if (pre === p && Math.abs(o.currentTime - pl.bStart) < .5) p.ready = true; }, 400);
    };
    if (o.readyState >= 1) go(); else o.addEventListener('loadedmetadata', go, { once: true });
    try { o.load(); } catch (e) {}
  }
  function startDJ(){
    var F = AV.fx, p = pre; pre = null; if (!p) return;
    var o = p.el, pl = p.pl, oldEl = audio, tok = ++xfToken;
    xfBusy = true; fadingId = loadedId; pendId = p.id;
    try { F.onTrack(o, p.t, true); } catch (e) {}
    var pr; try { pr = o.play(); } catch (e) { pr = null; }
    var fail = function(){ if (tok !== xfToken) return; xfBusy = false; fadingId = null; pendId = null; try { o.pause(); } catch (e) {} rate1(o); F.endMix(); };
    if (!pr || !pr.then){ fail(); return; }
    pr.then(function(){
      if (tok !== xfToken){ try { o.pause(); } catch (e) {} return; }
      var late = Math.max(0, oldEl.currentTime - pl.aStart), left = Math.max(2, pl.secs - late);
      if (!F.beginMix(oldEl, o, left, left / 2, 60 / pl.bpmA)){ fail(); return; }
      mix = { tok: tok, oldEl: oldEl, o: o, pl: pl, t: p.t, np: p.np, swapped: false, seeks: 0, lat: LAT, t0: performance.now() };
      fading = oldEl; mixTick();
    }, fail);
  }
  function mixTick(){
    var m = mix; if (!m || m.tok !== xfToken) return;
    var pl = m.pl, cA = m.oldEl.currentTime, prog = (cA - pl.aStart) / pl.secs, o = m.o;
    /* keep the new song locked to the old one: measure how far off it is, jump if far, nudge its speed if close */
    var exp = pl.bStart + Math.max(0, cA - pl.aStart) * pl.rate, err = o.currentTime - exp;
    if (prog < .8 && !o.seeking){
      if (Math.abs(err) > .14 && m.seeks < 3 && prog < .3){ m.seeks++; try { o.currentTime = exp + m.lat * pl.rate; } catch (e) {} }
      else { var adj = clamp(err * .35, -.02, .02); try { o.playbackRate = pl.rate * (1 - adj); } catch (e) {} }
    }
    if (!m.swapped && prog >= .5){ m.swapped = true; audio = o; loadedId = m.t.id; pendId = null; P.pos = m.np; emit('track'); }
    if (prog >= 1 || m.oldEl.paused || m.oldEl.ended || (cA >= (m.oldEl.duration || 1e9) - .05)) finishMix();
  }
  function finishMix(){
    var m = mix; if (!m) return; mix = null;
    if (!m.swapped){ audio = m.o; loadedId = m.t.id; P.pos = m.np; emit('track'); }
    try { m.oldEl.pause(); } catch (e) {} rate1(m.oldEl);
    fading = null; fadingId = null; pendId = null; xfBusy = false; AV.fx.endMix();
    ease = { el: m.o, from: m.o.playbackRate || 1, t0: performance.now() };
  }
  function startSmooth(nt, np, secs){
    var F = AV.fx, u = urlFor(nt); if (!u) return;
    var o = other(), oldEl = audio, oldId = loadedId, tok = ++xfToken;
    xfBusy = true; fadingId = oldId;
    o.src = u; try { o.currentTime = 0; } catch (e) {}
    try { F.onTrack(o, nt, true); } catch (e) {}
    var pr = o.play();
    var fail = function(){ if (tok !== xfToken) return; xfBusy = false; fadingId = null; try { o.pause(); } catch (e) {} F.resetFades(); };
    if (!pr || !pr.then){ fail(); return; }
    pr.then(function(){
      if (tok !== xfToken){ try { o.pause(); } catch (e) {} return; }
      if (!F.crossfade(oldEl, o, secs)){ fail(); return; }
      fading = oldEl; audio = o; loadedId = nt.id; P.pos = np;
      emit('track');
      xfTimer = setTimeout(function(){ if (tok !== xfToken) return; try { oldEl.pause(); } catch (e) {} fading = null; fadingId = null; xfBusy = false; F.endMix(); }, secs * 1000 + 150);
    }, fail);
  }

  P.play = function(){
    try { if (AV.fx.prepare()) AV.fx.unlockSecond(); } catch (e) {}
    if (!load()) return;
    var p = audio.play();
    if (p && p.catch) p.catch(function(){ P.playing = false; P.want = false; emit('state'); });
  };
  P.pause = function(){ endCross(); if (audio) audio.pause(); };
  P.toggle = function(){ if (P.playing) P.pause(); else if (P.cur()) P.play(); };
  P.seek = function(t){
    if (!load()) return;
    if (fading) endCross();
    t = clamp(t, 0, Math.max(0, P.length() - .05));
    if (audio.readyState >= 1) audio.currentTime = t;
    else audio.addEventListener('loadedmetadata', function(){ audio.currentTime = t; }, { once: true });
    emit('time');
  };
  P.next = function(auto){
    if (!P.list.length) return;
    if (!auto) endCross();
    if (auto && P.repeat === 'one'){ audio.currentTime = 0; P.play(); return; }
    refill();
    if (P.pos + 1 < P.order.length) P.pos++;
    else if (P.repeat === 'all' || !auto){ if (P.shuffle && P.repeat === 'all') buildOrder(-1); P.pos = 0; }
    else { audio.pause(); audio.currentTime = 0; emit('state'); return; }
    emit('track'); P.play();
  };
  P.prev = function(){
    if (!P.list.length) return;
    endCross();
    if (P.time() > 3){ audio.currentTime = 0; return; }
    P.pos = P.pos > 0 ? P.pos - 1 : P.order.length - 1;
    emit('track'); P.play();
  };
  P.toggleShuffle = function(){
    if (P.mix){ P.setMix(false); return; }
    var cur = P.order[P.pos]; P.shuffle = !P.shuffle;
    buildOrder(cur); save(); emit('mode');
  };
  P.cycleRepeat = function(){ P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off'; save(); emit('mode'); };
  /* a track was edited or removed elsewhere */
  P.dropTrack = function(t){
    var i = P.list.indexOf(t); if (i < 0) return;
    var wasCur = P.cur() === t; if (wasCur) endCross();
    P.list.splice(i, 1);
    if (!P.list.length){ audio.pause(); audio.removeAttribute('src'); loadedId = null; P.order = []; P.pos = 0; emit('track'); return; }
    var cur = wasCur ? -1 : P.order[P.pos];
    var o = []; P.order.forEach(function(k){ if (k !== i) o.push(k > i ? k - 1 : k); });
    P.order = o;
    if (wasCur){ P.pos = Math.min(P.pos, o.length - 1); audio.pause(); loadedId = null; emit('track'); P.play(); }
    else { P.pos = o.indexOf(cur > i ? cur - 1 : cur); emit('track'); }
  };
  function save(){ try { localStorage.setItem('alveon.prefs', JSON.stringify({ s: P.shuffle, r: P.repeat, m: P.mix })); } catch (e) {} }
  function restore(){ try { var p = JSON.parse(localStorage.getItem('alveon.prefs') || '{}'); P.shuffle = !!p.s; P.repeat = p.r || 'off'; P.mix = !!p.m; } catch (e) {} }

  /* ---------- turntable ---------- */
  var np, stage, rw, rec, armg, grab, G = null;
  var angle = 0, speed = 0, ratio = 1.4, armShown = 0, armTgt = 0, last = 0, running = false, open = false;
  var dragging = false, down = false, engaged = false, suppress = false, wasPlaying = false, armHeld = false, armMoved = false, armLift = false;
  var dragTotal = 0, dragBase = 0, dragLastA = 0, dragA0 = 0, dragT0 = 0, dragCur = 0, dragTgt = 0, dragSet = -1, dragVel = 0, lastT = 0, pendT = -1, pendAt = 0;
  var SPR = 3;
  /* where the needle sits, as a share of the record's radius: first groove at the very edge, last groove just outside the label, parked well clear of the record */
  var R_START = .975, R_END = .62, R_PARK = 1.4;

  function setA(id, o){ var el = $(id); for (var k in o) el.setAttribute(k, o[k]); }
  function layout(){
    var W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    var k = W / 390, D = Math.min(1.26 * W, .97 * H), R = D / 2, Cx = .24 * W, Cy = H / 2;
    rw.style.width = D + 'px'; rw.style.height = D + 'px'; rw.style.left = (Cx - R) + 'px'; rw.style.top = (Cy - R) + 'px';
    var Px = .885 * W, Py = Math.max(Cy - .73 * R, 56 * k), L = 1.476 * R;
    G = { R: R, Cx: Cx, Cy: Cy, Px: Px, Py: Py, L: L, Lt: L + 6 * k, d: Math.hypot(Cx - Px, Cy - Py) };
    var svg = $('armsvg');
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    setA('ring', { cx: Px, cy: Py, r: 45 * k }); setA('cap2', { cx: Px, cy: Py, r: 25 * k });
    setA('cw', { x: -15 * k, y: -56 * k, width: 30 * k, height: 44 * k, rx: 7 * k });
    setA('tube', { x: -3.6 * k, y: 0, width: 7.2 * k, height: L });
    setA('headr', { x: -13 * k, y: L - 46 * k, width: 26 * k, height: 44 * k, rx: 3.5 * k });
    setA('sty', { x: -1.4 * k, y: L - 3 * k, width: 2.8 * k, height: 9 * k });
    setA('grab', { x: -24 * k, y: -46 * k, width: 48 * k, height: L + 52 * k });
  }
  function armPhi(r){
    var c = (G.Lt * G.Lt + G.d * G.d - r * r) / (2 * G.Lt * G.d);
    var g = Math.acos(clamp(c, -1, 1)), thc = Math.atan2(G.Cy - G.Py, G.Cx - G.Px);
    return (thc - g) * 180 / Math.PI - 90;
  }
  function tipRatio(phi){
    var p = phi * Math.PI / 180;
    return Math.hypot(G.Px - G.Lt * Math.sin(p) - G.Cx, G.Py + G.Lt * Math.cos(p) - G.Cy) / G.R;
  }
  function ptrAngle(e){ var r = rw.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; }

  function frame(now){
    if (!open){ running = false; return; }
    var dt = Math.min(.05, (now - last) / 1000); last = now;
    if (dragging){
      dragCur += (dragTgt - dragCur) * Math.min(1, dt * 14);
      if (audio.readyState >= 1 && Math.abs(dragCur - dragSet) > .03){ audio.currentTime = dragCur; dragSet = dragCur; }
      if (now - lastT > 60) dragVel *= .8;
    } else {
      var spin = P.playing || armLift;
      speed += ((spin ? 200 : 0) - speed) * Math.min(1, dt * (spin ? 1.6 : 1.1));
      if (!spin && Math.abs(speed) < .5) speed = 0;
      angle = (angle + speed * dt) % 360;
    }
    rec.style.transform = 'rotate(' + angle + 'deg)';
    if (G){
      if (pendT >= 0 && (Math.abs(P.time() - pendT) < .6 || now - pendAt > 2500)) pendT = -1;
      var D = P.length(), Pt = dragging ? dragCur : (pendT >= 0 ? pendT : P.time()), prog = D ? clamp(Pt / D, 0, 1) : 0;
      if (armHeld) armShown += (armTgt - armShown) * Math.min(1, dt * 22);
      else { ratio += (((P.playing || P.want) ? R_START - prog * (R_START - R_END) : R_PARK) - ratio) * Math.min(1, dt * 2.6); armShown = armPhi(ratio * G.R); }
      armg.setAttribute('transform', 'translate(' + G.Px.toFixed(1) + ' ' + G.Py.toFixed(1) + ') rotate(' + armShown.toFixed(2) + ')');
    }
    requestAnimationFrame(frame);
  }
  function start(){ if (!running){ running = true; last = performance.now(); requestAnimationFrame(frame); } }

  function bindTurntable(){
    var hit = $('hit');
    hit.addEventListener('pointerdown', function(e){
      down = true; engaged = false; dragTotal = 0; dragLastA = ptrAngle(e); lastT = performance.now(); dragVel = 0;
      try { hit.setPointerCapture(e.pointerId); } catch (x) {}
    });
    hit.addEventListener('pointermove', function(e){
      if (!down) return;
      var a = ptrAngle(e), d = a - dragLastA;
      if (d > 180) d -= 360; if (d < -180) d += 360;
      dragLastA = a; dragTotal += d;
      var now = performance.now(), dt = Math.max(.008, (now - lastT) / 1000); lastT = now;
      if (!engaged){
        if (Math.abs(dragTotal) < 6 || !P.cur()) return;
        engaged = true; dragging = true; wasPlaying = P.playing; load();
        if (wasPlaying) audio.pause();
        dragBase = dragTotal; dragA0 = angle - dragTotal; dragT0 = P.time(); dragCur = dragT0; dragSet = dragT0; dragVel = 0; speed = 0;
      } else dragVel = dragVel * .6 + (d / dt) * .4;
      angle = dragA0 + dragTotal;
      dragTgt = clamp(dragT0 + (dragTotal - dragBase) / 360 * SPR, 0, Math.max(0, P.length() - .15));
    });
    function endDrag(e){
      if (!down) return; down = false;
      try { hit.releasePointerCapture(e.pointerId); } catch (x) {}
      if (!engaged) return;
      engaged = false; dragging = false;
      suppress = true; setTimeout(function(){ suppress = false; }, 60);
      if (performance.now() - lastT > 90) dragVel = 0;
      speed = clamp(dragVel, -800, 800);
      P.seek(dragTgt);
      if (wasPlaying) P.play();
    }
    hit.addEventListener('pointerup', endDrag);
    hit.addEventListener('pointercancel', endDrag);
    hit.addEventListener('click', function(){ if (!suppress) P.toggle(); });

    /* the tonearm */
    function svgPt(e){ var r = $('armsvg').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    grab.addEventListener('pointerdown', function(e){
      if (!G) return; e.preventDefault();
      armHeld = true; armMoved = false; armLift = P.playing; armTgt = armShown;
      $('armsvg').classList.add('held');
      try { grab.setPointerCapture(e.pointerId); } catch (x) {}
      if (P.playing) audio.pause();
    });
    grab.addEventListener('pointermove', function(e){
      if (!armHeld) return;
      var p = svgPt(e), a = armPhi(R_PARK * G.R), b = armPhi(R_END * G.R * .92);
      armMoved = true;
      armTgt = clamp(Math.atan2(G.Px - p.x, p.y - G.Py) * 180 / Math.PI, Math.min(a, b), Math.max(a, b));
    });
    function dropArm(e){
      if (!armHeld) return;
      armHeld = false; $('armsvg').classList.remove('held');
      try { grab.releasePointerCapture(e.pointerId); } catch (x) {}
      var lift = armLift; armLift = false;
      if (!armMoved){ if (lift){ P.want = true; P.play(); } return; }
      var r = tipRatio(armTgt); ratio = tipRatio(armShown);
      if (r < R_START + .03 && r > R_END - .1 && P.cur()){
        var D = P.length(); P.want = true;
        var t = Math.min(clamp((R_START - r) / (R_START - R_END), 0, 1) * D, Math.max(0, D - .3));
        pendT = t; pendAt = performance.now(); P.seek(t); P.play();
      } else P.want = false;
    }
    grab.addEventListener('pointerup', dropArm);
    grab.addEventListener('pointercancel', dropArm);
    grab.addEventListener('touchmove', function(e){ e.preventDefault(); }, { passive: false });
  }

  /* ---------- screen content ---------- */
  function paintNP(){
    var t = P.cur(); if (!t) return;
    var al = S.album(t.albumId), pal = AV.palette(al);
    $('np-title').textContent = t.title;
    $('np-artist').textContent = t.artist || (al && al.artist) || '';
    $('np-ctx').textContent = P.ctx || (al ? al.title : 'Library');
    np.style.setProperty('--c1', pal.mid); np.style.setProperty('--c2', pal.deep);
    np.style.setProperty('--img', al && al.coverUrl ? 'url("' + al.coverUrl + '")' : 'none');
    $('lab').style.setProperty('--lab', al && al.coverUrl ? 'url("' + al.coverUrl + '")' : 'none');
  }
  function paintState(){
    $('mini-ico').firstElementChild.setAttribute('href', P.playing ? '#i-pause' : '#i-play');
    $('mini-play').setAttribute('aria-label', P.playing ? 'Pause' : 'Play');
    var pb = $('np-play'); pb.setAttribute('aria-label', P.playing ? 'Pause' : 'Play'); pb.classList.toggle('on', P.playing);
    $('np-plabel').textContent = P.playing ? 'Pause' : 'Play';
  }
  function paintMode(){}
  function paintTime(){
    var D = P.length(), T = P.time();
    $('mini-bar').style.setProperty('--p', D ? clamp(T / D, 0, 1) : 0);
  }

  P.init = function(){
    audioA = audio = $('audio'); audioB = document.createElement('audio'); audioB.preload = 'metadata'; audioB.setAttribute('playsinline', ''); audioB.className = 'sr'; document.body.appendChild(audioB);
    try { AV.fx.attach(audioA, audioB); } catch (e) {}
    np = $('np'); stage = $('np-stage'); rw = $('rw'); rec = $('rec'); armg = $('armg'); grab = $('grab');
    restore();
    function both(ev, fn){ [audioA, audioB].forEach(function(a){ a.addEventListener(ev, function(e){ if (e.target === audio) fn(e); }); }); }
    both('play', function(){ P.playing = true; P.want = false; paintState(); emit('state'); });
    both('pause', function(){ if (dragging) return; P.playing = false; P.want = false; paintState(); emit('state'); });
    both('ended', function(){
      if (mix){ finishMix(); return; }          /* the old song reached its end while the new one is still blending in: let the blend finish, never skip */
      if (xfBusy) return;
      P.playing = false; P.next(true);
    });
    both('timeupdate', function(){ paintTime(); tick(); });
    clearInterval(tickT); tickT = setInterval(tick, 50);
    /* safety net: if a song freezes or the player quietly stops mid-song, nudge it; if it froze at the very end, move on */
    var wdT = -1, wdN = 0;
    setInterval(function(){
      if (!audio || !P.cur() || dragging || xfBusy || mix || !P.playing || audio.paused){ wdN = 0; wdT = -1; return; }
      if (Math.abs(audio.currentTime - wdT) < .01){ wdN++; } else wdN = 0;
      wdT = audio.currentTime;
      if (wdN >= 4){
        wdN = 0; var D = audio.duration;
        if (isFinite(D) && audio.currentTime > D - 2){ P.next(true); return; }
        try { var at = audio.currentTime; audio.play(); if (audio.readyState < 2) audio.currentTime = at; } catch (e) {}
      }
    }, 1000);
    [audioA, audioB].forEach(function(a){ a.addEventListener('timeupdate', function(e){ if (mix && e.target === mix.oldEl) mixTick(); }); });
    both('loadedmetadata', function(){ paintNP(); paintTime(); });
    both('error', function(){ if (loadedId && P.cur()){ AV.ui.toast('That song cannot be played on this device'); } });
    P.on(function(w){ if (w === 'track'){ paintNP(); paintTime(); } if (w === 'mode') paintMode(); });
    paintMode(); paintState();

    $('np-play').addEventListener('click', P.toggle); $('mini-play').addEventListener('click', function(e){ e.stopPropagation(); P.toggle(); });
    $('np-next').addEventListener('click', function(){ P.next(false); }); $('np-prev').addEventListener('click', P.prev);
    $('mini-next').addEventListener('click', function(e){ e.stopPropagation(); P.next(false); });
    bindTurntable();
    if (window.ResizeObserver) new ResizeObserver(function(){ if (open) layout(); }).observe(stage);

    try {
      if ('mediaSession' in navigator){
        var ms = navigator.mediaSession;
        ms.setActionHandler('play', function(){ P.play(); }); ms.setActionHandler('pause', function(){ P.pause(); });
        ms.setActionHandler('nexttrack', function(){ P.next(false); }); ms.setActionHandler('previoustrack', function(){ P.prev(); });
        ms.setActionHandler('seekto', function(d){ if (d && d.seekTime != null) P.seek(d.seekTime); });
        P.on(function(w){
          var t = P.cur(); if (w !== 'track' || !t) return;
          var al = S.album(t.albumId), art = [];
          if (al && al.coverUrl) art = [{ src: al.coverUrl, sizes: '600x600', type: 'image/jpeg' }];
          ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist || (al && al.artist) || '', album: al ? al.title : 'ALVéON', artwork: art });
        });
      }
    } catch (e) {}
  };

  /* called by the interface when the player page slides in or out */
  P.setOpen = function(v){
    open = v;
    if (v){ layout(); paintNP(); paintTime(); paintMode(); paintState(); start(); }
  };
})();
