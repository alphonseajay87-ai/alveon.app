/*
  ALVéON sound engine (Web Audio).
  Chain, per song:  source > normalise gain > crossfade gain > mix > bass > 5 bands > treble > headroom > limiter > speakers
  Two <audio> elements feed the mix so one song can fade out while the next fades in.
  Songs are measured once on the phone (loudness and bass/treble balance) and the result is remembered,
  so each album gets its own volume level and a gentle EQ correction automatically.
*/
(function(){
  var AV = window.AV = window.AV || {};
  var clamp = AV.util.clamp;

  var BANDS = [60, 230, 910, 3600, 14000];
  var PRESETS = {
    'Flat':         { b: [0, 0, 0, 0, 0],        bass: 0,  treble: 0 },
    'Bass Boost':   { b: [3, 1.5, 0, 0, 0],      bass: 6,  treble: 0 },
    'Treble Boost': { b: [0, 0, 0, 2, 3],        bass: 0,  treble: 5 },
    'Vocal':        { b: [-2, 0, 2.5, 3, 1],     bass: 0,  treble: 0 },
    'Rock':         { b: [4, 2, -1.5, 2.5, 4],   bass: 0,  treble: 0 },
    'Electronic':   { b: [5, 3, 0, 2, 4],        bass: 2,  treble: 0 },
    'Acoustic':     { b: [3, 2, 1, 2, 2.5],      bass: 0,  treble: 0 },
    'Late Night':   { b: [2, 1, 0, -1.5, -3],    bass: 0,  treble: -2 }
  };
  var DEF = { on: true, auto: true, norm: true, xfade: 4, xmode: 'dj', xlen: 16, sfx: 'light', space: 'off', orbit: 8, preset: 'Flat', b: [0, 0, 0, 0, 0], bass: 0, treble: 0, custom: [] };

  /* loudness target and the "typical music" balance the auto EQ steers toward (see README for the limits of this) */
  var TARGET = -14, REF_LM = 0.5, REF_HM = -11, MAX_BYTES = 40 * 1048576;

  var st = read(), listeners = [];
  var ctx = null, N = null, elA = null, elB = null, failed = false, analysing = false, queue = [], fxa = {}, fxaLoaded = null, saveT = 0;
  var album = { bass: 0, treble: 0, level: null, tag: '' };

  function read(){
    var s = {}, k;
    try { s = JSON.parse(localStorage.getItem('alveon.fx') || '{}') || {}; } catch (e) {}
    var o = {}; for (k in DEF) o[k] = (s[k] !== undefined) ? s[k] : (Array.isArray(DEF[k]) ? DEF[k].slice() : DEF[k]);
    o.b = (o.b || []).slice(0, 5); while (o.b.length < 5) o.b.push(0);
    o.xfade = clamp(+o.xfade || 0, 0, 12); o.xlen = clamp(Math.round((+o.xlen || 16) / 4) * 4, 8, 32); if (['off', 'smooth', 'dj'].indexOf(o.xmode) < 0) o.xmode = 'dj'; if (['off', 'wide', '8d', 'surround'].indexOf(o.space) < 0) o.space = 'off'; if (['off', 'light', 'full'].indexOf(o.sfx) < 0) o.sfx = 'light'; o.orbit = clamp(+o.orbit || 8, 4, 20); o.bass = clamp(+o.bass || 0, -12, 12); o.treble = clamp(+o.treble || 0, -12, 12);
    o.b = o.b.map(function(v){ return clamp(+v || 0, -12, 12); });
    if (!Array.isArray(o.custom)) o.custom = [];
    return o;
  }
  function persist(){ try { localStorage.setItem('alveon.fx', JSON.stringify(st)); } catch (e) {} }
  function emit(w){ listeners.forEach(function(f){ try { f(w); } catch (e) {} }); }
  function dbToGain(db){ return Math.pow(10, db / 20); }
  function ramp(param, v, tc){ try { param.cancelScheduledValues(ctx.currentTime); param.setTargetAtTime(v, ctx.currentTime, tc); } catch (e) { try { param.value = v; } catch (e2) {} } }

  var F = AV.fx = {
    settings: st, BANDS: BANDS, PRESETS: PRESETS, album: album,
    on: function(f){ listeners.push(f); },
    live: function(){ return !!ctx && !failed; },
    canFade: function(){ return !!(ctx && N && !failed && st.on && st.xmode !== 'off' && (st.xmode === 'dj' || st.xfade > 0)); },
    failed: function(){ return failed; }
  };

  /* ---------- engine ---------- */
  F.attach = function(a, b){ elA = a; elB = b; };
  /* current filter settings, for the diagnostics panel */
  F.levels = function(){ if (!N) return null; function g(n){ return { fade: +n.fade.gain.value.toFixed(3), kill: +n.kill.gain.value.toFixed(1), norm: +n.norm.gain.value.toFixed(3) }; } return { A: g(N.A), B: g(N.B) }; };
  F.gains = function(){ return N ? { bass: N.bass.gain.value, treble: N.treble.gain.value, bands: N.bands.map(function(q){ return q.gain.value; }), pre: N.pre.gain.value, state: ctx.state } : null; };

  /* must run inside a tap (first Play): builds the graph, wakes the audio context, unlocks the second player */
  F.prepare = function(){
    if (!st.on || failed) return false;
    if (!ctx){
      try {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC || !elA || !elB) throw new Error('no web audio');
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
        ctx = new AC();
        var mix = ctx.createGain(), pre = ctx.createGain(), lim = ctx.createDynamicsCompressor(), flt = [];
        var echo = makeEcho(ctx, mix);
        function side(el){
          var src = ctx.createMediaElementSource(el), norm = ctx.createGain(), kill = ctx.createBiquadFilter(), fade = ctx.createGain(), send = ctx.createGain();
          kill.type = 'lowshelf'; kill.frequency.value = 200; kill.gain.value = 0; send.gain.value = 0;
          src.connect(norm); norm.connect(kill); kill.connect(fade); fade.connect(mix); kill.connect(send); send.connect(echo.dl);
          return { src: src, norm: norm, kill: kill, fade: fade, send: send, el: el };
        }
        var A = side(elA), B = side(elB);
        var bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 100;
        var treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 8000;
        var bands = BANDS.map(function(f){ var q = ctx.createBiquadFilter(); q.type = 'peaking'; q.frequency.value = f; q.Q.value = f > 10000 ? .8 : 1; return q; });
        var chain = [bass].concat(bands, [treble]), spOut = ctx.createGain();
        mix.connect(chain[0]); for (var i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
        treble.connect(spOut); spOut.connect(pre); pre.connect(lim);
        lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .003; lim.release.value = .12;
        lim.connect(ctx.destination);
        N = { A: A, B: B, mix: mix, echo: echo, bass: bass, treble: treble, bands: bands, pre: pre, lim: lim, spOut: spOut, sp: null, spMode: 'off', spTok: 0 };
        F.apply(true); applySpace();
      } catch (e) { failed = true; ctx = null; N = null; emit('failed'); return false; }
    }
    if (ctx.state !== 'running'){ try { ctx.resume(); } catch (e) {} }
    return true;
  };

  /* keep the second player allowed to start on its own (needed on iPhone for crossfade) */
  var unlocked = false;
  F.unlockSecond = function(){
    if (unlocked || !elB || st.xmode === 'off') return; unlocked = true;
    try {
      var n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      function w(o, s){ for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      var u = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      if (!elB.getAttribute('src')){ elB.src = u; var p = elB.play(); if (p && p.then) p.then(function(){ elB.pause(); }, function(){ unlocked = false; }); }
    } catch (e) { unlocked = false; }
  };

  function nodeOf(el){ return N ? (el === elA ? N.A : N.B) : null; }

  /* ---------- EQ ---------- */
  F.apply = function(instant){
    if (!ctx || !N) return;
    var on = st.on, tc = instant ? .005 : .12;
    var bass = on ? st.bass + (st.auto ? album.bass : 0) : 0, treble = on ? st.treble + (st.auto ? album.treble : 0) : 0;
    ramp(N.bass.gain, clamp(bass, -15, 15), tc); ramp(N.treble.gain, clamp(treble, -15, 15), tc);
    var peak = Math.max(0, bass, treble);
    N.bands.forEach(function(q, i){ var g = on ? st.b[i] : 0; ramp(q.gain, g, tc); peak = Math.max(peak, g + Math.max(0, bass) * (i < 2 ? .6 : 0) + Math.max(0, treble) * (i > 2 ? .6 : 0)); });
    ramp(N.pre.gain, dbToGain(-peak * .85), tc);   /* headroom so boosts do not clip */
  };

  F.set = function(patch){ for (var k in patch) st[k] = patch[k]; if (patch.orbit !== undefined) st.orbit = clamp(+st.orbit || 8, 4, 20); persist(); F.apply(false); applyLevelAll(); applySpace(); emit('settings'); };
  F.setBand = function(i, v){ st.b[i] = clamp(v, -12, 12); st.preset = 'Custom'; persist(); F.apply(false); emit('eq'); };
  F.setBass = function(v){ st.bass = clamp(v, -12, 12); st.preset = 'Custom'; persist(); F.apply(false); emit('eq'); };
  F.setTreble = function(v){ st.treble = clamp(v, -12, 12); st.preset = 'Custom'; persist(); F.apply(false); emit('eq'); };
  F.usePreset = function(name){
    var p = PRESETS[name]; if (!p) p = st.custom.filter(function(c){ return c.name === name; })[0], p = p && { b: p.b, bass: p.bass, treble: p.treble };
    if (!p) return; st.b = p.b.slice(); st.bass = p.bass; st.treble = p.treble; st.preset = name; persist(); F.apply(false); emit('eq');
  };
  F.saveCustom = function(name){
    name = String(name || '').trim().slice(0, 24); if (!name) return false;
    st.custom = st.custom.filter(function(c){ return c.name !== name; });
    st.custom.push({ name: name, b: st.b.slice(), bass: st.bass, treble: st.treble }); st.preset = name; persist(); emit('presets'); return true;
  };
  F.deleteCustom = function(name){ st.custom = st.custom.filter(function(c){ return c.name !== name; }); if (st.preset === name) st.preset = 'Custom'; persist(); emit('presets'); };
  F.reset = function(){ st.b = [0, 0, 0, 0, 0]; st.bass = 0; st.treble = 0; st.preset = 'Flat'; persist(); F.apply(false); emit('eq'); };


  /* ---------- spatial sound (for headphones) ---------- */
  var SPACE_GAIN = { wide: 1, '8d': .9, surround: .8 };
  function pan(c, x, y, z){
    var p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'linear'; p.rolloffFactor = 0;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; return p;
  }
  function az(deg, r){ var a = deg * Math.PI / 180; return [r * Math.sin(a), 0, -r * Math.cos(a)]; }   /* 0 = in front, + = to the right */
  function room(c, secs){
    var n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++){ var d = b.getChannelData(ch); for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    return b;
  }
  /* builds one spatial stage on any audio context; returns { in, out, setT, stop } */
  function makeSpace(c, mode, T){
    var all = [], oscs = [], inn = c.createGain(), out = c.createGain();
    function G(v){ var g = c.createGain(); g.gain.value = v; all.push(g); return g; }
    function track(n){ all.push(n); return n; }
    inn.channelCount = 2; inn.channelCountMode = 'explicit'; all.push(inn, out);
    var sp = track(c.createChannelSplitter(2)); inn.connect(sp);
    var setT = function(){};
    if (mode === 'wide'){
      var m = G(.5), sd = G(1.9), mg = track(c.createChannelMerger(2)), ng = G(-1), outL = G(1), outR = G(1);
      sp.connect(m, 0); sp.connect(m, 1);
      var sl = G(.5), sr = G(-.5); sp.connect(sl, 0); sp.connect(sr, 1); sl.connect(sd); sr.connect(sd);
      m.connect(outL); sd.connect(outL); m.connect(outR); sd.connect(ng); ng.connect(outR);
      outL.connect(mg, 0, 0); outR.connect(mg, 0, 1); mg.connect(out);
    } else if (mode === '8d'){
      var S = c.createOscillator(), C = c.createOscillator(), r = 3;
      C.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
      S.frequency.value = C.frequency.value = 1 / T; oscs.push(S, C); all.push(S, C);
      var bus = G(.85), conv = track(c.createConvolver()), wet = G(.17);
      conv.buffer = room(c, 1.3);
      [[0, -35], [1, 35]].forEach(function(q){
        var p = track(pan(c, 0, 0, 0)), f = q[1] * Math.PI / 180, cf = Math.cos(f), sf = Math.sin(f);
        function wire(osc, k, param){ var g = G(k); osc.connect(g); g.connect(param); }
        wire(S, r * cf, p.positionX); wire(C, r * sf, p.positionX); wire(C, -r * cf, p.positionZ); wire(S, r * sf, p.positionZ);
        sp.connect(p, q[0]); p.connect(bus);
      });
      bus.connect(out); bus.connect(conv); conv.connect(wet); wet.connect(out);
      setT = function(t){ S.frequency.value = C.frequency.value = 1 / t; };
      S.start(); C.start();
    } else {   /* virtual 7.1: front pair, centre, two sides, two backs, bass channel */
      var R = 2, bus2 = G(.7);
      function spk(deg, node){ var a = az(deg, R), p = track(pan(c, a[0], a[1], a[2])); node.connect(p); p.connect(bus2); }
      var fl = G(1), fr = G(1); sp.connect(fl, 0); sp.connect(fr, 1); spk(-30, fl); spk(30, fr);
      var cm = G(.5); sp.connect(cm, 0); sp.connect(cm, 1); var cg = G(.55); cm.connect(cg); spk(0, cg);
      var lfe = track(c.createBiquadFilter()); lfe.type = 'lowpass'; lfe.frequency.value = 120; cm.connect(lfe); var lg = G(.5); lfe.connect(lg); lg.connect(out);
      function delay(ms){ var d = track(c.createDelay(.1)); d.delayTime.value = ms / 1000; return d; }
      var sL = G(.3), sLi = G(-.3), sR = G(.3), sRi = G(-.3), dL = delay(9), dR = delay(9);
      sp.connect(sL, 0); sp.connect(sLi, 1); sp.connect(sR, 1); sp.connect(sRi, 0);   /* sides: what differs between left and right */
      sL.connect(dL); sLi.connect(dL); sR.connect(dR); sRi.connect(dR); spk(-90, dL); spk(90, dR);
      [[0, -135], [1, 135]].forEach(function(q){
        var lp = track(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 5500; var d = delay(20), g = G(.4);
        sp.connect(lp, q[0]); lp.connect(d); d.connect(g); spk(q[1], g);
      });
      bus2.connect(out);
    }
    return {
      in: inn, out: out, setT: setT,
      stop: function(){ oscs.forEach(function(o){ try { o.stop(); } catch (e) {} }); all.forEach(function(n){ try { n.disconnect(); } catch (e) {} }); }
    };
  }
  function applySpace(){
    if (!ctx || !N) return;
    var want = st.on ? st.space : 'off';
    if (N.spMode === want){ if (N.sp) N.sp.setT(st.orbit); return; }
    var tok = ++N.spTok, now = ctx.currentTime;
    N.spMode = want;
    try { N.spOut.gain.cancelScheduledValues(now); N.spOut.gain.setTargetAtTime(0, now, .012); } catch (e) {}
    setTimeout(function(){
      if (tok !== N.spTok) return;
      try { N.treble.disconnect(); } catch (e) {}
      if (N.sp){ N.sp.stop(); N.sp = null; }
      if (want === 'off') N.treble.connect(N.spOut);
      else { N.sp = makeSpace(ctx, want, st.orbit); N.treble.connect(N.sp.in); N.sp.out.connect(N.spOut); }
      var t = ctx.currentTime; N.spOut.gain.cancelScheduledValues(t); N.spOut.gain.setTargetAtTime(SPACE_GAIN[want] || 1, t, .03);
    }, 60);
  }
  F.spaceMode = function(){ return N ? N.spMode : 'off'; };
  /* render a short test tone through a mode on an offline context: levels of the left and right ear per slice (used by the tests) */
  F.spaceTest = function(mode, T, secs, left, right){
    var OAC = window.OfflineAudioContext, sr = 44100, c = new OAC(2, sr * secs, sr);
    var buf = c.createBuffer(2, sr * secs, sr), a = buf.getChannelData(0), b = buf.getChannelData(1);
    for (var i = 0; i < buf.length; i++){ var v = Math.sin(2 * Math.PI * 440 * i / sr) * .5 + Math.sin(2 * Math.PI * 1300 * i / sr) * .3; a[i] = left === false ? 0 : v; b[i] = right === false ? 0 : v; }
    var src = c.createBufferSource(); src.buffer = buf; var s = mode === 'off' ? null : makeSpace(c, mode, T);
    if (s){ src.connect(s.in); s.out.connect(c.destination); } else src.connect(c.destination);
    src.start();
    return c.startRendering().then(function(r){
      var L = r.getChannelData(0), Rr = r.getChannelData(1), step = Math.floor(sr * .25), o = [];
      for (var k = 0; k + step <= L.length; k += step){ var sl = 0, sR = 0; for (var j = k; j < k + step; j++){ sl += L[j] * L[j]; sR += Rr[j] * Rr[j]; } o.push([+Math.sqrt(sl / step).toFixed(3), +Math.sqrt(sR / step).toFixed(3)]); }
      return o;
    });
  };


  /* ---------- sounds between songs (all made on the phone: no sound files) ---------- */
  var noiseBuf = null, sfxLive = [];
  function noiseBuffer(c){
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    var n = c.sampleRate * 2, b = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++){ var d = b.getChannelData(ch); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    return (noiseBuf = b);
  }
  function makeEcho(c, bus){
    var dl = c.createDelay(2), fb = c.createGain(), lp = c.createBiquadFilter(), wet = c.createGain();
    dl.delayTime.value = .35; fb.gain.value = .5; lp.type = 'lowpass'; lp.frequency.value = 3200; wet.gain.value = .8;
    dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(bus);
    return { dl: dl };
  }
  /*
    kind 'beat': a riser that builds up to the bass swap, a low "boom" with a short crash on the swap, and (Full) an echo
    throw of the old song. kind 'smooth': a soft swoosh over the middle of the fade (Full adds a gentle boom).
    T is the audio-clock time of the middle of the mix.
  */
  function sfxMix(c, out, echo, send, level, T, lead, beat, kind){
    if (level === 'off') return;
    var full = level === 'full', S = [], bus = c.createGain(); bus.connect(out); sfxLive.push({ c: c, bus: bus, S: S });
    function noise(){ var n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true; S.push(n); return n; }
    function stopAt(t){ S.forEach(function(n){ try { n.stop(t); } catch (e) {} }); }
    if (kind === 'beat'){
      var rd = Math.min((full ? 8 : 4) * beat, lead * .95), r0 = T - rd;
      var n = noise(), bp = c.createBiquadFilter(), g = c.createGain();
      bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.setValueAtTime(300, r0); bp.frequency.exponentialRampToValueAtTime(9000, T);
      g.gain.setValueAtTime(.0001, r0); g.gain.exponentialRampToValueAtTime(full ? .2 : .1, T - .02); g.gain.linearRampToValueAtTime(0, T + .03);
      n.connect(bp); bp.connect(g); g.connect(bus); n.start(r0);
      if (full){
        var o = c.createOscillator(), lp = c.createBiquadFilter(), og = c.createGain(); o.type = 'sawtooth'; S.push(o);
        o.frequency.setValueAtTime(180, r0); o.frequency.exponentialRampToValueAtTime(1500, T); lp.type = 'lowpass'; lp.frequency.value = 2200;
        og.gain.setValueAtTime(.0001, r0); og.gain.exponentialRampToValueAtTime(.04, T - .02); og.gain.linearRampToValueAtTime(0, T + .03);
        o.connect(lp); lp.connect(og); og.connect(bus); o.start(r0);
      }
    } else {
      var w = noise(), wb = c.createBiquadFilter(), wg = c.createGain(), d = full ? 1.6 : 1.2;
      wb.type = 'bandpass'; wb.Q.value = .9; wb.frequency.setValueAtTime(400, T - d * .6); wb.frequency.exponentialRampToValueAtTime(5200, T + d * .4);
      wg.gain.setValueAtTime(.0001, T - d * .6); wg.gain.exponentialRampToValueAtTime(full ? .16 : .09, T); wg.gain.exponentialRampToValueAtTime(.0001, T + d * .4);
      w.connect(wb); wb.connect(wg); wg.connect(bus); w.start(T - d * .6); stopAt(T + d * .5);
    }
    if (kind === 'beat' || full){
      var lv = kind === 'beat' ? (full ? .38 : .22) : .14;
      var sub = c.createOscillator(), sg = c.createGain(); sub.type = 'sine'; S.push(sub);
      sub.frequency.setValueAtTime(95, T); sub.frequency.exponentialRampToValueAtTime(36, T + .45);
      sg.gain.setValueAtTime(lv * 1.1, T); sg.gain.exponentialRampToValueAtTime(.0001, T + 1.1);
      sub.connect(sg); sg.connect(bus); sub.start(T);
      var cr = noise(), hp = c.createBiquadFilter(), cg = c.createGain(); hp.type = 'highpass'; hp.frequency.value = 1800;
      cg.gain.setValueAtTime(lv * .55, T); cg.gain.exponentialRampToValueAtTime(.0001, T + (full ? 1.2 : .6));
      cr.connect(hp); hp.connect(cg); cg.connect(bus); cr.start(T);
      stopAt(T + 1.4);
    }
    if (kind === 'beat' && full && send && echo){
      echo.dl.delayTime.setValueAtTime(Math.min(1.9, beat * .75), T - .02);
      send.gain.setValueAtTime(0, T - .01); send.gain.linearRampToValueAtTime(.6, T + .01); send.gain.setValueAtTime(.6, T + beat); send.gain.linearRampToValueAtTime(0, T + beat * 1.05);
    }
  }
  /* render a transition's sounds offline: loudness per quarter second (used by the tests) */
  F.sfxTest = function(kind, level){
    var sr = 44100, secs = 12, c = new OfflineAudioContext(2, sr * secs, sr), bus = c.createGain(), echo = makeEcho(c, bus), send = c.createGain();
    send.connect(echo.dl); bus.connect(c.destination);
    var src = c.createOscillator(); src.frequency.value = 220; var g = c.createGain(); g.gain.value = .0; src.connect(g); g.connect(send); src.start(0);
    sfxMix(c, bus, echo, send, level, 6, 5.5, .5, kind);
    return c.startRendering().then(function(r){
      var L = r.getChannelData(0), step = sr >> 2, o = [];
      for (var k = 0; k + step <= L.length; k += step){ var sm = 0; for (var j = k; j < k + step; j++) sm += L[j] * L[j]; o.push(+Math.sqrt(sm / step).toFixed(4)); }
      return o;
    });
  };

  /* ---------- crossfade ---------- */
  function curve(up){ var n = 64, a = new Float32Array(n); for (var i = 0; i < n; i++){ var t = i / (n - 1); a[i] = up ? Math.sin(t * Math.PI / 2) : Math.cos(t * Math.PI / 2); } return a; }
  F.crossfade = function(fromEl, toEl, secs){
    var f = nodeOf(fromEl), t = nodeOf(toEl); if (!f || !t) return false;
    var now = ctx.currentTime;
    try {
      f.fade.gain.cancelScheduledValues(now); t.fade.gain.cancelScheduledValues(now);
      f.fade.gain.setValueAtTime(1, now); t.fade.gain.setValueAtTime(0, now);
      f.fade.gain.setValueCurveAtTime(curve(false), now, secs); t.fade.gain.setValueCurveAtTime(curve(true), now, secs);
    } catch (e) { return false; }
    try { sfxMix(ctx, N.mix, N.echo, f.send, st.sfx, now + secs / 2, secs / 2, .5, 'smooth'); } catch (e) {}
    return true;
  };
  F.resetFades = function(){
    if (!ctx || !N) return; var now = ctx.currentTime;
    [N.A, N.B].forEach(function(s){ try { s.fade.gain.cancelScheduledValues(now); s.fade.gain.setValueAtTime(1, now); } catch (e) {} });
  };


  /* ---------- DJ transitions ---------- */
  var MINCONF = 2.2;
  /* decide how song a flows into song b. Returns { type:'dj' | 'smooth', ... } with all times in seconds of each song. */
  F.plan = function(ta, tb, durA){
    if (!ta || !tb) return null;
    var A = F.analysisOf(ta.id), B = F.analysisOf(tb.id), len = st.xlen, D = durA || (A && A.d) || ta.dur || 0;
    var sm = { type: 'smooth', secs: Math.min(len, 6), why: '' };
    if (st.xmode === 'smooth'){ sm.secs = st.xfade; return sm; }
    if (!A || !B || A.v < 2 || B.v < 2){ sm.why = 'measuring'; return sm; }
    if (!A.bpm || !B.bpm || A.bc < MINCONF || B.bc < MINCONF){ sm.why = 'no steady beat'; return sm; }
    var pa = 60 / A.bpm, c = [B.bpm * .5, B.bpm, B.bpm * 2], cb = c[1], i, d = 9;
    for (i = 0; i < 3; i++){ var e = Math.abs(Math.log(c[i] / A.bpm)); if (e < d){ d = e; cb = c[i]; } }
    var rate = A.bpm / cb;
    if (Math.abs(rate - 1) > .08){ sm.why = 'tempos too far apart'; return sm; }
    /* longest whole phrase of beats that fits the chosen length */
    var beats = 0, opts = [32, 16, 8, 4];
    for (i = 0; i < opts.length; i++) if (opts[i] * pa <= len + .5){ beats = opts[i]; break; }
    if (!beats) beats = 4;
    var mix = beats * pa, endA = Math.min(D || A.en, A.en || D) - .25;
    var latest = endA - mix; if (latest < 8){ sm.why = 'song too short'; return sm; }
    /* last beat of A that still leaves room for the whole mix */
    var k = Math.floor((latest - A.p1) / pa), aStart = A.p1 + k * pa;
    if (aStart < Math.max(8, (A.ls || 0) + 4)){ sm.why = 'song too short'; return sm; }
    /* B enters on its first beat after the quiet intro */
    var pb = 60 / B.bpm, from = Math.max(0, (B.st || 0) - .05), j = Math.ceil((from - B.p0) / pb - 1e-6), bStart = B.p0 + j * pb;
    if (bStart < 0) bStart += pb;
    return { type: 'dj', bpmA: A.bpm, bpmB: B.bpm, bpmUsed: +cb.toFixed(2), rate: rate, beats: beats, secs: mix, aStart: aStart, bStart: bStart, why: '' };
  };
  F.describe = function(pl){
    if (!pl) return '';
    if (pl.type === 'dj') return 'Next mix: ' + Math.round(pl.bpmA) + ' BPM → ' + Math.round(pl.bpmUsed) + ' BPM, tempo matched · ' + pl.beats + ' beats (' + Math.round(pl.secs) + ' s)';
    if (st.xmode === 'smooth') return st.xfade ? 'Next mix: smooth fade, ' + st.xfade + ' s' : '';
    return 'Next mix: smooth fade' + (pl.why ? ' (' + pl.why + ')' : '');
  };

  /* Bass swap: the song coming in has its low end removed, then at the middle of the mix the two exchange basses. */
  var KILL = -26;
  F.beginMix = function(fromEl, toEl, secs, swapAt, beatSecs){
    var f = nodeOf(fromEl), t = nodeOf(toEl); if (!f || !t) return false;
    var now = ctx.currentTime;
    try {
      [f, t].forEach(function(n){ n.fade.gain.cancelScheduledValues(now); n.kill.gain.cancelScheduledValues(now); });
      f.fade.gain.setValueAtTime(1, now); t.fade.gain.setValueAtTime(0, now);
      f.fade.gain.setValueCurveAtTime(curve(false), now, secs); t.fade.gain.setValueCurveAtTime(curve(true), now, secs);
      f.kill.gain.setValueAtTime(0, now); t.kill.gain.setValueAtTime(KILL, now);
      var sw = now + Math.max(.05, swapAt), w = Math.max(.15, beatSecs || .5);
      f.kill.gain.setValueAtTime(0, sw); f.kill.gain.linearRampToValueAtTime(KILL, sw + w);
      t.kill.gain.setValueAtTime(KILL, sw); t.kill.gain.linearRampToValueAtTime(0, sw + w);
      sfxMix(ctx, N.mix, N.echo, f.send, st.sfx, sw, Math.max(.05, swapAt), Math.max(.2, beatSecs || .5), 'beat');
    } catch (e) { return false; }
    return true;
  };
  F.endMix = function(){
    if (!ctx || !N) return; var now = ctx.currentTime;
    sfxLive.forEach(function(l){ try { l.bus.gain.cancelScheduledValues(now); l.bus.gain.setTargetAtTime(0, now, .02); l.S.forEach(function(n){ try { n.stop(now + .25); } catch (e) {} }); } catch (e) {} }); sfxLive = [];
    [N.A, N.B].forEach(function(n){ try { n.kill.gain.cancelScheduledValues(now); n.kill.gain.setValueAtTime(0, now); n.send.gain.cancelScheduledValues(now); n.send.gain.setValueAtTime(0, now); } catch (e) {} });
    F.resetFades();
  };

  /* ---------- measuring songs ---------- */
  function loadCache(){
    if (fxaLoaded) return fxaLoaded;
    fxaLoaded = AV.db.getMeta('fxa').then(function(v){ fxa = v || {}; return fxa; }).catch(function(){ fxa = {}; return fxa; });
    return fxaLoaded;
  }
  function saveCache(){ clearTimeout(saveT); saveT = setTimeout(function(){ AV.db.setMeta('fxa', fxa).catch(function(){}); }, 1500); }

  /* One pass over the decoded song: loudness, bass/treble balance, where the music starts and ends, tempo and beat positions. */
  function measure(buf){
    var ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, d0 = buf.getChannelData(0), d1 = ch > 1 ? buf.getChannelData(1) : null;
    var blk = Math.max(1024, Math.round(sr * .4)), nb = Math.floor(n / blk);
    if (nb < 1) return null;
    var hop = Math.max(64, Math.round(sr * .01)), nh = Math.floor(n / hop);
    var a1 = 1 - Math.exp(-2 * Math.PI * 250 / sr), a2 = 1 - Math.exp(-2 * Math.PI * 4000 / sr), y1 = 0, y2 = 0, peak = 0;
    var ms = new Float64Array(nb), eL = new Float64Array(nb), eM = new Float64Array(nb), eH = new Float64Array(nb);
    var hl = new Float32Array(nh), ha = new Float32Array(nh);
    var bs = 0, bl = 0, bm = 0, bh = 0, bi = 0, bc = 0, hs = 0, hla = 0, hi = 0, hc = 0;
    for (var i = 0; i < n; i++){
      var x = d1 ? (d0[i] + d1[i]) * .5 : d0[i], ax = x < 0 ? -x : x; if (ax > peak) peak = ax;
      y1 += a1 * (x - y1); y2 += a2 * (x - y2);
      var mi = y2 - y1, hh = x - y2;
      bs += x * x; bl += y1 * y1; bm += mi * mi; bh += hh * hh; bc++;
      hs += x * x; hla += y1 * y1; hc++;
      if (bc === blk){ if (bi < nb){ ms[bi] = bs / blk; eL[bi] = bl / blk; eM[bi] = bm / blk; eH[bi] = bh / blk; bi++; } bs = bl = bm = bh = 0; bc = 0; }
      if (hc === hop){ if (hi < nh){ ha[hi] = Math.sqrt(hs / hop); hl[hi] = Math.sqrt(hla / hop); hi++; } hs = hla = 0; hc = 0; }
    }
    /* loudness and balance: ignore near-silence and quiet passages (two-step gate, like broadcast meters) */
    var keep = []; for (var k = 0; k < nb; k++) if (ms[k] > 1e-9) keep.push(k);
    if (!keep.length) return null;
    var avg = keep.reduce(function(a, q){ return a + ms[q]; }, 0) / keep.length, gate = avg * .1;
    var keep2 = keep.filter(function(q){ return ms[q] >= gate; }); if (!keep2.length) keep2 = keep;
    function sum(arr){ return keep2.reduce(function(a, q){ return a + arr[q]; }, 0) / keep2.length; }
    var level = 10 * Math.log10(sum(ms)), L = sum(eL), M = sum(eM), H = sum(eH);
    /* where the music is */
    function db(q){ return 10 * Math.log10(ms[q] + 1e-12); }
    var thr = level - 9, st = -1, ls = -1, le = -1, en = -1;
    for (k = 0; k < nb; k++){ var d = db(k); if (st < 0 && d > -55) st = k; if (ls < 0 && d >= thr) ls = k; if (d >= thr) le = k; if (d > -55) en = k; }
    var sec = blk / sr, dur = n / sr;
    var r = { v: 2, lv: +level.toFixed(2), pk: +(20 * Math.log10(Math.max(peak, 1e-6))).toFixed(2),
      lm: +(10 * Math.log10((L + 1e-12) / (M + 1e-12))).toFixed(2), hm: +(10 * Math.log10((H + 1e-12) / (M + 1e-12))).toFixed(2), d: +dur.toFixed(1),
      st: +(Math.max(0, st) * sec).toFixed(2), ls: +(Math.max(0, ls) * sec).toFixed(2), le: +((le + 1) * sec).toFixed(2), en: +(Math.min(nb, en + 1) * sec).toFixed(2) };
    var tp = tempo(hl, ha, nh, r);
    if (tp){ r.bpm = tp.bpm; r.bc = tp.conf; r.p0 = tp.p0; r.p1 = tp.p1; }
    return r;
  }

  /* tempo and beat positions from the 100-per-second energy curves */
  function tempo(hl, ha, nh, r){
    if (nh < 1500) return null;
    var on = new Float32Array(nh), k;
    for (k = 1; k < nh; k++){ on[k] = Math.max(0, hl[k] - hl[k - 1]) + .6 * Math.max(0, ha[k] - ha[k - 1]); }
    /* flatten: subtract a half-second moving average so only sharp hits remain */
    var W = 50, run = 0, flat = new Float32Array(nh);
    for (k = 0; k < nh; k++){ run += on[k]; if (k >= W) run -= on[k - W]; flat[k] = Math.max(0, on[k] - run / Math.min(W, k + 1) * 1.1); }
    var a0 = Math.round(Math.max(0, r.ls) * 100), a1 = Math.min(nh, Math.round((r.le || nh / 100) * 100)); if (a1 - a0 < 1500){ a0 = 0; a1 = nh; }
    var c0 = a0 + Math.max(0, Math.round(((a1 - a0) - 12000) / 2)), c1 = Math.min(a1, c0 + 12000);      /* up to two minutes from the middle of the music */
    var lo = Math.round(6000 / 180), hi = Math.round(6000 / 70), best = 0, bestLag = 0, lag, i, ac;
    for (lag = lo; lag <= hi; lag++){
      ac = 0; for (i = c0; i + lag < c1; i++) ac += flat[i] * flat[i + lag]; ac /= (c1 - c0 - lag);
      var bpmL = 6000 / lag, wgt = Math.exp(-.5 * Math.pow(Math.log(bpmL / 122) / Math.LN2 / .75, 2));
      if (ac * wgt > best){ best = ac * wgt; bestLag = lag; }
    }
    if (!bestLag || best <= 0) return null;
    var b0 = 6000 / bestLag;
    /* refine on a fine grid, scoring a regular grid of beats against the hits */
    function score(bpm, from, to, keepAll){
      var P = 6000 / bpm, bestS = -1, bestF = 0, tot = 0, cnt = 0, f, t, j, s;
      for (f = 0; f < P; f += 1){
        s = 0; for (t = from + f; t < to - 1; t += P){ j = Math.round(t); var m = flat[j]; if (flat[j - 1] > m) m = flat[j - 1]; if (flat[j + 1] > m) m = flat[j + 1]; s += m; }
        tot += s; cnt++; if (s > bestS){ bestS = s; bestF = f; }
      }
      return { s: bestS, f: bestF, mean: tot / cnt, P: P };
    }
    var bb = b0, bs = -1, br = null, cand;
    for (cand = b0 - 2.2; cand <= b0 + 2.2; cand += .05){ if (cand < 60) continue; var sc = score(cand, c0, c1); if (sc.s > bs){ bs = sc.s; bb = cand; br = sc; } }
    if (!br || br.mean <= 0) return null;
    var conf = br.s / br.mean;
    /* local phase near the start and near the end of the music, so the grid is exact where we will mix */
    var P = 6000 / bb;
    function phaseAt(from, to){
      from = Math.max(0, Math.min(from, nh - 800)); to = Math.min(nh, Math.max(to, from + 800));
      var q = score(bb, from, to); return ((from + q.f) % P) / 100;
    }
    var intro0 = Math.round(Math.max(r.st, 0) * 100), endE = Math.round((r.en || nh / 100) * 100);
    return { bpm: +bb.toFixed(2), conf: +conf.toFixed(2), p0: +phaseAt(intro0, intro0 + 3200).toFixed(3), p1: +phaseAt(endE - 3200, endE).toFixed(3) };
  }

  function decode(arr){
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; var o = new OAC(1, 1, 44100);
    return new Promise(function(res, rej){ var p = o.decodeAudioData(arr, res, rej); if (p && p.then) p.then(res, rej); });
  }
  function blobOf(t){ return t.synth ? AV.synthWav(t.synth) : t.blob; }
  F.measureTrack = function(t){
    return loadCache().then(function(){
      if (fresh(t.id)) return fxa[t.id];
      var blob = blobOf(t); if (!blob || blob.size > MAX_BYTES){ if (fxa[t.id]) fxa[t.id].nt = 1; else fxa[t.id] = { skip: 1 }; return null; }
      return blob.arrayBuffer().then(decode).then(function(buf){
        var r = measure(buf); buf = null;
        if (r){ fxa[t.id] = r; saveCache(); } else { if (fxa[t.id]) fxa[t.id].nt = 1; else fxa[t.id] = { skip: 1 }; saveCache(); }
        return r;
      }).catch(function(){ if (fxa[t.id]) fxa[t.id].nt = 1; return null; });
    });
  };
  function fresh(id){ var r = fxa[id]; return !!r && (r.skip || r.nt || r.v >= 2); }
  F.forget = function(id){ if (fxa[id]){ delete fxa[id]; saveCache(); } };
  F.analysisOf = function(id){ var r = fxa[id]; return r && !r.skip ? r : null; };

  /* measure one song at a time, never while the phone is busy starting a new one */
  function pump(){
    if (analysing || !queue.length) return; analysing = true;
    var t = queue.shift();
    F.measureTrack(t).then(function(){ analysing = false; applyLevelAll(); setTimeout(pump, 250); }, function(){ analysing = false; setTimeout(pump, 250); });
  }
  function enqueue(t){ if (t && !fresh(t.id) && queue.indexOf(t) < 0 && queue.length < 400) queue.push(t); }

  /* ---------- per-album decisions ---------- */
  function median(a){ if (!a.length) return null; a = a.slice().sort(function(x, y){ return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function profile(al){
    var list = AV.store.tracksOf(al.id), rs = list.map(function(t){ return F.analysisOf(t.id); }).filter(Boolean);
    if (!rs.length) return null;
    return { n: rs.length, of: list.length, lv: median(rs.map(function(r){ return r.lv; })), lm: median(rs.map(function(r){ return r.lm; })), hm: median(rs.map(function(r){ return r.hm; })) };
  }
  function dead(v){ return Math.abs(v) < 2.5 ? 0 : v - (v > 0 ? 2.5 : -2.5); }
  F.currentAlbumId = null; var curEl = null, curTrack = null;
  function applyLevelAll(){
    if (!curTrack) return;
    var al = AV.store.album(curTrack.albumId), pr = al ? profile(al) : null, me = F.analysisOf(curTrack.id);
    /* auto EQ from the album's balance */
    var ab = 0, at = 0, tag = '';
    if (pr && st.auto){
      ab = clamp(.5 * dead(REF_LM - pr.lm), -3.5, 3.5); at = clamp(.5 * dead(REF_HM - pr.hm), -3.5, 3.5);
    }
    album.bass = +ab.toFixed(1); album.treble = +at.toFixed(1);
    /* volume: album level when most of the album is measured, otherwise this song's own level */
    var lv = null, mode = '';
    if (pr && pr.n >= Math.ceil(pr.of * .5)){ lv = pr.lv; mode = 'album'; } else if (me){ lv = me.lv; mode = 'song'; }
    var gain = 0;
    if (st.norm && lv != null){
      gain = clamp(TARGET - lv, -10, 9);
      if (me) gain = Math.min(gain, 2 - me.pk);   /* never push a loud peak far into the limiter */
    }
    album.level = lv == null ? null : +gain.toFixed(1); album.mode = mode; album.measured = pr ? pr.n : (me ? 1 : 0); album.total = pr ? pr.of : 1;
    if (ctx && N && curEl){ var s = nodeOf(curEl); if (s) ramp(s.norm.gain, st.on && st.norm ? dbToGain(gain) : 1, .6); }
    F.apply(false); emit('album');
  }
  F.applyLevelAll = applyLevelAll;

  /* a new song was loaded into this element */
  F.onTrack = function(el, t, instant){
    curEl = el; curTrack = t; var s = nodeOf(el);
    if (s){ s.norm.gain.cancelScheduledValues(ctx.currentTime); s.norm.gain.setValueAtTime(1, ctx.currentTime); }
    loadCache().then(function(){
      if (curTrack !== t) return;
      var al = AV.store.album(t.albumId);
      /* this song first, then the rest of its album, then the song after it */
      enqueue(t); if (al) AV.store.tracksOf(al.id).forEach(enqueue);
      if (queue.indexOf(t) > 0){ queue.splice(queue.indexOf(t), 1); queue.unshift(t); }
      applyLevelAll(); pump();
    });
  };
  F.wantNext = function(t){ if (!t || fresh(t.id)) return; var i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); queue.splice(Math.min(1, queue.length), 0, t); pump(); };
  F.status = function(){
    var parts = [];
    if (st.auto && (album.bass || album.treble)) parts.push((album.bass ? 'Bass ' + (album.bass > 0 ? '+' : '') + album.bass : '') + (album.bass && album.treble ? ' · ' : '') + (album.treble ? 'Treble ' + (album.treble > 0 ? '+' : '') + album.treble : ''));
    if (st.norm && album.level != null) parts.push('Volume ' + (album.level > 0 ? '+' : '') + album.level + ' dB');
    return parts.join('  ·  ');
  };
})();
