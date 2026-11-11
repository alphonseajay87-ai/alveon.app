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
  var DEF = { on: true, auto: true, norm: true, xfade: 4, xmode: 'dj', mixpref: 'beat', xlen: 16, sfx: 'light', space: 'off', orbit: 8, preset: 'Flat', b: [0, 0, 0, 0, 0], bass: 0, treble: 0, custom: [] };

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
    o.xfade = clamp(+o.xfade || 0, 0, 12); o.xlen = clamp(Math.round((+o.xlen || 16) / 4) * 4, 8, 32); if (['off', 'smooth', 'dj'].indexOf(o.xmode) < 0) o.xmode = 'dj'; if (['smooth', 'beat', 'harmonic', 'energy'].indexOf(o.mixpref) < 0) o.mixpref = 'beat'; if (['off', 'wide', '8d', 'surround'].indexOf(o.space) < 0) o.space = 'off'; if (['off', 'light', 'full'].indexOf(o.sfx) < 0) o.sfx = 'light'; o.orbit = clamp(+o.orbit || 8, 4, 20); o.bass = clamp(+o.bass || 0, -12, 12); o.treble = clamp(+o.treble || 0, -12, 12);
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
  F.state = function(){ return ctx ? ctx.state : null; };
  /* safe mode: drop the sound engine completely; the player then plays on plain audio elements */
  F.disable = function(){
    failed = true; var c = ctx; ctx = null; N = null; elA = elB = null; an = null;
    try { if (c && c.close) c.close().catch(function(){}); } catch (e) {}
    emit('failed');
  };
  F._t = function(){ return { N: N, ctx: ctx }; };
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
          var src = ctx.createMediaElementSource(el), norm = ctx.createGain(), kill = ctx.createBiquadFilter(), flt = ctx.createBiquadFilter(), fade = ctx.createGain(), send = ctx.createGain(), eqL = ctx.createBiquadFilter(), eqM = ctx.createBiquadFilter(), eqH = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
          eqL.type = 'lowshelf'; eqL.frequency.value = 160; eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.Q.value = .7; eqH.type = 'highshelf'; eqH.frequency.value = 4500; hp.type = 'highpass'; hp.frequency.value = 10; hp.Q.value = .7;
          kill.type = 'lowshelf'; kill.frequency.value = 200; kill.gain.value = 0; send.gain.value = 0;
          flt.type = 'lowpass'; flt.frequency.value = 22000; flt.Q.value = .7;
          src.connect(norm); norm.connect(kill); kill.connect(eqL); eqL.connect(eqM); eqM.connect(eqH); eqH.connect(hp); hp.connect(flt); flt.connect(fade); fade.connect(mix); kill.connect(send); send.connect(echo.dl);
          return { src: src, norm: norm, kill: kill, flt: flt, fade: fade, send: send, el: el, eqL: eqL, eqM: eqM, eqH: eqH, hp: hp };
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
        try { an = ctx.createAnalyser(); an.fftSize = 512; anBuf = new Float32Array(an.fftSize); lim.connect(an); } catch (e) { an = null; }
        N = { A: A, B: B, mix: mix, echo: echo, bass: bass, treble: treble, bands: bands, pre: pre, lim: lim, spOut: spOut, sp: null, spMode: 'off', spTok: 0 };
        F.apply(true); applySpace();
        /* iOS suspends/interrupts the audio context (screen lock, calls, heavy work): wake it whenever it stops */
        var wake = function(){ if (ctx && ctx.state !== 'running' && elA && (!elA.paused || !elB.paused)){ try { var r = ctx.resume(); if (r && r.catch) r.catch(function(){}); } catch (e) {} } };
        try { ctx.onstatechange = wake; } catch (e) {}
        ['visibilitychange', 'pageshow', 'focus'].forEach(function(n){ (n === 'pageshow' || n === 'focus' ? window : document).addEventListener(n, wake); });
        ['touchstart', 'pointerdown', 'click'].forEach(function(n){ document.addEventListener(n, wake, true); });
        setInterval(wake, 1000);
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
  /* mixes the person set by hand in the Mix Studio: which songs, where in each, how many beats */
  var xo = {}; try { xo = JSON.parse(localStorage.getItem('alveon.xo') || '{}') || {}; } catch (e) {}
  function xoSave(){ try { var k = {}; for (var id in xo) if (xo[id].keep) k[id] = xo[id]; localStorage.setItem('alveon.xo', JSON.stringify(k)); } catch (e) {} }
  F.getOverride = function(a, b){ return xo[a + '>' + b] || null; };
  F.setOverride = function(a, b, o){ xo[a + '>' + b] = o; if (o.keep) xoSave(); };
  F.dropTemp = function(a, b){ var o = xo[a + '>' + b]; if (o && !o.keep) delete xo[a + '>' + b]; };
  F.clearOverride = function(a, b){ delete xo[a + '>' + b]; xoSave(); };
  F.hasOverride = function(a, b){ var o = xo[a.id + '>' + b.id]; return !!(o && o.keep); };
  function planFrom(o, A, B, D){
    var beats = o.beats || 16;
    if (A && B && A.bpm && B.bpm){
      var pa = 60 / A.bpm, c = [B.bpm * .5, B.bpm, B.bpm * 2], cb = c[1], d = 9, i;
      for (i = 0; i < 3; i++){ var e = Math.abs(Math.log(c[i] / A.bpm)); if (e < d){ d = e; cb = c[i]; } }
      var rate = (o.rc && o.rc.sync === false) ? 1 : clamp(A.bpm / cb, .92, 1.08), secs = beats * pa;
      var aS = clamp(o.a, 0, Math.max(0, (D || A.d) - secs - .3));
      return { type: 'dj', bpmA: A.bpm, bpmB: B.bpm, bpmUsed: +cb.toFixed(2), rate: rate, beats: beats, secs: secs, aStart: aS, bStart: Math.max(0, o.b || 0), why: '', manual: true, rc: o.rc };
    }
    return { type: 'smooth', secs: clamp(beats * .5, 2, 24), why: 'set by you', manual: true };
  }
  F.planFor = function(ta, tb, o, durA){ var A = F.analysisOf(ta.id), B = F.analysisOf(tb.id); return planFrom(o, A, B, durA || (A && A.d) || ta.dur || 0); };
  F.plan = function(ta, tb, durA){
    if (!ta || !tb) return null;
    var A = F.analysisOf(ta.id), B = F.analysisOf(tb.id), len = st.xlen, D = durA || (A && A.d) || ta.dur || 0;
    var ov = xo[ta.id + '>' + tb.id]; if (ov && st.xmode !== 'off') return planFrom(ov, A, B, D);
    var sm = { type: 'smooth', secs: Math.min(len, 6), why: '' };
    if (st.xmode === 'smooth'){ sm.secs = st.xfade; return sm; }
    if (st.mixpref === 'smooth'){ sm.secs = Math.min(len, 12); sm.why = 'smooth style'; return sm; }
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
  /* Transition recipe (what the Mix Studio edits): vol = how the two volumes move, eq = when the bass changes hands, flt = filter sweeps, fx = sounds. */
  F.RECIPE = { vol: ['overlap', 'fadefade', 'cutfade', 'fadecut', 'centercut', 'custom'], eq: ['none', 'center', 'end', 'start', 'band3', 'quick', 'custom'], flt: ['none', 'lpout', 'lpin', 'lpinout', 'lpinhpout', 'custom'], fx: ['auto', 'none', 'light', 'full'] };
  F.recipeOf = function(rc){ rc = rc || {}; var R = F.RECIPE; return { vol: R.vol.indexOf(rc.vol) < 0 ? 'overlap' : rc.vol, eq: R.eq.indexOf(rc.eq) < 0 ? 'center' : rc.eq, flt: R.flt.indexOf(rc.flt) < 0 ? 'none' : rc.flt, fx: R.fx.indexOf(rc.fx) < 0 ? 'auto' : rc.fx, cv: rc.cv || null, g: rc.g || null, t3: rc.t3 || null, lp: rc.lp == null ? 1 : rc.lp, hp: rc.hp == null ? 0 : rc.hp, sync: rc.sync !== false }; };
  /* hand-drawn curves: a list of [position 0..1, value 0..1] points per song, joined by straight lines */
  function ptsAt(cv, key, isIn, u){
    var a = cv && cv[key] && cv[key][isIn ? 'b' : 'a']; if (!a || a.length < 2) return null;
    if (u <= a[0][0]) return a[0][1]; var i; for (i = 1; i < a.length; i++){ if (u <= a[i][0]){ var x0 = a[i - 1][0], x1 = a[i][0]; return x1 > x0 ? a[i - 1][1] + (a[i][1] - a[i - 1][1]) * (u - x0) / (x1 - x0) : a[i][1]; } }
    return a[a.length - 1][1];
  }
  F.FMIN = 220; F.FMAX = 20000;
  F.fOfN = function(n){ return F.FMIN * Math.pow(F.FMAX / F.FMIN, clamp(n, 0, 1)); };
  F.nOfF = function(f){ return clamp(Math.log(f / F.FMIN) / Math.log(F.FMAX / F.FMIN), 0, 1); };
  /* volume curves over 0..1 of the mix */
  F.volAt = function(vol, u, isIn, cv){
    var h = Math.PI / 2, x;
    switch (vol){
      case 'custom': x = ptsAt(cv, 'vol', isIn, u); if (x != null) return clamp(x, 0, 1); return isIn ? Math.sin(u * h) : Math.cos(u * h);
      case 'fadefade': return isIn ? (u < .5 ? 0 : Math.sin((u - .5) * 2 * h)) : (u < .5 ? Math.cos(u * 2 * h) : 0);
      case 'cutfade': return isIn ? 1 : Math.cos(u * h);
      case 'fadecut': return isIn ? Math.sin(u * h) : (u < .98 ? 1 : 0);
      case 'centercut': x = u < .5 ? 0 : 1; return isIn ? x : 1 - x;
      default: return isIn ? Math.sin(u * h) : Math.cos(u * h);
    }
  };
  /* bass: 0 = full, 1 = removed, for each song over the mix */
  F.bassAt = function(eq, u, isIn, cv){
    function step(a, w){ return clamp((u - a) / w, 0, 1); }
    var k;
    switch (eq){
      case 'none': return 0;
      case 'custom': k = ptsAt(cv, 'eq', isIn, u); return k == null ? 0 : clamp(k, 0, 1);
      case 'end': k = step(.88, .08); break;
      case 'start': k = step(.08, .06); break;
      case 'band3': k = step(.2, .6); break;
      case 'quick': return isIn ? (u < .5 ? 1 : 0) : (u < .12 ? 0 : 1);
      default: k = step(.5, .08);
    }
    return isIn ? 1 - k : k;
  };
  F.filterAt = function(flt, u, isIn, cv){ /* returns { type, f } or null */
    var lo = 20000, mn = 220;
    if (flt === 'custom'){ var n = ptsAt(cv, 'flt', isIn, u); return n == null ? null : { type: 'lowpass', f: F.fOfN(n) }; }
    if (isIn){ if (flt === 'lpin' || flt === 'lpinout' || flt === 'lpinhpout') return { type: 'lowpass', f: mn * Math.pow(lo / mn, clamp(u * 1.25, 0, 1)) }; return null; }
    if (flt === 'lpout' || flt === 'lpinout') return { type: 'lowpass', f: lo * Math.pow(mn / lo, clamp(u * 1.1, 0, 1)) };
    if (flt === 'lpinhpout') return { type: 'highpass', f: 25 * Math.pow(3500 / 25, clamp(u * 1.1, 0, 1)) };
    return null;
  };
  /* the fine-tuning from the Mix Studio: three-band tone per song plus a high-pass; kept apart from the mix curves so it can be heard live */
  function neutral(n, now){ try { ['eqL', 'eqM', 'eqH'].forEach(function(k){ n[k].gain.cancelScheduledValues(now); n[k].gain.setValueAtTime(0, now); }); n.hp.frequency.cancelScheduledValues(now); n.hp.frequency.setValueAtTime(10, now); } catch (e) {} }
  function tone(n, t3, hpN, now){
    try {
      ['eqL', 'eqM', 'eqH'].forEach(function(k, i){ n[k].gain.cancelScheduledValues(now); n[k].gain.setTargetAtTime(clamp(t3 ? +t3[i] || 0 : 0, -30, 12), now, .02); });
      n.hp.frequency.cancelScheduledValues(now); n.hp.frequency.setTargetAtTime(hpN > .001 ? 20 * Math.pow(100, clamp(hpN, 0, 1)) : 10, now, .03);
    } catch (e) {}
  }
  F.previewRc = null;
  F.setStatic = function(elA, elB, rc){ if (!ctx || !N) return; var R = F.recipeOf(rc), now = ctx.currentTime, a = nodeOf(elA), b = nodeOf(elB); F.previewRc = R; if (a) tone(a, R.t3 && R.t3.a, R.hp, now); if (b) tone(b, R.t3 && R.t3.b, R.hp, now); };
  F.clearStatic = function(){ F.previewRc = null; if (!ctx || !N) return; var now = ctx.currentTime; neutral(N.A, now); neutral(N.B, now); };
  F.beginMix = function(fromEl, toEl, secs, swapAt, beatSecs, rc){
    var f = nodeOf(fromEl), t = nodeOf(toEl); if (!f || !t) return false;
    var now = ctx.currentTime, R = F.recipeOf(rc), n = 64, i;
    try {
      [f, t].forEach(function(x){ x.fade.gain.cancelScheduledValues(now); x.kill.gain.cancelScheduledValues(now); x.flt.frequency.cancelScheduledValues(now); });
      var cf = new Float32Array(n), ct = new Float32Array(n), kf = new Float32Array(n), kt = new Float32Array(n), ff = new Float32Array(n), ft = new Float32Array(n);
      var fa = F.filterAt(R.flt, .5, false, R.cv), ta = F.filterAt(R.flt, .5, true, R.cv);
      for (i = 0; i < n; i++){
        var u = i / (n - 1);
        cf[i] = F.volAt(R.vol, u, false, R.cv); ct[i] = F.volAt(R.vol, u, true, R.cv);
        kf[i] = KILL * F.bassAt(R.eq, u, false, R.cv); kt[i] = KILL * F.bassAt(R.eq, u, true, R.cv);
        var a = F.filterAt(R.flt, u, false, R.cv), b = F.filterAt(R.flt, u, true, R.cv); ff[i] = a ? a.f : 22000; ft[i] = b ? b.f : 22000;
      }
      f.fade.gain.setValueAtTime(cf[0], now); t.fade.gain.setValueAtTime(ct[0], now);
      f.fade.gain.setValueCurveAtTime(cf, now, secs); t.fade.gain.setValueCurveAtTime(ct, now, secs);
      f.kill.gain.setValueAtTime(kf[0], now); t.kill.gain.setValueAtTime(kt[0], now);
      f.kill.gain.setValueCurveAtTime(kf, now, secs); t.kill.gain.setValueCurveAtTime(kt, now, secs);
      if (R.lp < .995){ var cap = F.fOfN(R.lp); if (!fa) fa = { type: 'lowpass' }; if (!ta) ta = { type: 'lowpass' }; for (i = 0; i < n; i++){ if (fa.type === 'lowpass') ff[i] = Math.min(ff[i], cap); if (ta.type === 'lowpass') ft[i] = Math.min(ft[i], cap); } }
      f.flt.type = fa ? fa.type : 'lowpass'; t.flt.type = ta ? ta.type : 'lowpass';
      f.flt.frequency.setValueAtTime(ff[0], now); t.flt.frequency.setValueAtTime(ft[0], now);
      if (fa) f.flt.frequency.setValueCurveAtTime(ff, now, secs); if (ta) t.flt.frequency.setValueCurveAtTime(ft, now, secs);
      if (R.g){ var ga = clamp(R.g.a == null ? 1 : R.g.a, 0, 1.5), gb = clamp(R.g.b == null ? 1 : R.g.b, 0, 1.5); for (i = 0; i < n; i++){ cf[i] *= ga; ct[i] *= gb; } f.fade.gain.cancelScheduledValues(now); t.fade.gain.cancelScheduledValues(now); f.fade.gain.setValueAtTime(cf[0], now); t.fade.gain.setValueAtTime(ct[0], now); f.fade.gain.setValueCurveAtTime(cf, now, secs); t.fade.gain.setValueCurveAtTime(ct, now, secs); }
      tone(f, R.t3 && R.t3.a, R.hp, now); tone(t, R.t3 && R.t3.b, R.hp, now);
      var lvl = R.fx === 'auto' ? st.sfx : R.fx;
      if (R.fx !== 'none') sfxMix(ctx, N.mix, N.echo, f.send, lvl, now + Math.max(.05, swapAt), Math.max(.05, swapAt), Math.max(.2, beatSecs || .5), 'beat');
    } catch (e) { return false; }
    return true;
  };
  /* safety net: a song that is playing on its own must always be at full level, with an open filter and a running audio engine */
  /* silence detector: the app can believe a song is playing while the phone outputs nothing. Listen to the real output and repair it in stages. */
  var an = null, anBuf = null, sil = 0, stage = 0, healAt = 0, hLastCt = -1, hLastTr = null;
  function outLevel(){ if (!an) return 1; an.getFloatTimeDomainData(anBuf); var m = 0, i, v; for (i = 0; i < anBuf.length; i++){ v = Math.abs(anBuf[i]); if (v > m) m = v; } return m; }
  F.outLevel = outLevel;
  function note(k, m){ try { AV.playlog && AV.playlog.note && AV.playlog.note(k, m); } catch (e) {} }
  F.heal = function(el){
    if (!ctx || !N || !el || !an) return;
    var ct = el.currentTime, moving = hLastCt >= 0 && ct > hLastCt + .2; hLastCt = ct;
    if (el.paused || el.ended || document.hidden || !moving || ct < 1.5 || el.readyState < 3){ sil = 0; return; }
    if (outLevel() > .0006){ if (sil >= 4) note('ok', 'sound is back'); sil = 0; stage = 0; return; }
    sil++; if (sil < 4 || Date.now() - healAt < 2500) return;
    healAt = Date.now(); stage++;
    var now = ctx.currentTime, n = nodeOf(el);
    try {
      if (stage === 1){
        note('SILENT', 'no sound for ' + sil + ' s while playing; resetting the audio chain');
        if (n){ [n.fade.gain, n.norm.gain].forEach(function(g){ g.cancelScheduledValues(now); g.setValueAtTime(1, now); }); n.kill.gain.cancelScheduledValues(now); n.kill.gain.setValueAtTime(0, now); neutral(n, now); n.flt.frequency.cancelScheduledValues(now); n.flt.type = 'lowpass'; n.flt.frequency.setValueAtTime(22000, now); }
        N.mix.gain.cancelScheduledValues(now); N.mix.gain.setValueAtTime(1, now);
        ctx.suspend().then(function(){ return ctx.resume(); }).catch(function(){});
      } else if (stage === 2){
        note('SILENT', 'still silent; nudging the song (pause and play)');
        el.pause(); setTimeout(function(){ var p = el.play(); if (p && p.catch) p.catch(function(){}); }, 120);
      } else if (stage === 3){
        note('SILENT', 'still silent; reloading the song at ' + ct.toFixed(0) + 's');
        var src = el.currentSrc || el.src; el.src = src; el.load();
        var back = function(){ el.removeEventListener('loadedmetadata', back); try { el.currentTime = ct; } catch (e) {} var p = el.play(); if (p && p.catch) p.catch(function(){}); };
        el.addEventListener('loadedmetadata', back);
      } else if (stage === 4){
        note('SILENT', 'still silent after every repair; switching to safe mode');
        if (AV.player && AV.player.safeMode) AV.player.safeMode('silent after repairs');
      } else if (stage >= 5){ stage = 0; sil = 0; }
    } catch (e) {}
  };
  F.guard = function(el){
    if (!ctx || !N) return; var n = nodeOf(el); if (!n) return; var now = ctx.currentTime;
    try {
      if (ctx.state !== 'running') ctx.resume();
      if (!F.previewRc && (Math.abs(n.eqL.gain.value) > .05 || Math.abs(n.eqM.gain.value) > .05 || Math.abs(n.eqH.gain.value) > .05 || n.hp.frequency.value > 11)) neutral(n, now);
      if (n.fade.gain.value < .985){ n.fade.gain.cancelScheduledValues(now); n.fade.gain.setValueAtTime(1, now); }
      if (n.kill.gain.value < -.5){ n.kill.gain.cancelScheduledValues(now); n.kill.gain.setValueAtTime(0, now); }
      if (n.flt.frequency.value < 21000 || n.flt.type !== 'lowpass'){ n.flt.frequency.cancelScheduledValues(now); n.flt.type = 'lowpass'; n.flt.frequency.setValueAtTime(22000, now); }
    } catch (e) {}
  };
  /* the song coming in did not start properly: give the old one its full sound back at once */
  F.rescue = function(oldEl, newEl){
    if (!ctx || !N) return; var now = ctx.currentTime;
    [[oldEl, 1], [newEl, 0]].forEach(function(x){ var n = nodeOf(x[0]); if (!n) return; try { n.fade.gain.cancelScheduledValues(now); n.fade.gain.setValueAtTime(n.fade.gain.value, now); n.fade.gain.linearRampToValueAtTime(x[1], now + .12); n.kill.gain.cancelScheduledValues(now); n.kill.gain.setValueAtTime(0, now); n.flt.frequency.cancelScheduledValues(now); n.flt.type = 'lowpass'; n.flt.frequency.setValueAtTime(22000, now); n.send.gain.cancelScheduledValues(now); n.send.gain.setValueAtTime(0, now); neutral(n, now); } catch (e) {} });
    sfxLive.forEach(function(l){ try { l.bus.gain.cancelScheduledValues(now); l.bus.gain.setTargetAtTime(0, now, .02); l.S.forEach(function(q){ try { q.stop(now + .25); } catch (e) {} }); } catch (e) {} }); sfxLive = [];
  };
  F.endMix = function(){
    if (!ctx || !N) return; var now = ctx.currentTime;
    sfxLive.forEach(function(l){ try { l.bus.gain.cancelScheduledValues(now); l.bus.gain.setTargetAtTime(0, now, .02); l.S.forEach(function(n){ try { n.stop(now + .25); } catch (e) {} }); } catch (e) {} }); sfxLive = [];
    [N.A, N.B].forEach(function(n){ try { n.kill.gain.cancelScheduledValues(now); n.kill.gain.setValueAtTime(0, now); n.send.gain.cancelScheduledValues(now); n.send.gain.setValueAtTime(0, now); n.flt.frequency.cancelScheduledValues(now); n.flt.type = 'lowpass'; n.flt.frequency.setValueAtTime(22000, now); if (!F.previewRc) neutral(n, now); } catch (e) {} });
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
    var r = { v: 3, lv: +level.toFixed(2), pk: +(20 * Math.log10(Math.max(peak, 1e-6))).toFixed(2),
      lm: +(10 * Math.log10((L + 1e-12) / (M + 1e-12))).toFixed(2), hm: +(10 * Math.log10((H + 1e-12) / (M + 1e-12))).toFixed(2), d: +dur.toFixed(1),
      st: +(Math.max(0, st) * sec).toFixed(2), ls: +(Math.max(0, ls) * sec).toFixed(2), le: +((le + 1) * sec).toFixed(2), en: +(Math.min(nb, en + 1) * sec).toFixed(2) };
    var tp = tempo(hl, ha, nh, r);
    if (tp){ r.bpm = tp.bpm; r.bc = tp.conf; r.p0 = tp.p0; r.p1 = tp.p1; }
    try { r.sp = sonic(buf, r, tp); } catch (e) {}
    return r;
  }


  /* ---------- ALVéON Sonic Intelligence (background only): every song gets its own profile ---------- */
  var TONIC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var CAM_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1], CAM_MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  var KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function fft(re, im){
    var n = re.length, i, j = 0, k, m;
    for (i = 1; i < n; i++){ var bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j){ var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (m = 2; m <= n; m <<= 1){
      var ang = -2 * Math.PI / m, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += m){
        var cr = 1, ci = 0, h = m >> 1;
        for (k = 0; k < h; k++){
          var a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function corr(a, b){ var n = a.length, ma = 0, mb = 0, i; for (i = 0; i < n; i++){ ma += a[i]; mb += b[i]; } ma /= n; mb /= n; var sa = 0, sb = 0, sab = 0; for (i = 0; i < n; i++){ var x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; sab += x * y; } return sab / Math.sqrt(sa * sb + 1e-12); }
  function sonic(buf, r, tp){
    var sr0 = buf.sampleRate, d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    var dec = Math.max(1, Math.round(sr0 / 11025)), sr = sr0 / dec, N = 4096, total = Math.floor(buf.length / dec);
    var seg = Math.min(total, Math.floor(sr * 70)), s0 = Math.max(0, Math.floor((total - seg) / 2)), x = new Float32Array(seg), i, j;
    for (i = 0; i < seg; i++){ var acc = 0, base = (s0 + i) * dec; for (j = 0; j < dec; j++){ acc += d1 ? (d0[base + j] + d1[base + j]) * .5 : d0[base + j]; } x[i] = acc / dec; }
    var frames = Math.floor(seg / N); if (frames < 4) return null;
    var win = new Float32Array(N); for (i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1));
    var chroma = new Float64Array(12), re = new Float32Array(N), im = new Float32Array(N), prev = new Float32Array(N / 2);
    var pLow = 0, pMid = 0, pHi = 0, cent = 0, flux = 0, midShare = 0, fr, k;
    for (fr = 0; fr < frames; fr++){
      for (i = 0; i < N; i++){ re[i] = x[fr * N + i] * win[i]; im[i] = 0; }
      fft(re, im);
      var sm = 0, sf = 0, fl = 0, fmid = 0, ftot = 1e-12;
      for (k = 1; k < N / 2; k++){
        var f = k * sr / N, mg = Math.sqrt(re[k] * re[k] + im[k] * im[k]), pw = mg * mg;
        if (f >= 55 && f <= 2000){ var pc = ((Math.round(12 * Math.log(f / 440) / Math.LN2) + 69) % 12 + 12) % 12; chroma[pc] += mg; }
        ftot += pw; sf += f * pw; sm += mg; fl += Math.max(0, mg - prev[k]); prev[k] = mg;
        if (f < 250) pLow += pw; else if (f < 3400){ pMid += pw; fmid += pw; } else pHi += pw;
      }
      cent += sf / ftot; flux += fl / (sm + 1e-9); midShare += fmid / ftot;
    }
    cent /= frames; flux /= frames; midShare /= frames;
    var best = -2, second = -2, bk = 0, bm = 0, p, m2, rot = new Array(12);
    for (m2 = 0; m2 < 2; m2++) for (p = 0; p < 12; p++){
      for (i = 0; i < 12; i++) rot[i] = (m2 ? KS_MIN : KS_MAJ)[(i - p + 12) % 12];
      var c = corr(Array.prototype.slice.call(chroma), rot);
      if (c > best){ second = best; best = c; bk = p; bm = m2; } else if (c > second) second = c;
    }
    var bpm = tp ? tp.bpm : 0, bc = tp ? tp.conf : 0, cn = clamp((cent - 500) / 2500, 0, 1), fn = clamp((flux - .15) / .45, 0, 1);
    var energy = clamp(.5 * clamp((r.lv + 28) / 20, 0, 1) + .25 * cn + .25 * fn, 0, 1);
    var tempoFit = bpm ? Math.exp(-Math.pow((bpm - 118) / 35, 2)) : .3;
    var dance = clamp(.6 * clamp((bc - 1.5) / 3, 0, 1) + .4 * tempoFit, 0, 1);
    var val = clamp(.5 + (bm ? -.16 : .16) + .18 * clamp(((bpm || 105) - 105) / 45, -1, 1) + .3 * (cn - .4), 0, 1);
    var ac = clamp(.55 * (1 - cn) + .25 * (1 - fn) + .2 * (1 - clamp(pHi / (pLow + pMid + pHi + 1e-12) * 12, 0, 1)), 0, 1);
    var ins = clamp(1.15 - 1.6 * midShare, 0, 1), sp = clamp(.9 * (.6 - best) + .05, 0, 1);
    function q(v){ return +v.toFixed(2); }
    return { bpm: +(bpm || 0).toFixed(1), key: TONIC[bk] + (bm ? ' minor' : ' major'), camelot: (bm ? CAM_MIN : CAM_MAJ)[bk] + (bm ? 'A' : 'B'), kc: q(clamp((best - second) * 6 + (best - .45), 0, 1)),
      energy: q(energy), danceability: q(dance), valence: q(val), acousticness: q(ac), instrumentalness: q(ins), speechiness: q(sp), loudness: +r.lv.toFixed(1), timeSignature: tp && tp.sig || '4/4' };
  }
  /* how well two keys sit together on the Camelot wheel: same key, a neighbour, or the relative major/minor are the safe moves */
  function camel(c){ var m = /^(\d+)([AB])$/.exec(c || ''); return m ? { n: +m[1], l: m[2] } : null; }
  F._sonic = sonic;
  F.harmony = function(a, b){
    if (!a || !b || !a.camelot || !b.camelot || (a.kc < .12 || b.kc < .12)) return .5;
    var x = camel(a.camelot), y = camel(b.camelot); if (!x || !y) return .5;
    var dn = Math.abs(x.n - y.n); dn = Math.min(dn, 12 - dn);
    if (x.l === y.l){ return dn === 0 ? 1 : dn === 1 ? .92 : dn === 2 ? .6 : dn === 7 ? .35 : Math.max(0, .3 - dn * .04); }
    return dn === 0 ? .88 : dn === 1 ? .45 : .1;
  };

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
    /* 3 beats or 4 beats to the bar: which grouping makes the first beat of the bar stand out more */
    var sig = '4/4';
    try {
      var bt = [], tt, jj, mm; for (tt = c0 + br.f; tt < c1 - 2; tt += P){ jj = Math.round(tt); bt.push(Math.max(flat[jj - 1] || 0, flat[jj] || 0, flat[jj + 1] || 0)); }
      var contrast = function(m){ var s = new Array(m).fill(0), c = new Array(m).fill(0), i2, tot2 = 0; for (i2 = 0; i2 < bt.length; i2++){ s[i2 % m] += bt[i2]; c[i2 % m]++; tot2 += bt[i2]; } var mean = tot2 / Math.max(1, bt.length), mx = 0; for (i2 = 0; i2 < m; i2++){ var a2 = s[i2] / Math.max(1, c[i2]); if (a2 > mx) mx = a2; } return mean > 0 ? mx / mean : 1; };
      if (bt.length > 24){ var c3 = contrast(3), c4 = contrast(4); if (c3 > c4 * 1.22 && c3 > 1.25) sig = '3/4'; }
    } catch (e) {}
    return { sig: sig, bpm: +bb.toFixed(2), conf: +conf.toFixed(2), p0: +phaseAt(intro0, intro0 + 3200).toFixed(3), p1: +phaseAt(endE - 3200, endE).toFixed(3) };
  }


  /* the heavy number crunching runs in a background worker, so the music and the screen never stutter while songs are being measured */
  var wk = null, wkFail = false, wkId = 0, wkJobs = {};
  function wsrc(){
    return 'var clamp=function(v,a,b){return v<a?a:v>b?b:v};var TONIC=' + JSON.stringify(TONIC) + ',CAM_MAJ=' + JSON.stringify(CAM_MAJ) + ',CAM_MIN=' + JSON.stringify(CAM_MIN) + ',KS_MAJ=' + JSON.stringify(KS_MAJ) + ',KS_MIN=' + JSON.stringify(KS_MIN) + ';' +
      [measure, tempo, sonic, fft, corr].map(function(fn){ return fn.toString(); }).join('\n') +
      '\nonmessage=function(e){var d=e.data,m=d.mono,buf={numberOfChannels:1,length:m.length,sampleRate:d.sr,getChannelData:function(){return m;}},r=null;try{r=measure(buf);}catch(x){}postMessage({id:d.id,r:r});};';
  }
  function getWorker(){
    if (wk || wkFail) return wk;
    try {
      wk = new Worker(URL.createObjectURL(new Blob([wsrc()], { type: 'text/javascript' })));
      wk.onmessage = function(e){ var j = wkJobs[e.data.id]; if (j){ delete wkJobs[e.data.id]; j.res(e.data.r); } };
      wk.onerror = function(){ wkFail = true; wk = null; Object.keys(wkJobs).forEach(function(k){ var j = wkJobs[k]; delete wkJobs[k]; try { j.res(measure(j.buf)); } catch (x) { j.res(null); } }); };
    } catch (e) { wkFail = true; wk = null; }
    return wk;
  }
  function analyse(buf){
    var w = getWorker(); if (!w) return Promise.resolve(measure(buf));
    var n = buf.length, mono, c0 = buf.getChannelData(0), i;
    if (buf.numberOfChannels > 1){ var c1 = buf.getChannelData(1); mono = new Float32Array(n); for (i = 0; i < n; i++) mono[i] = (c0[i] + c1[i]) * .5; } else mono = c0.slice();
    return new Promise(function(res){ var id = ++wkId; wkJobs[id] = { res: res, buf: buf }; try { w.postMessage({ id: id, mono: mono, sr: buf.sampleRate }, [mono.buffer]); } catch (e) { delete wkJobs[id]; try { res(measure(buf)); } catch (x) { res(null); } } });
  }

  function decode(arr){
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; var o = new OAC(1, 1, 22050);   /* decoded at 22 kHz: half the memory, plenty for tempo, key and loudness */
    return new Promise(function(res, rej){ var p = o.decodeAudioData(arr, res, rej); if (p && p.then) p.then(res, rej); });
  }
  function blobOf(t){ return t.synth ? AV.synthWav(t.synth) : t.blob; }
  F.measureTrack = function(t){
    return loadCache().then(function(){
      if (fresh(t.id)) return fxa[t.id];
      var blob = blobOf(t); if (!blob || blob.size > MAX_BYTES){ if (fxa[t.id]) fxa[t.id].nt = 1; else fxa[t.id] = { skip: 1 }; return null; }
      return blob.arrayBuffer().then(decode).then(analyse).then(function(r){
        if (r){ fxa[t.id] = r; saveCache(); } else { if (fxa[t.id]) fxa[t.id].nt = 1; else fxa[t.id] = { skip: 1 }; saveCache(); }
        return r;
      }).catch(function(){ if (fxa[t.id]) fxa[t.id].nt = 1; return null; });
    });
  };
  function fresh(id){ var r = fxa[id]; return !!r && (r.skip || r.nt || r.v >= 3); }
  F.forget = function(id){ if (fxa[id]){ delete fxa[id]; saveCache(); } };
  F.analysisOf = function(id){ var r = fxa[id]; return r && !r.skip ? r : null; };

  /* measure one song at a time, never while the phone is busy starting a new one */
  var holdT = 0;
  function pump(){
    if (analysing || !queue.length) return;
    if (F.hold && F.hold()){ clearTimeout(holdT); holdT = setTimeout(pump, 700); return; }   /* never compete with a song that is playing, loading or blending */
    analysing = true;
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
  /* picture of a song for the Mix Studio: loudness outline split into low end and the rest */
  var waves = {};
  F.wave = function(t){
    if (waves[t.id]) return Promise.resolve(waves[t.id]);
    var blob = blobOf(t); if (!blob || blob.size > MAX_BYTES) return Promise.resolve(null);
    return blob.arrayBuffer().then(decode).then(function(buf){
      var n = 900, d0 = buf.getChannelData(0), d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null, len = buf.length, step = Math.max(1, Math.floor(len / n));
      var hi = new Float32Array(n), lo = new Float32Array(n), a1 = 1 - Math.exp(-2 * Math.PI * 200 / buf.sampleRate), y = 0, b, i, mx = 1e-6;
      for (b = 0; b < n; b++){
        var ph = 0, pl = 0, e = Math.min(len, (b + 1) * step);
        for (i = b * step; i < e; i += 2){ var v = d1 ? (d0[i] + d1[i]) * .5 : d0[i]; y += a1 * 2 * (v - y); var av = v < 0 ? -v : v, al = y < 0 ? -y : y; if (av > ph) ph = av; if (al > pl) pl = al; }
        hi[b] = ph; lo[b] = pl; if (ph > mx) mx = ph;
      }
      for (b = 0; b < n; b++){ hi[b] /= mx; lo[b] /= mx; }
      return (waves[t.id] = { n: n, d: buf.duration, hi: hi, lo: lo });
    }).catch(function(){ return null; });
  };
  /* hand controls for the two-deck mixer */
  F.deckGain = function(el, v){ var n = nodeOf(el); if (!n || !ctx) return; var now = ctx.currentTime; try { n.fade.gain.cancelScheduledValues(now); n.fade.gain.setTargetAtTime(v, now, .012); } catch (e) {} };
  F.deckKill = function(el, on){ var n = nodeOf(el); if (!n || !ctx) return; var now = ctx.currentTime; try { n.kill.gain.cancelScheduledValues(now); n.kill.gain.setTargetAtTime(on ? KILL : 0, now, .03); } catch (e) {} };
  F.deckReset = function(){ if (!ctx || !N) return; var now = ctx.currentTime; [N.A, N.B].forEach(function(s){ try { s.fade.gain.cancelScheduledValues(now); s.fade.gain.setValueAtTime(1, now); s.kill.gain.cancelScheduledValues(now); s.kill.gain.setValueAtTime(0, now); s.flt.frequency.cancelScheduledValues(now); s.flt.type = 'lowpass'; s.flt.frequency.setValueAtTime(22000, now); neutral(s, now); } catch (e) {} }); };
  F.analyseMany = function(list){ loadCache().then(function(){ list.forEach(enqueue); pump(); }); };
  F.wantNext = function(t){ if (!t || fresh(t.id)) return; var i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); queue.splice(Math.min(1, queue.length), 0, t); pump(); };
  F.status = function(){
    var parts = [];
    if (st.auto && (album.bass || album.treble)) parts.push((album.bass ? 'Bass ' + (album.bass > 0 ? '+' : '') + album.bass : '') + (album.bass && album.treble ? ' · ' : '') + (album.treble ? 'Treble ' + (album.treble > 0 ? '+' : '') + album.treble : ''));
    if (st.norm && album.level != null) parts.push('Volume ' + (album.level > 0 ? '+' : '') + album.level + ' dB');
    return parts.join('  ·  ');
  };
})();
